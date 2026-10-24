import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exportBackup, readBackup } from './song-library-backup';
import { assetName, emptyLibrary, validId, validatePlaylists, validateSong, type LibrarySong, type Playlist, type SongLibrary, type LibraryTransferProgress } from '../../shared/song-library';

export type DiskIndex = SongLibrary & { revisions: Record<string, string> };
/** Audio is staged before publishing a new index. An interrupted save leaves the previous song intact. */
export class SongLibraryStore {
  private pending = new Map<string, LibrarySong>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> { const job = this.tail.then(fn, fn); this.tail = job.catch(() => {}); return job; }
  private async read(): Promise<DiskIndex> {
    try { const index = JSON.parse(await readFile(join(this.root, 'library.json'), 'utf8')) as DiskIndex;
      if (index.version !== 1 || !index.revisions) throw new Error('Unsupported song library.'); return index;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...emptyLibrary(), revisions: {} }; throw e; }
  }
  private async publish(index: DiskIndex): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const temp = join(this.root, `index-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(index));
    await rename(temp, join(this.root, 'library.json'));
  }
  async preflight(ids: string[]): Promise<import('../../shared/song-library').LibraryPreflightSong[]> {
    if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !validId(id))) throw new Error('Invalid playlist song IDs.');
    return this.serial(async () => {
      const index = await this.read();
      const results: import('../../shared/song-library').LibraryPreflightSong[] = [];
      for (const id of new Set(ids)) {
        const song = index.songs.find(s => s.id === id), errors: string[] = [];
        if (!song) { results.push({id, errors:['Song is missing from the library.']}); continue; }
        try { validateSong(song); } catch { results.push({id, errors:['Saved song metadata is invalid.']}); continue; }
        const revision = index.revisions[id];
        if (!revision || !validId(revision)) errors.push('Saved audio revision is missing.');
        else for (const track of song.audio) for (let c=0;c<track.channels;c++) {
          const name=assetName(track.name,c);
          try {
            const info=await stat(join(this.root,revision,name));
            if (!info.isFile() || info.size!==track.frames*4) errors.push(`${name}: audio file has an invalid size or type.`);
          } catch { errors.push(`${name}: audio file is missing or inaccessible.`); }
        }
        results.push({id,song,errors});
      }
      return results;
    });
  }
  async index(): Promise<SongLibrary> { const { revisions: _, ...index } = await this.read(); return index; }
  async begin(song: LibrarySong): Promise<string> {
    validateSong(song); const token = randomUUID();
    await mkdir(join(this.root, token), { recursive: true }); this.pending.set(token, song); return token;
  }
  async write(token: string, name: string, bytes: Uint8Array): Promise<void> {
    const song = this.pending.get(token);
    const track = song?.audio.find(a => Array.from({ length: a.channels }, (_, c) => assetName(a.name, c)).includes(name));
    if (!track || bytes.byteLength !== track.frames * 4) throw new Error('Invalid song audio asset.');
    await writeFile(join(this.root, token, name), bytes);
  }
  async commit(token: string): Promise<void> {
    return this.serial(async () => {
      const song = this.pending.get(token); if (!song) throw new Error('Save session expired.');
      for (const a of song.audio) for (let c = 0; c < a.channels; c++) {
        if ((await stat(join(this.root, token, assetName(a.name, c)))).size !== a.frames * 4) throw new Error('Incomplete song save.');
      }
      const index = await this.read(); const old = index.revisions[song.id];
      index.songs = [...index.songs.filter(s => s.id !== song.id), song]; index.revisions[song.id] = token;
      await this.publish(index); this.pending.delete(token);
      if (old && validId(old)) await rm(join(this.root, old), { recursive: true, force: true }).catch(() => {});
    });
  }
  async abort(token: string): Promise<void> {
    if (!this.pending.delete(token) || !validId(token)) return;
    await rm(join(this.root, token), { recursive: true, force: true });
  }
  async audio(id: string, name: string): Promise<Uint8Array> {
    return this.serial(async () => {
      const index = await this.read(), song = index.songs.find(s => s.id === id), rev = index.revisions[id];
      if (!song || !rev || !validId(rev) || !song.audio.some(a => Array.from({ length: a.channels }, (_, c) => assetName(a.name, c)).includes(name))) throw new Error('Song audio not found.');
      return new Uint8Array(await readFile(join(this.root, rev, name)));
    });
  }
  async playlists(playlists: Playlist[]): Promise<void> { return this.serial(async () => { const index = await this.read(); validatePlaylists(playlists, index.songs); index.playlists = playlists; await this.publish(index); }); }
  async settings(id: string, values: Record<string, string>): Promise<void> {
    return this.serial(async () => {
      const index = await this.read(), song = index.songs.find(s => s.id === id);
      if (!song) throw new Error('Saved song not found.');
      const updated = { ...song, settings: values, updated: new Date().toISOString() }; validateSong(updated);
      index.songs = index.songs.map(s => s.id === id ? updated : s); await this.publish(index);
    });
  }
  async exportBackup(path: string, progress?: (p: LibraryTransferProgress) => void): Promise<{songs:number;playlists:number}> {
    return this.serial(async()=>{
      const index=await this.read();
      // Materialize the empty index too, so even an empty backup has a complete format.
      await this.publish(index);
      await exportBackup(this.root,index,path,progress);
      return {songs:index.songs.length,playlists:index.playlists.length};
    });
  }
  async restoreBackup(path: string, progress?: (p: LibraryTransferProgress) => void): Promise<{songs:number;playlists:number}> {
    return this.serial(async()=>{
      const stage=join(this.root,'.restore-'+randomUUID()),moved:string[]=[];
      try {
        const backup=await readBackup(path,stage,progress),current=await this.read();
        const ids=new Map(backup.songs.map(song=>[song.id,randomUUID()]));
        const revisions:Record<string,string>={...current.revisions};
        for(const song of backup.songs) {
          const revision=randomUUID(),target=join(this.root,revision);
          await rename(join(stage,backup.revisions[song.id]),target);moved.push(target);
          revisions[ids.get(song.id)!]=revision;
        }
        const songs=backup.songs.map(song=>({...song,id:ids.get(song.id)!}));
        const playlists=backup.playlists.map(playlist=>({...playlist,id:randomUUID(),songs:playlist.songs.map(id=>ids.get(id)!)}));
        await this.publish({version:1,songs:[...current.songs,...songs],playlists:[...current.playlists,...playlists],revisions});
        moved.length=0;
        return {songs:songs.length,playlists:playlists.length};
      } finally {
        await rm(stage,{recursive:true,force:true}).catch(()=>{});
        for(const path of moved) await rm(path,{recursive:true,force:true}).catch(()=>{});
      }
    });
  }
  async remove(id: string): Promise<void> {
    return this.serial(async () => {
      const index = await this.read(), rev = index.revisions[id];
      index.songs = index.songs.filter(s => s.id !== id); index.playlists.forEach(p => { p.songs = p.songs.filter(s => s !== id); }); delete index.revisions[id];
      await this.publish(index);
      if (rev && validId(rev)) await rm(join(this.root, rev), { recursive: true, force: true }).catch(() => {});
    });
  }
}
