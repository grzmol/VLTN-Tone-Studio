export interface LibraryAudio { name: string; sampleRate: number; frames: number; channels: number }
export interface LibrarySong {
  id: string; title: string; artist: string; sourceName: string; duration: number;
  audio: LibraryAudio[]; settings: Record<string, string>; updated: string;
}
export interface Playlist { id: string; name: string; songs: string[] }
export interface SongLibrary { version: 1; songs: LibrarySong[]; playlists: Playlist[] }
export interface LibraryTransferProgress { phase: string; completed: number; total: number }
export interface LibraryTransferResult { songs: number; playlists: number; fileName: string }
export interface LibraryPreflightSong { id: string; song?: LibrarySong; errors: string[] }
export interface SongLibraryApi {
  preflight(ids: string[]): Promise<LibraryPreflightSong[]>;
  exportBackup(): Promise<LibraryTransferResult | null>;
  restoreBackup(): Promise<LibraryTransferResult | null>;
  onTransferProgress(callback: (progress: LibraryTransferProgress) => void): () => void;
  index(): Promise<SongLibrary>;
  save(song: LibrarySong, assets: { name: string; bytes: Uint8Array }[]): Promise<void>;
  audio(id: string, name: string): Promise<Uint8Array>;
  playlists(playlists: Playlist[]): Promise<void>;
  remove(id: string): Promise<void>;
  settings(id: string, values: Record<string, string>): Promise<void>;
}
export const emptyLibrary = (): SongLibrary => ({ version: 1, songs: [], playlists: [] });
export const validId = (id: string): boolean => /^[a-f0-9-]{36}$/.test(id);
export const assetName = (name: string, channel: number): string => `${name}-${channel}.f32`;
export function validateSong(song: LibrarySong): void {
  if (!validId(song.id) || !song.title.trim() || song.title.length > 300 || !Number.isFinite(song.duration) || song.duration <= 0) throw new Error('Invalid saved song.');
  if (!song.audio.length || song.audio[0].name !== 'source' || song.audio.length > 7 || new Set(song.audio.map(a => a.name)).size !== song.audio.length) throw new Error('Invalid song tracks.');
  for (const a of song.audio) {
    if (!['source', 'drums', 'bass', 'other', 'vocals', 'guitar', 'piano'].includes(a.name) || !Number.isInteger(a.channels) || a.channels < 1 || a.channels > 2 || !Number.isInteger(a.frames) || a.frames < 1 || !Number.isFinite(a.sampleRate) || a.sampleRate < 8000 || a.sampleRate > 192000) throw new Error('Invalid song audio.');
  }
  if (Object.entries(song.settings).some(([k, v]) => !['', ':bpm', ':lyrics', ':options'].includes(k) || typeof v !== 'string')) throw new Error('Invalid song settings.');
}
export function validatePlaylists(playlists: Playlist[], songs: LibrarySong[]): void {
  const ids = new Set(songs.map(s => s.id));
  if (new Set(playlists.map(p => p.id)).size !== playlists.length || playlists.some(p => !validId(p.id) || !p.name.trim() || p.name.length > 300 || p.songs.some(id => !ids.has(id)))) throw new Error('Playlist contains an invalid or missing song.');
}
