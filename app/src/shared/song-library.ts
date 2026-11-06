/** Where a saved track came from. Older entries carry none: the source track is `source` and every other one a `stem`. */
export const TRACK_KINDS = ["source", "stem", "user"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];
/** The library's schema version. See SONG-LIBRARY.md for what each version stored. */
export const LIBRARY_VERSION = 4 as const;
/** The settings a saved song keeps, by suffix: the song's own, its tempo, its lyrics and its options. */
export const SETTING_SUFFIXES = ["", ":bpm", ":lyrics", ":options"] as const;

/** Tracks a v1 library stored as raw float32 files, one per channel. They have no `file`; the store converts them to FLAC in the background. */
export interface LibraryAudio {
  name: string;
  sampleRate: number;
  frames: number;
  channels: number;
  /** v2: the single file holding every channel, e.g. `vocals.flac`. */
  file?: string;
  codec?: "flac";
  /** v2: size of `file` in bytes. */
  bytes?: number;
  /** v2: SHA-256 of `file`, lowercase hex. */
  sha256?: string;
  /** v3: where the track came from. Missing on older saves, which read as `source` or `stem` (see `withTrackKind`). */
  kind?: TrackKind;
}
export interface LibrarySong {
  id: string;
  title: string;
  artist: string;
  sourceName: string;
  duration: number;
  audio: LibraryAudio[];
  settings: Record<string, string>;
  updated: string;
  /** v4: when the song was first saved, ISO 8601. Older songs take their `updated` time. */
  created?: string;
}
/**
 * Things the library keeps next to its songs. This version stores them and hands them back as they are, so the index can grow fields
 * without a new format version.
 */
export interface Playlist {
  id: string;
  name: string;
  songs: string[];
  [field: string]: unknown;
}
export interface SongLibrary {
  /** 4 once an index has been written by this version; v1 to v3 indexes are still read and upgraded in memory. */
  version: 1 | 2 | 3 | 4;
  songs: LibrarySong[];
  playlists: Playlist[];
  /** v4: folders and play history. Kept as they are. */
  folders: { id: string; [field: string]: unknown }[];
  history: { songId: string; [field: string]: unknown }[];
}
/** An index as it may be stored: the folders and history of an older one are missing. Read it through `upgradeIndex`. */
export type StoredLibrary = Omit<SongLibrary, "version" | "folders" | "history"> & {
  version: 1 | 2 | 3 | 4;
  folders?: SongLibrary["folders"];
  history?: SongLibrary["history"];
};
export interface LibraryTransferProgress {
  phase: string;
  completed: number;
  total: number;
}
/** The `phase` of the progress events the v1 conversion sends at start-up, and the one it sends when every song is done. */
export const CONVERTING_PHASE = "Converting saved songs";
export const CONVERTED_PHASE = "Conversion complete";
export interface LibraryTransferResult {
  songs: number;
  playlists: number;
  fileName: string;
  /** Songs left out of a restore because their audio was already in the library. */
  skipped?: number;
}
/** What a backup holds, shown before the user chooses how to restore it. */
export interface LibraryBackupPreview {
  fileName: string;
  songs: number;
  playlists: number;
  /** Songs whose source audio is already in the library. */
  duplicates: number;
}
/** "skip" leaves out songs already in the library; "copy" imports everything as new songs. */
export type RestoreMode = "skip" | "copy";
export interface SongLibraryApi {
  exportBackup(): Promise<LibraryTransferResult | null>;
  /** Opens the file picker and reads the chosen backup's index. Null when cancelled. The path stays in the main process. */
  inspectBackup(): Promise<LibraryBackupPreview | null>;
  /** Restores the backup chosen by `inspectBackup`. */
  restoreBackup(mode: RestoreMode): Promise<LibraryTransferResult>;
  onTransferProgress(callback: (progress: LibraryTransferProgress) => void): () => void;
  /** The size in bytes of the kept v1 copy (`v1-backup`), or null when there is none. */
  v1BackupBytes(): Promise<number | null>;
  /** Moves the kept v1 copy to the Trash. */
  removeV1Backup(): Promise<void>;
  index(): Promise<SongLibrary>;
  save(song: LibrarySong, assets: { name: string; bytes: Uint8Array }[]): Promise<void>;
  /** `app://library/...` URLs of the song's files, keyed by track key (see `trackKey`). The renderer fetches them directly. */
  audioUrls(id: string): Promise<Record<string, string>>;
  /** Moves the song and its audio to the Trash. */
  remove(id: string): Promise<void>;
  /** Merges the changed entries into a saved song's settings; an empty value removes one. */
  updateSettings(id: string, patch: Record<string, string>): Promise<void>;
}
export const emptyLibrary = (): SongLibrary => ({ version: LIBRARY_VERSION, songs: [], playlists: [], folders: [], history: [] });
export const validId = (id: string): boolean => /^[a-f0-9-]{36}$/.test(id);
export const TRACK_NAMES = ["source", "drums", "bass", "other", "vocals", "guitar", "piano"];
/** Imported tracks are stored under a fixed file name, so any track name is safe on disk. */
export const USER_TRACK_FILE = /^track(3[01]|[12]\d|\d)\.flac$/;
export const assetName = (name: string, channel: number): string => `${name}-${channel}.f32`;
export const flacName = (name: string): string => `${name}.flac`;
export const isFlacTrack = (track: LibraryAudio): boolean => track.codec === "flac";
/** Whether a file name is one a saved song may hold: a stem or the source, or an imported track. */
export const isTrackFileName = (file: string): boolean => USER_TRACK_FILE.test(file) || TRACK_NAMES.some((name) => file === flacName(name));

/**
 * The key a track is known by everywhere in the player. It is the file's name without the extension, so a stem keeps its name ("drums").
 * Raw v1 tracks use their name.
 */
export const trackKey = (track: LibraryAudio): string => (track.file ?? track.name).replace(/\.flac$/, "");

/** The track's kind, reading a save from before v3 as the source or a stem. */
export const trackKindOf = (track: LibraryAudio): TrackKind => track.kind ?? (track.name === "source" ? "source" : "stem");

/** A v2 track brought up to the v3 model. Nothing that was saved changes: only the kind is written down. */
export function withTrackKind(track: LibraryAudio): LibraryAudio {
  return track.kind === undefined ? { ...track, kind: trackKindOf(track) } : track;
}

/** A song brought up to the v4 model. Nothing that was saved changes: a missing creation time is the time it was last updated. */
export function withSongDefaults(song: LibrarySong): LibrarySong {
  return { ...song, audio: song.audio.map(withTrackKind), created: song.created ?? song.updated };
}

/** An index read from an older version, with every song in the v4 model. The version is written on the next publish. */
export function upgradeIndex<T extends StoredLibrary>(index: T): T & SongLibrary {
  if (index.version === LIBRARY_VERSION && index.folders && index.history) return index as T & SongLibrary;
  return {
    ...index,
    version: LIBRARY_VERSION,
    songs: index.songs.map(withSongDefaults),
    folders: index.folders ?? [],
    history: index.history ?? [],
  };
}

/** The files that make up one track and the size each must have. */
export function trackFiles(track: LibraryAudio): { file: string; bytes: number; sha256?: string }[] {
  if (isFlacTrack(track)) return [{ file: track.file!, bytes: track.bytes!, sha256: track.sha256 }];
  return Array.from({ length: track.channels }, (_, c) => ({ file: assetName(track.name, c), bytes: track.frames * 4 }));
}

/** Whether a song still has raw float32 tracks waiting to be converted. */
export const isLegacySong = (song: LibrarySong): boolean => song.audio.some((a) => !isFlacTrack(a));

const TRACK_NAME = /^[^\u0000-\u001f\u007f]{1,60}$/;
/** The most tracks a song holds: the source and every stem a model makes. Imported tracks have room beside them. */
const TRACKS_MAX = 33;

export function validateSong(song: LibrarySong): void {
  if (!validId(song.id) || !song.title.trim() || song.title.length > 300 || !Number.isFinite(song.duration) || song.duration <= 0)
    throw new Error("Invalid saved song.");
  if (!song.audio.length || song.audio[0].name !== "source" || song.audio.length > TRACKS_MAX) throw new Error("Invalid song tracks.");
  const keys = new Set(song.audio.map(trackKey));
  // Keys are file names, so they must be unique.
  if (keys.size !== song.audio.length) throw new Error("Invalid song tracks.");
  for (const a of song.audio) {
    const kind = trackKindOf(a);
    const legacyName = TRACK_NAMES.includes(a.name);
    const userNamed = kind === "user" && TRACK_NAME.test(a.name);
    if (
      !(legacyName || userNamed) ||
      !Number.isInteger(a.channels) ||
      a.channels < 1 ||
      a.channels > 2 ||
      !Number.isInteger(a.frames) ||
      a.frames < 1 ||
      !Number.isFinite(a.sampleRate) ||
      a.sampleRate < 8000 ||
      a.sampleRate > 192000
    )
      throw new Error("Invalid song audio.");
    if (a.codec !== undefined || a.file !== undefined || a.bytes !== undefined || a.sha256 !== undefined) {
      const fileOk = kind === "user" ? USER_TRACK_FILE.test(a.file ?? "") : a.file === flacName(a.name);
      if (a.codec !== "flac" || !fileOk || !Number.isSafeInteger(a.bytes) || a.bytes! < 1 || !/^[a-f0-9]{64}$/.test(a.sha256 ?? ""))
        throw new Error("Invalid song audio file.");
    } else if (kind === "user") throw new Error("Invalid song audio file.");
  }
  if (Object.entries(song.settings).some(([k, v]) => !(SETTING_SUFFIXES as readonly string[]).includes(k) || typeof v !== "string"))
    throw new Error("Invalid song settings.");
}

/** Playlists checked against the songs: unique ids and names, and entries that exist. */
export function validatePlaylists(playlists: Playlist[], songs: LibrarySong[]): void {
  const ids = new Set(songs.map((s) => s.id));
  if (new Set(playlists.map((p) => p.id)).size !== playlists.length) throw new Error("Playlist contains an invalid or missing song.");
  for (const p of playlists)
    if (!validId(p.id) || !p.name.trim() || p.name.length > 300 || p.songs.some((id) => !ids.has(id)))
      throw new Error("Playlist contains an invalid or missing song.");
}
