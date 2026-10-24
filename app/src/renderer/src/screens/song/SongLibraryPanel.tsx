import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSong } from '@/song/store';
import { useSongLibrary } from '@/song/library';
import { formatTime } from '@/song/stems/mix';
import { PlaylistPreflight } from './PlaylistPreflight';
import { host } from '@/host';

const field = 'rounded border border-seam bg-transparent p-2';
export function SongLibraryPanel({ onPick }: { onPick(): void }) {
  const library = useSongLibrary(), source = useSong(s => s.source), status = useSong(s => s.status);
  const saved = library.index.songs.find(s => s.id === source?.libraryId);
  const [title, setTitle] = useState(saved?.title ?? source?.name.replace(/\.[^.]+$/, '') ?? '');
  const [artist, setArtist] = useState(saved?.artist ?? '');
  const [search, setSearch] = useState(''), [name, setName] = useState(''), [selected, setSelected] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => { if (host.song.library) void library.refresh(); }, []);
  useEffect(() => { setTitle(saved?.title ?? source?.name.replace(/\.[^.]+$/, '') ?? ''); setArtist(saved?.artist ?? ''); }, [source, saved?.title, saved?.artist]);
  const playlist = library.index.playlists.find(p => p.id === selected);
  const rows = library.index.songs.filter(s => `${s.title} ${s.artist}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const update = (songs: string[]) => playlist && void library.playlists(library.index.playlists.map(p => p.id === playlist.id ? { ...p, songs } : p));
  const move = (i: number, offset: number) => { if (!playlist) return; const songs = [...playlist.songs]; [songs[i], songs[i + offset]] = [songs[i + offset], songs[i]]; update(songs); };
  const duration = playlist?.songs.reduce((sum, id) => sum + (library.index.songs.find(s => s.id === id)?.duration ?? 0), 0) ?? 0;
  if (!host.song.library) return <p>Use the desktop app to save songs and audio for offline performances.</p>;
  return <section aria-label="Saved songs and playlists" className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-2">
    <div className="rounded border border-seam p-4">
      <h2 className="font-semibold">Save the current song</h2>
      <p className="text-sm text-silkscreen-3">Stores a local copy of the audio and stems, lyrics, chord chart, MIDI cues and performance settings. Save again after making changes. Load song starts paused; Play playlist runs the whole set in order.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <input aria-label="Song title" placeholder="Song title" className={field} value={title} onChange={e => setTitle(e.target.value)} />
        <input aria-label="Song artist" placeholder="Artist" className={field} value={artist} onChange={e => setArtist(e.target.value)} />
        <Button disabled={!source || !title.trim() || library.busy || ['splitting', 'model', 'decoding'].includes(status.kind)} onClick={() => void library.save(title, artist)}>{saved ? 'Save song changes' : 'Save song to library'}</Button>
        <Button variant="outline" disabled={library.busy} onClick={onPick}>Import audio…</Button>
      </div>
    </div>
    <section aria-label="Portable library backup" className="space-y-3 rounded border border-seam p-4">
      <h2 className="font-semibold">Portable library backup</h2>
      <p className="text-sm text-silkscreen-3">Export all saved songs, source audio, stems, charts, lyrics, key/mix settings and playlists into one compressed archive. Save the current song first to include new audio or stems. Current edits to an already-saved song are included automatically.</p>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={library.busy || !library.index.songs.length || ['splitting','model','decoding'].includes(status.kind)} onClick={()=>void library.exportBackup()}>Export library backup…</Button><Button variant="outline" disabled={library.busy || ['splitting','model','decoding'].includes(status.kind)} onClick={()=>void library.restoreBackup()}>Restore backup as new copies…</Button></div>
      <p className="text-xs text-silkscreen-3">Restore adds new songs and playlists, keeping your existing library. Importing the same backup again creates duplicates. MIDI ports, cue arming and account settings are not included.</p>
    </section>
    {library.busy && <p role="status">{library.transfer || 'Working with saved songs…'}</p>}
    {library.busy && library.playlistPlaying && <Button variant="outline" onClick={() => library.pausePlaylist()}>Stop playlist</Button>}
    {library.notice && <p role="status">{library.notice}</p>}
    {library.error && <p role="alert" className="text-red-400">{library.error}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <div><h2 className="mb-2 font-semibold">Songs · {library.index.songs.length}</h2>
        <input aria-label="Search saved songs" placeholder="Search title or artist" className={field + ' mb-3 w-full'} value={search} onChange={e => setSearch(e.target.value)} />
        {!rows.length && <p>No saved songs. Open audio, prepare it, then save it above.</p>}
        <ul className="space-y-2">{rows.map(song => <li key={song.id} className="rounded border border-seam p-3">
          <strong>{song.title}</strong><p className="text-sm">{song.artist} · {formatTime(song.duration)} · {song.audio.length - 1} stems</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={library.busy} onClick={() => void library.load(song.id)}>Load song</Button>
            <Button variant="outline" disabled={!playlist || library.busy} onClick={() => update([...(playlist?.songs ?? []), song.id])}>Add to playlist</Button>
            <Button variant="outline" disabled={library.busy} onClick={() => setConfirm(song.id)}>Delete song…</Button>
            {confirm === song.id && <><span>Delete saved audio and remove from all playlists?</span><Button disabled={library.busy} onClick={() => { setConfirm(''); void library.remove(song.id); }}>Confirm delete</Button><Button variant="outline" onClick={() => setConfirm('')}>Keep song</Button></>}
          </div>
        </li>)}</ul>
      </div>
      <div><h2 className="mb-2 font-semibold">Playlists / live sets</h2>
        <div className="mb-3 flex flex-wrap gap-2"><input aria-label="New playlist name" placeholder="New playlist name" className={field} value={name} onChange={e => setName(e.target.value)} /><Button disabled={!name.trim() || library.busy} onClick={() => { const id = crypto.randomUUID(); void library.playlists([...library.index.playlists, { id, name: name.trim(), songs: [] }]); setSelected(id); setName(''); }}>Create playlist</Button></div>
        <select aria-label="Playlist" className={field + ' mb-3 w-full'} value={selected} onChange={e => { setSelected(e.target.value); setConfirm(''); }}><option value="">Select a playlist…</option>{library.index.playlists.map(p => <option value={p.id} key={p.id}>{p.name} ({p.songs.length})</option>)}</select>
        {playlist && <>
          <div className="mb-3 flex flex-wrap gap-2"><input aria-label="Playlist name" key={playlist.id + playlist.name} defaultValue={playlist.name} className={field} disabled={library.busy} onBlur={e => { const next = e.target.value.trim(); if (next && next !== playlist.name) void library.playlists(library.index.playlists.map(p => p.id === playlist.id ? { ...p, name: next } : p)); }} /><Button disabled={!playlist.songs.length || library.busy} onClick={() => void library.playPlaylist([...playlist.songs])}>Play playlist</Button><Button variant="outline" disabled={!playlist.songs.length || library.busy} onClick={() => void library.load(playlist.songs[0], [...playlist.songs], 0)}>Load set paused</Button><Button variant="outline" disabled={library.busy} onClick={() => setConfirm('playlist:' + playlist.id)}>Delete playlist…</Button></div>
          {confirm === 'playlist:' + playlist.id && <div>Keep the songs and delete this playlist? <Button disabled={library.busy} onClick={() => { void library.playlists(library.index.playlists.filter(p => p.id !== playlist.id)); setSelected(''); setConfirm(''); }}>Confirm delete playlist</Button><Button variant="outline" onClick={() => setConfirm('')}>Keep playlist</Button></div>}
          <p className="mb-3">{playlist.songs.length} entries · {formatTime(duration)} · Automatically advances during playback</p>
          <PlaylistPreflight key={playlist.id} ids={playlist.songs} disabled={library.busy || library.playlistPlaying} revision={library.index} />
          <ol className="space-y-2">{playlist.songs.map((id, i) => <li key={i} className="flex flex-wrap items-center gap-2 rounded border border-seam p-2"><span className="flex-1">{i + 1}. {library.index.songs.find(s => s.id === id)?.title ?? 'Missing song'}</span><Button variant="outline" disabled={library.busy} onClick={() => void library.playPlaylist([...playlist.songs], i)}>Play from here</Button><Button variant="outline" disabled={library.busy} onClick={() => void library.load(id, [...playlist.songs], i)}>Load paused</Button><Button aria-label={`Move entry ${i + 1} up`} variant="outline" disabled={i === 0 || library.busy} onClick={() => move(i, -1)}>↑</Button><Button aria-label={`Move entry ${i + 1} down`} variant="outline" disabled={i === playlist.songs.length - 1 || library.busy} onClick={() => move(i, 1)}>↓</Button><Button aria-label={`Remove entry ${i + 1}`} variant="outline" disabled={library.busy} onClick={() => update(playlist.songs.filter((_, index) => index !== i))}>Remove</Button></li>)}</ol>
        </>}
      </div>
    </div>
  </section>;
}
