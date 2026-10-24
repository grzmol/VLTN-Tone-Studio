// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SongLibraryStore } from './song-library-store';
import type { LibrarySong } from '../../shared/song-library';

let root: string, store: SongLibraryStore;
const pcm = new Uint8Array(new Float32Array([0, .25, -.5, 1]).buffer);
const song = (): LibrarySong => ({ id: randomUUID(), title: 'Live song', artist: 'Artist', sourceName: 'song.mp3', duration: 4 / 44100, audio: [{ name: 'source', sampleRate: 44100, frames: 4, channels: 1 }], settings: { '': '[00:00] [C]', ':lyrics': '[00:00] Words', ':bpm': '130' }, updated: new Date().toISOString() });
async function save(s: LibrarySong) { const token = await store.begin(s); await store.write(token, 'source-0.f32', pcm); await store.commit(token); }
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'vltn-song-library-test-')); store = new SongLibraryStore(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it('round-trips audio, charts and duplicate playlist entries across restart', async () => {
  const first = song(), second = song(); await save(first); await save(second);
  const playlist = { id: randomUUID(), name: 'Gig', songs: [second.id, first.id, second.id] };
  await store.playlists([playlist]);
  store = new SongLibraryStore(root);
  expect((await store.index()).playlists).toEqual([playlist]);
  expect((await store.index()).songs[0]).toEqual(first);
  expect(await store.audio(first.id, 'source-0.f32')).toEqual(pcm);
  await store.settings(first.id, { ':bpm': '90' });
  expect((await new SongLibraryStore(root).index()).songs[0].settings).toEqual({ ':bpm': '90' });
});
it('keeps the last complete revision after an incomplete replacement', async () => {
  const original = song(); await save(original);
  const token = await store.begin({ ...original, title: 'Replacement' });
  await expect(store.commit(token)).rejects.toThrow();
  await store.abort(token);
  expect((await store.index()).songs[0].title).toBe(original.title);
  expect(await store.audio(original.id, 'source-0.f32')).toEqual(pcm);
});
it('rejects path traversal, wrong lengths and dangling playlist references', async () => {
  const s = song(), token = await store.begin(s);
  await expect(store.write(token, '../escape', pcm)).rejects.toThrow();
  await expect(store.write(token, 'source-0.f32', new Uint8Array(3))).rejects.toThrow();
  await expect(store.begin({ ...s, id: '../escape' })).rejects.toThrow();
  await expect(store.playlists([{ id: randomUUID(), name: 'Missing', songs: [s.id] }])).rejects.toThrow();
  await store.abort(token);
});
it('deletes a playlist without deleting songs and removes deleted songs from every playlist', async () => {
  const s = song(); await save(s);
  await store.playlists([{ id: randomUUID(), name: 'Set', songs: [s.id, s.id] }]);
  await store.playlists([]); expect((await store.index()).songs).toHaveLength(1);
  await store.playlists([{ id: randomUUID(), name: 'Set', songs: [s.id, s.id] }]);
  await store.remove(s.id);
  expect((await store.index()).songs).toEqual([]);
  expect((await store.index()).playlists[0].songs).toEqual([]);
  await expect(store.audio(s.id, 'source-0.f32')).rejects.toThrow();
});

it('preflights saved assets without loading PCM, deduplicates IDs and reports missing or truncated audio',async()=>{
 const first=song(),second=song();await save(first);await save(second);
 const index=JSON.parse(await readFile(join(root,'library.json'),'utf8'));
 await writeFile(join(root,index.revisions[first.id],'source-0.f32'),new Uint8Array(1));
 await rm(join(root,index.revisions[second.id],'source-0.f32'));
 const missing=randomUUID();const result=await store.preflight([first.id,second.id,first.id,missing]);
 expect(result).toHaveLength(3);
 expect(result[0].errors[0]).toContain('invalid size');
 expect(result[1].errors[0]).toContain('missing or inaccessible');
 expect(result[2].errors).toEqual(['Song is missing from the library.']);
 await expect(store.preflight(['../outside'])).rejects.toThrow('Invalid playlist');
});
it('returns a clean saved snapshot for intact audio',async()=>{
 const s=song();await save(s);expect(await store.preflight([s.id])).toEqual([{id:s.id,song:s,errors:[]}]);
});
