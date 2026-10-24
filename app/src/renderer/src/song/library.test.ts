import { beforeEach, expect, it, vi } from 'vitest';
import { emptyLibrary, type LibrarySong } from '@shared/song-library';
import { useSong } from './store';
import { useSongLibrary } from './library';
import { performanceKey } from './performance/settings';
import { useNav } from '@/state/nav';

const api = vi.hoisted(() => ({ index: vi.fn(), save: vi.fn(), audio: vi.fn(), playlists: vi.fn(), remove: vi.fn(), settings: vi.fn(), exportBackup: vi.fn(), restoreBackup: vi.fn(), onTransferProgress: vi.fn() }));
vi.mock('@/host', () => ({ host: { song: { library: api } } }));
vi.mock('./stems/engine', () => ({ separateStems: vi.fn() }));
const audio = { sampleRate: 44100, channels: [new Float32Array([0, .25, -.25])] };
const saved: LibrarySong = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'Saved song', artist: '', sourceName: 'same.mp3', duration: 3 / 44100, audio: [{ name: 'source', sampleRate: 44100, frames: 3, channels: 1 }, { name: 'guitar', sampleRate: 44100, frames: 3, channels: 1 }], settings: { ':bpm': '95', '': '[00:00] [Am]', ':lyrics': '[00:00] Words' }, updated: '' };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  api.exportBackup.mockResolvedValue(null);api.restoreBackup.mockResolvedValue(null);api.onTransferProgress.mockReturnValue(vi.fn());
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
  api.audio.mockResolvedValue(new Uint8Array(audio.channels[0].buffer));
  api.settings.mockResolvedValue(undefined); api.save.mockResolvedValue(undefined);
  useSong.setState({ source: null, stems: null, status: { kind: 'idle' } });
  useSongLibrary.setState({ index: emptyLibrary(), busy: false, error: '', notice: '', queue: [], position: -1, playlistPlaying: false, midiSession: null });
});
it('loads saved source/stems and preserves queue positions for repeated entries', async () => {
  await useSongLibrary.getState().load(saved.id, [saved.id, saved.id], 1);
  expect(useSong.getState().source?.audio.channels[0]).toEqual(audio.channels[0]);
  expect(useSong.getState().stems?.guitar?.channels[0]).toEqual(audio.channels[0]);
  expect(localStorage.getItem(performanceKey(useSong.getState().source) + ':lyrics')).toBe('[00:00] Words');
  expect(useSongLibrary.getState().position).toBe(1);
  expect(useNav.getState().param).toBe('performance');
});
it('does not replace the current song when an asset read fails', async () => {
  const source = { name: 'Current', audio }; useSong.setState({ source });
  api.audio.mockRejectedValueOnce(new Error('Missing audio'));
  await useSongLibrary.getState().load(saved.id);
  expect(useSong.getState().source).toBe(source);
  expect(useSongLibrary.getState().error).toBe('Missing audio');
  expect(useNav.getState().param).toBe('songs');
});
it('saves copied audio and settings under a unique ID instead of the filename', async () => {
  const source = { name: 'same.mp3', audio }; useSong.setState({ source, stems: { guitar: audio } });
  localStorage.setItem(performanceKey(source), '[00:00] [C]');
  await useSongLibrary.getState().save('My song', 'Artist');
  const [metadata, assets] = api.save.mock.calls[0];
  expect(metadata.id).not.toBe(saved.id);
  expect(metadata.settings['']).toBe('[00:00] [C]');
  expect(assets.map((a: { name: string }) => a.name)).toEqual(['source-0.f32', 'guitar-0.f32']);
  expect(useSong.getState().source?.libraryId).toBe(metadata.id);
  expect(localStorage.getItem(performanceKey(useSong.getState().source))).toBe('[00:00] [C]');
});

it('plays every playlist entry including repeats, persists outgoing settings, and stops at the end', async () => {
  const second={...saved,id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',title:'Second song',settings:{':bpm':'130'}};
  api.index.mockResolvedValue({...emptyLibrary(),songs:[saved,second]});
  const queue=[saved.id,second.id,saved.id];
  await useSongLibrary.getState().playPlaylist(queue);
  expect(useSongLibrary.getState().playlistPlaying).toBe(true);
  expect(useSongLibrary.getState().position).toBe(0);
  localStorage.setItem(performanceKey(useSong.getState().source), '[00:02] Changed words');
  await useSongLibrary.getState().advancePlaylist();
  expect(api.settings).toHaveBeenCalledWith(saved.id,expect.objectContaining({'':'[00:02] Changed words'}));
  expect(useSong.getState().source?.libraryId).toBe(second.id);
  expect(localStorage.getItem(performanceKey(useSong.getState().source)+':bpm')).toBe('130');
  await useSongLibrary.getState().advancePlaylist();
  expect(useSong.getState().source?.libraryId).toBe(saved.id);
  expect(useSongLibrary.getState().position).toBe(2);
  await useSongLibrary.getState().advancePlaylist();
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().notice).toBe('Playlist finished.');
});

it('cancels autoplay when Stop is pressed during an audio load', async () => {
  await useSongLibrary.getState().load(saved.id);
  const previous=useSong.getState().source;
  let resolve!: (value: Uint8Array) => void;
  api.audio.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const loading=useSongLibrary.getState().playPlaylist([saved.id,saved.id],1);
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  useSongLibrary.getState().pausePlaylist();
  resolve(new Uint8Array(audio.channels[0].buffer));
  await loading;
  expect(useSong.getState().source).toBe(previous);
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().position).toBe(0);
});

it('stops the playlist on missing audio instead of silently skipping songs', async () => {
  await useSongLibrary.getState().playPlaylist([saved.id,saved.id]);
  api.audio.mockRejectedValueOnce(new Error('Missing audio'));
  await useSongLibrary.getState().advancePlaylist();
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().error).toBe('Missing audio');
  expect(useSongLibrary.getState().position).toBe(0);
});

it('keeps lyrics and key updates that finish during the first audio save', async()=>{
  const source={name:'draft.wav',audio};useSong.setState({source,stems:null});
  let finish!:()=>void;
  api.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const saving=useSongLibrary.getState().save('Demo','');
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  localStorage.setItem(performanceKey(source)+':lyrics','[00:00] Finished during save');
  localStorage.setItem(performanceKey(source)+':options',JSON.stringify({songKey:'D minor'}));
  finish();await saving;
  const key=performanceKey(useSong.getState().source);
  expect(localStorage.getItem(key+':lyrics')).toBe('[00:00] Finished during save');
  expect(JSON.parse(localStorage.getItem(key+':options')!).songKey).toBe('D minor');
  expect(api.settings).toHaveBeenCalledWith(useSong.getState().source?.libraryId,expect.objectContaining({':lyrics':'[00:00] Finished during save'}));
});

it('flushes current saved-song edits before exporting, reports progress, and cleans up the listener',async()=>{
  const source={name:saved.sourceName,audio,libraryId:saved.id};useSong.setState({source});
  localStorage.setItem(performanceKey(source)+':lyrics','[00:00] Latest lyrics');
  const unsubscribe=vi.fn();api.onTransferProgress.mockImplementationOnce(callback=>{callback({phase:'Checking files',completed:1,total:4});return unsubscribe;});
  api.exportBackup.mockResolvedValueOnce({songs:1,playlists:2,fileName:'demo.tar.gz'});
  await useSongLibrary.getState().exportBackup();
  expect(api.settings).toHaveBeenCalledWith(saved.id,expect.objectContaining({':lyrics':'[00:00] Latest lyrics'}));
  expect(api.exportBackup).toHaveBeenCalledTimes(1);expect(unsubscribe).toHaveBeenCalled();
  expect(useSongLibrary.getState()).toMatchObject({busy:false,transfer:'',notice:'Exported 1 songs and 2 playlists to demo.tar.gz.'});
});
it('treats a cancelled backup picker as cancellation and preserves the library',async()=>{
  const index={...emptyLibrary(),songs:[saved]};useSongLibrary.setState({index});
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().index).toBe(index);
  expect(useSongLibrary.getState().notice).toBe('Backup restore cancelled.');
  expect(useSongLibrary.getState().error).toBe('');
});
it('refreshes restored copies without loading a song or arming MIDI, and reports failures without clearing the index',async()=>{
  api.restoreBackup.mockResolvedValueOnce({songs:1,playlists:1,fileName:'demo.tar.gz'});
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState()).toMatchObject({index:{songs:[saved]},queue:[],midiSession:null,playlistPlaying:false});
  expect(useSong.getState().source).toBeNull();
  const index=useSongLibrary.getState().index;
  api.restoreBackup.mockRejectedValueOnce(new Error('Checksum mismatch'));
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().index).toBe(index);
  expect(useSongLibrary.getState()).toMatchObject({error:'Checksum mismatch',busy:false,transfer:''});
});
