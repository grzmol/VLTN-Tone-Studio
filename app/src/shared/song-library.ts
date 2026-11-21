import { validateSmartRules, type SmartRules } from "./library-filter";
import { isEntryOverride, type EntryOverride } from "./entry-overrides";

/** Where a saved track came from. Legacy entries carry none: the source track is `source` and every other one a `stem`. */
export const TRACK_KINDS = ["source", "stem", "user"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];
/** The buses a track can be sent to. They match the performance outputs (see song/audio/outputs.ts). */
export const TRACK_BUSES = ["main", "click", "aux1", "aux2"] as const;
/** Mute groups are numbered 1 to MUTE_GROUPS_MAX. Tracks in the same group are exclusive: unmuting one mutes the rest. */
export const MUTE_GROUPS_MAX = 6;
/** Imported tracks per song. The song's source track is one more entry in the audio list. */
export const USER_TRACKS_MAX = 32;
/** The library's schema version. v4 adds song metadata, folders, play history, sets and smart playlists. */
export const LIBRARY_VERSION = 4 as const;
/** Play history keeps the most recent entries only, so the index stays small on a long-running rig. */
export const HISTORY_MAX = 500;
export const KEYWORDS_MAX = 20;
export const FOLDERS_MAX = 500;
export const NOTES_MAX = 2000;
/** A saved song's PDF chart and its annotations live in the song's revision folder. The app never changes the PDF itself. */
export const CHART_FILE = "chart.pdf";
export const CHART_ANNOTATIONS_FILE = "chart-annotations.json";
/** A PDF over this size is refused, so a backup keeps a sensible size. The limit is counted in the backup's byte total. */
export const CHART_PDF_MAX_BYTES = 50 * 1024 * 1024;
export const CHART_ANNOTATIONS_MAX_BYTES = 4 * 1024 * 1024;
/** The two views of a song's chart: its text chart, or its PDF. A song with no PDF always shows the text chart. */
export const CHART_VIEWS = ["pdf", "text"] as const;
export type ChartView = (typeof CHART_VIEWS)[number];
/** The settings a saved song keeps, by suffix. `:chart` is the view the performer chose (see `ChartView`). */
export const SETTING_SUFFIXES = ["", ":bpm", ":lyrics", ":options", ":chart"] as const;

/** Tracks a v1 library stored as raw float32 files, one per channel. They have no `file`; the store converts them to FLAC in the background. */
export interface LibraryAudio {
  name: string;
  sampleRate: number;
  frames: number;
  channels: number;
  /** v2: the single file holding every channel, e.g. `vocals.flac`. v3 imported tracks use `track<n>.flac`. */
  file?: string;
  codec?: "flac";
  /** v2: size of `file` in bytes. */
  bytes?: number;
  /** v2: SHA-256 of `file`, lowercase hex. */
  sha256?: string;
  /** v3: where the track came from. Missing on older saves, which read as `source` or `stem` (see `withTrackKinds`). */
  kind?: TrackKind;
  /** v3: the colour shown in the mixer, as `#rrggbb` */
  color?: string;
  /** v3: the bus the track plays on. Missing means Main. */
  bus?: (typeof TRACK_BUSES)[number];
  /** v3: whether the track follows the song's pitch shift. Missing keeps the default for the track. */
  transpose?: boolean;
  /** v3: the track's starting volume, 0 to 2. Missing means 1. */
  gain?: number;
  /** v3: the track's starting pan, -1 (left) to 1 (right). Missing means centre. */
  pan?: number;
  /** v3: the mute groups the track belongs to, 1 to MUTE_GROUPS_MAX. */
  muteGroups?: number[];
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
  /** v4: the song's key as text, such as "A minor". Entered by hand. */
  key?: string;
  /** v4: the tempo, mirrored from the song's `:bpm` setting whenever it is saved or changed. */
  bpm?: number;
  /** v4: the year the song was released or written. */
  year?: number;
  /** v4: the colour used to mark the song in the library, as `#rrggbb`. */
  color?: string;
  /** v4: words that group songs, such as "encore" or "ballad". Matched without case. */
  keywords?: string[];
  /** v4: free text about the song. */
  notes?: string;
  /** v4: the folder the song is in. Missing means the library root. */
  folderId?: string;
  /** v4: how many times the song has been played to the halfway point. */
  playCount?: number;
  /** v4: when the song was last played to the halfway point, ISO 8601. */
  lastPlayed?: string;
  /** v4: when the song was first saved, ISO 8601. Older songs take their `updated` time. */
  created?: string;
  /** v4: the song's PDF chart, stored as `chart.pdf` in its revision folder. Missing when the song has no PDF. */
  chart?: LibraryChart;
}
/** v4: a PDF chart attached to a saved song. Its annotation file is optional and is replaced whenever the annotations are saved. */
export interface LibraryChart {
  bytes: number;
  sha256: string;
  annotations?: { bytes: number; sha256: string };
}
/** The protocol URLs of a song's PDF chart and its annotation file. */
export interface ChartUrls {
  pdf: string;
  annotations?: string;
}
/** v4: a folder in the library. Folders nest without a limit; only an empty folder can be deleted. */
export interface LibraryFolder {
  id: string;
  name: string;
  /** Missing for a folder at the top level. */
  parentId?: string;
}
/** v4: one play of a song to its halfway point. The history is bounded at HISTORY_MAX entries, newest last. */
export interface HistoryEntry {
  songId: string;
  /** ISO 8601 time the song passed its halfway point. */
  at: string;
  /** The playlist set the song played in, when it played as part of one. */
  setId?: string;
}
/** v4: a headed block in a playlist. The block starts at entry `start` of the playlist and runs to the next block or the end. */
export interface PlaylistSet {
  id: string;
  name: string;
  start: number;
}
export interface Playlist {
  id: string;
  name: string;
  songs: string[];
  /** v4: headed blocks such as "Set 1" and "Encore". Missing or empty means one block. */
  sets?: PlaylistSet[];
  /** v4: a smart playlist's rules. A smart playlist holds no entries of its own; its songs are evaluated from the library. */
  smart?: SmartRules;
  /** v4: per-entry overrides, lined up with `songs`. Missing means no entry has one. See entry-overrides.ts. */
  overrides?: (EntryOverride | null)[];
}
export interface SongLibrary {
  /** 4 once any song has been saved with the v4 metadata; v1 to v3 indexes are still read and upgraded in memory. */
  version: 1 | 2 | 3 | 4;
  songs: LibrarySong[];
  playlists: Playlist[];
  folders: LibraryFolder[];
  history: HistoryEntry[];
}
/** An index as it may be stored: the folders and history of an older one are missing. Read it through `upgradeIndex`. */
export type StoredLibrary = Omit<SongLibrary, "version" | "folders" | "history"> & {
  version: 1 | 2 | 3 | 4;
  folders?: LibraryFolder[];
  history?: HistoryEntry[];
};
/** A change to the library's organisation, applied in the main process as one publish. */
export type LibraryChange =
  | { kind: "songs"; ids: string[]; patch: SongMetaPatch }
  | { kind: "folders"; folders: LibraryFolder[] }
  | { kind: "played"; id: string; at: string; setId?: string }
  | { kind: "history"; history: HistoryEntry[] };
/** Metadata to set on songs. `null` clears a field; a missing field is left as it is. */
export interface SongMetaPatch {
  key?: string | null;
  year?: number | null;
  color?: string | null;
  keywords?: string[];
  notes?: string | null;
  folderId?: string | null;
}
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
export interface LibraryPreflightSong {
  id: string;
  song?: LibrarySong;
  errors: string[];
}
export interface SongLibraryApi {
  preflight(ids: string[]): Promise<LibraryPreflightSong[]>;
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
  playlists(playlists: Playlist[]): Promise<void>;
  remove(id: string): Promise<void>;
  /** Merges the changed entries into a saved song's settings; an empty value removes one. */
  updateSettings(id: string, patch: Record<string, string>): Promise<void>;
  /** Copies the saved track settings of song `id` onto every song with the same imported tracks. Resolves with how many songs changed. */
  applyTrackSettings(id: string): Promise<number>;
  /** Applies one change to the library's organisation: song metadata, folders, a play, or the history. */
  organise(change: LibraryChange): Promise<void>;
  /** Attaches a PDF chart to a saved song, replacing an earlier one and its annotations. Refused when the bytes are not a PDF or are too large. */
  attachChart(id: string, bytes: Uint8Array): Promise<void>;
  /** Removes a song's PDF chart and its annotations. The song's audio and text chart are kept. */
  removeChart(id: string): Promise<void>;
  /** Saves the annotations of a song's PDF as JSON text. A song without a PDF refuses them. */
  saveAnnotations(id: string, json: string): Promise<void>;
  /** The `app://library` URLs of a song's PDF and annotations, or null when the song has no PDF. */
  chartUrls(id: string): Promise<ChartUrls | null>;
}
export const emptyLibrary = (): SongLibrary => ({ version: LIBRARY_VERSION, songs: [], playlists: [], folders: [], history: [] });
export const validId = (id: string): boolean => /^[a-f0-9-]{36}$/.test(id);
export const TRACK_NAMES = ["source", "drums", "bass", "other", "vocals", "guitar", "piano"];
/** Imported tracks are stored under a fixed file name, so any track name is safe on disk. */
export const USER_TRACK_FILE = /^track(3[01]|[12]\d|\d)\.flac$/;
export const assetName = (name: string, channel: number): string => `${name}-${channel}.f32`;
export const flacName = (name: string): string => `${name}.flac`;
export const userFileName = (index: number): string => `track${index}.flac`;
export const isFlacTrack = (track: LibraryAudio): boolean => track.codec === "flac";
/** Whether a file name is one a saved song may hold: a legacy track, or an imported one. */
export const isTrackFileName = (file: string): boolean => USER_TRACK_FILE.test(file) || TRACK_NAMES.some((name) => file === flacName(name));

/**
 * The key a track is known by everywhere in the player: its mix, its bus, its pitch choice and its render. It is the file's name without
 * the extension, so a legacy stem keeps its name ("drums") and an imported track keeps its own ("track3"). Raw v1 tracks use their name.
 */
export const trackKey = (track: LibraryAudio): string => (track.file ?? track.name).replace(/\.flac$/, "");

/** The track's kind, reading a save from before v3 as the source or a stem. */
export const trackKindOf = (track: LibraryAudio): TrackKind => track.kind ?? (track.name === "source" ? "source" : "stem");

/** A v2 track brought up to the v3 model. Nothing that was saved changes: only the kind is written down. */
export function withTrackKind(track: LibraryAudio): LibraryAudio {
  return track.kind === undefined ? { ...track, kind: trackKindOf(track) } : track;
}

/**
 * A song brought up to the v4 model. Nothing that was saved changes: a missing play count is 0, a missing creation time is the time it was
 * last updated, and the tempo mirrors the saved `:bpm` setting when that is a number.
 */
export function withSongDefaults(song: LibrarySong): LibrarySong {
  const bpm = Number(song.settings[":bpm"]);
  return {
    ...song,
    audio: song.audio.map(withTrackKind),
    keywords: song.keywords ?? [],
    playCount: song.playCount ?? 0,
    created: song.created ?? song.updated,
    bpm: song.bpm ?? (Number.isFinite(bpm) && bpm >= BPM_MIN && bpm <= BPM_MAX ? bpm : undefined),
  };
}

/**
 * An index read from an older version, with every song and playlist in the v4 model. The version is written on the next publish. A v4
 * index is returned as it is, unless its folders or history are missing (a damaged file), in which case they are filled in.
 */
export function upgradeIndex<T extends StoredLibrary>(index: T): T & SongLibrary {
  if (index.version === LIBRARY_VERSION && index.folders && index.history) return index as T & SongLibrary;
  return {
    ...index,
    version: LIBRARY_VERSION,
    songs: index.songs.map(withSongDefaults),
    playlists: index.playlists.map((playlist) => ({ ...playlist, sets: playlist.sets ?? [] })),
    folders: index.folders ?? [],
    history: index.history ?? [],
  };
}

/** The track settings a song saves per track, which "apply to similar songs" copies. */
const COPIED_SETTINGS = ["color", "bus", "transpose", "gain", "pan", "muteGroups"] as const;

/** The names of a song's imported tracks, sorted. Two songs with the same names are similar. */
export const userTrackNames = (song: LibrarySong): string[] =>
  song.audio
    .filter((track) => trackKindOf(track) === "user")
    .map((track) => track.name)
    .sort();

/**
 * The song `to` with the track settings of `from` copied onto its imported tracks, matched by name in order. Audio and names are left as
 * they are. Null when `to` does not have exactly the same imported track names, so nothing is copied onto a different arrangement.
 */
export function copyTrackSettings(from: LibrarySong, to: LibrarySong): LibrarySong | null {
  const names = userTrackNames(from);
  if (!names.length || names.join("\n") !== userTrackNames(to).join("\n")) return null;
  const available = from.audio.filter((track) => trackKindOf(track) === "user");
  const audio = to.audio.map((track) => {
    if (trackKindOf(track) !== "user") return track;
    const at = available.findIndex((candidate) => candidate.name === track.name);
    const source = available.splice(at, 1)[0];
    const next: LibraryAudio = { ...track };
    for (const key of COPIED_SETTINGS) delete next[key];
    for (const key of COPIED_SETTINGS) if (source[key] !== undefined) Object.assign(next, { [key]: source[key] });
    return next;
  });
  return { ...to, audio, settings: settingsWithPartChoice(from, to, names) };
}

/** The mixer names of the generated drum and bass tracks. The same names as GENERATED_PART_NAMES in the renderer's band code. */
const GENERATED_TRACK_NAMES = ["Drums (generated)", "Bass (generated)"];

/** A song's saved options, read as an object. A damaged entry counts as empty, as the renderer reads it. */
function optionsOf(song: LibrarySong): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(song.settings[":options"] || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Treated as empty.
  }
  return {};
}

/**
 * The settings of `to` with the drums and bass choice (see part-choice.ts) taken from `from`. The choice is copied only when both songs
 * have a generated part, which is when their track names match. Otherwise `to`'s choice is removed, so it never points at parts it lacks.
 */
function settingsWithPartChoice(from: LibrarySong, to: LibrarySong, shared: string[]): Record<string, string> {
  const choice = optionsOf(from).partChoice;
  const options = optionsOf(to);
  if (shared.some((name) => GENERATED_TRACK_NAMES.includes(name)) && choice !== undefined) {
    return { ...to.settings, ":options": JSON.stringify({ ...options, partChoice: choice }) };
  }
  if (!("partChoice" in options)) return to.settings;
  const kept = { ...options };
  delete kept.partChoice;
  return { ...to.settings, ":options": JSON.stringify(kept) };
}

/** The files that make up one track and the size each must have. */
export function trackFiles(track: LibraryAudio): { file: string; bytes: number; sha256?: string }[] {
  if (isFlacTrack(track)) return [{ file: track.file!, bytes: track.bytes!, sha256: track.sha256 }];
  return Array.from({ length: track.channels }, (_, c) => ({ file: assetName(track.name, c), bytes: track.frames * 4 }));
}
/** The chart files of a song, with the sizes and digests the index promises for them. */
export function chartFiles(chart: LibraryChart | undefined): { file: string; bytes: number; sha256: string }[] {
  if (!chart) return [];
  const files = [{ file: CHART_FILE, bytes: chart.bytes, sha256: chart.sha256 }];
  if (chart.annotations) files.push({ file: CHART_ANNOTATIONS_FILE, ...chart.annotations });
  return files;
}
/** Whether a file name is one a song's chart may hold: the PDF or its annotation file. */
export const isChartFileName = (file: string): boolean => file === CHART_FILE || file === CHART_ANNOTATIONS_FILE;
/** Whether the bytes start with a PDF header. The header is searched for in the first kilobyte, as readers do. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const header = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const end = Math.min(bytes.length, 1024) - header.length;
  for (let i = 0; i <= end; i++) if (header.every((b, k) => bytes[i + k] === b)) return true;
  return false;
}

/** Whether a song still has raw float32 tracks waiting to be converted. */
export const isLegacySong = (song: LibrarySong): boolean => song.audio.some((a) => !isFlacTrack(a));

const TRACK_NAME = /^[^\u0000-\u001f\u007f]{1,60}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const BPM_MIN = 20;
const BPM_MAX = 400;
const TEXT_LINE = /^[^\u0000-\u001f\u007f]*$/;

/** The optional per-track settings, checked. Nothing here can make a song unplayable: an odd value is refused, not guessed at. */
function validateTrackSettings(track: LibraryAudio): void {
  if (track.color !== undefined && !COLOUR.test(track.color)) throw new Error("Invalid track colour.");
  if (track.bus !== undefined && !(TRACK_BUSES as readonly string[]).includes(track.bus)) throw new Error("Invalid track bus.");
  if (track.transpose !== undefined && typeof track.transpose !== "boolean") throw new Error("Invalid track pitch setting.");
  if (track.gain !== undefined && (!Number.isFinite(track.gain) || track.gain < 0 || track.gain > 2)) throw new Error("Invalid track volume.");
  if (track.pan !== undefined && (!Number.isFinite(track.pan) || track.pan < -1 || track.pan > 1)) throw new Error("Invalid track pan.");
  const groups = track.muteGroups;
  if (
    groups !== undefined &&
    (!Array.isArray(groups) ||
      groups.length > MUTE_GROUPS_MAX ||
      new Set(groups).size !== groups.length ||
      groups.some((group) => !Number.isInteger(group) || group < 1 || group > MUTE_GROUPS_MAX))
  )
    throw new Error("Invalid track mute group.");
}

/**
 * The v4 song metadata, checked. Metadata can never stop a song from playing, but a value out of range is refused rather than stored, so
 * the library stays readable. Missing fields are fine: older songs have none of them.
 */
/** The metadata fields a song or a metadata patch may carry. */
export type SongMeta = Pick<LibrarySong, "key" | "bpm" | "year" | "color" | "notes" | "keywords" | "folderId" | "playCount" | "lastPlayed" | "created">;

export function validateSongMeta(meta: SongMeta): void {
  const bad = () => new Error("Invalid song details.");
  if (meta.key !== undefined && (typeof meta.key !== "string" || meta.key.length > 40 || !TEXT_LINE.test(meta.key))) throw bad();
  if (meta.bpm !== undefined && (!Number.isFinite(meta.bpm) || meta.bpm < BPM_MIN || meta.bpm > BPM_MAX)) throw bad();
  if (meta.year !== undefined && (!Number.isInteger(meta.year) || meta.year < 1000 || meta.year > 2999)) throw bad();
  if (meta.color !== undefined && !COLOUR.test(meta.color)) throw bad();
  if (meta.notes !== undefined && (typeof meta.notes !== "string" || meta.notes.length > NOTES_MAX)) throw bad();
  const keywords = meta.keywords ?? [];
  if (
    !Array.isArray(keywords) ||
    keywords.length > KEYWORDS_MAX ||
    keywords.some((word) => typeof word !== "string" || !word.trim() || word.length > 40 || !TEXT_LINE.test(word))
  )
    throw bad();
  if (meta.folderId !== undefined && !validId(meta.folderId)) throw bad();
  if (meta.playCount !== undefined && (!Number.isSafeInteger(meta.playCount) || meta.playCount < 0)) throw bad();
  if (meta.lastPlayed !== undefined && !isIsoTime(meta.lastPlayed)) throw bad();
  if (meta.created !== undefined && !isIsoTime(meta.created)) throw bad();
}

/** Whether a value is a readable ISO 8601 date or time. */
export function isIsoTime(value: unknown): boolean {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** A PDF chart checked before it is saved or read from a backup: sizes in range and digests well formed. */
export function validateChart(chart: LibraryChart): void {
  const sized = (f: { bytes: number; sha256: string }, max: number) => Number.isSafeInteger(f.bytes) && f.bytes >= 1 && f.bytes <= max && /^[a-f0-9]{64}$/.test(f.sha256);
  if (!sized(chart, CHART_PDF_MAX_BYTES)) throw new Error("Invalid chart PDF.");
  if (chart.annotations !== undefined && !sized(chart.annotations, CHART_ANNOTATIONS_MAX_BYTES)) throw new Error("Invalid chart annotations.");
}

export function validateSong(song: LibrarySong): void {
  if (!validId(song.id) || !song.title.trim() || song.title.length > 300 || !Number.isFinite(song.duration) || song.duration <= 0)
    throw new Error("Invalid saved song.");
  if (!song.audio.length || song.audio[0].name !== "source" || song.audio.length > USER_TRACKS_MAX + 1)
    throw new Error("Invalid song tracks.");
  const keys = new Set(song.audio.map(trackKey));
  // Keys are file names, so they must be unique. Imported tracks may share a name, such as two "Click" tracks.
  if (keys.size !== song.audio.length) throw new Error("Invalid song tracks.");
  if (song.audio.filter((a) => trackKindOf(a) === "user").length > USER_TRACKS_MAX) throw new Error("Invalid song tracks.");
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
    validateTrackSettings(a);
  }
  if (Object.entries(song.settings).some(([k, v]) => !(SETTING_SUFFIXES as readonly string[]).includes(k) || typeof v !== "string"))
    throw new Error("Invalid song settings.");
  if (song.settings[":chart"] !== undefined && !["", ...CHART_VIEWS].includes(song.settings[":chart"])) throw new Error("Invalid song settings.");
  if (song.chart !== undefined) validateChart(song.chart);
  validateSongMeta(song);
}

/** The folders of a library: unique ids, names, parents that exist, and no cycles. */
export function validateFolders(folders: LibraryFolder[]): void {
  if (!Array.isArray(folders) || folders.length > FOLDERS_MAX) throw new Error("Invalid folders.");
  const ids = new Set(folders.map((f) => f.id));
  if (ids.size !== folders.length) throw new Error("Invalid folders.");
  const parents = new Map(folders.map((f) => [f.id, f.parentId]));
  for (const folder of folders) {
    if (!validId(folder.id) || !folder.name.trim() || folder.name.length > 120 || !TEXT_LINE.test(folder.name)) throw new Error("Invalid folder name.");
    if (folder.parentId !== undefined && !ids.has(folder.parentId)) throw new Error("Invalid folders.");
    // Walk up from the folder; a walk that comes back to where it started, or runs longer than the list, is a cycle.
    let at = folder.parentId;
    for (let steps = 0; at !== undefined; steps++) {
      if (at === folder.id || steps > folders.length) throw new Error("A folder cannot sit inside itself.");
      at = parents.get(at);
    }
  }
}

/** The library's organisation (folders, history and song links) checked against each other. */
export function validateOrganisation(index: SongLibrary): void {
  validateFolders(index.folders);
  const folders = new Set(index.folders.map((f) => f.id));
  const songs = new Set(index.songs.map((s) => s.id));
  if (index.songs.some((s) => s.folderId !== undefined && !folders.has(s.folderId))) throw new Error("A song is in a folder that does not exist.");
  if (!Array.isArray(index.history) || index.history.length > HISTORY_MAX) throw new Error("Invalid play history.");
  for (const entry of index.history) if (!songs.has(entry.songId) || !isIsoTime(entry.at)) throw new Error("Invalid play history.");
}

/** Playlists checked against the songs: entries that exist, sets that start on an entry, and smart rules that can run. */
export function validatePlaylists(playlists: Playlist[], songs: LibrarySong[]): void {
  const ids = new Set(songs.map((s) => s.id));
  if (new Set(playlists.map((p) => p.id)).size !== playlists.length) throw new Error("Playlist contains an invalid or missing song.");
  for (const p of playlists) {
    if (!validId(p.id) || !p.name.trim() || p.name.length > 300 || p.songs.some((id) => !ids.has(id)))
      throw new Error("Playlist contains an invalid or missing song.");
    if (p.smart) {
      if (p.songs.length || p.sets?.length || p.overrides?.length) throw new Error("A smart playlist holds no entries of its own.");
      validateSmartRules(p.smart);
      continue;
    }
    validateOverrides(p);
    validateSets(p);
  }
}

/** The per-entry overrides of a static playlist: one for each entry, each well formed or null. */
function validateOverrides(playlist: Playlist): void {
  const overrides = playlist.overrides;
  if (overrides === undefined) return;
  if (!Array.isArray(overrides) || overrides.length !== playlist.songs.length || overrides.some((o) => o !== null && !isEntryOverride(o)))
    throw new Error("Invalid playlist entry settings.");
}

/** The sets of a static playlist: unique ids, names, and starts that are in range, in order and not repeated. */
function validateSets(playlist: Playlist): void {
  const sets = playlist.sets ?? [];
  if (new Set(sets.map((s) => s.id)).size !== sets.length) throw new Error("Invalid playlist sets.");
  let previous = -1;
  for (const set of sets) {
    if (!validId(set.id) || !set.name.trim() || set.name.length > 120 || !TEXT_LINE.test(set.name)) throw new Error("Invalid playlist sets.");
    if (!Number.isInteger(set.start) || set.start < 0 || set.start >= playlist.songs.length || set.start <= previous) throw new Error("Invalid playlist sets.");
    previous = set.start;
  }
}

/** A metadata change, checked. `null` clears a field, so it is checked as missing. */
export function validateSongPatch(patch: SongMetaPatch): void {
  if (!patch || typeof patch !== "object") throw new Error("Invalid song details.");
  validateSongMeta({
    key: patch.key ?? undefined,
    year: patch.year ?? undefined,
    color: patch.color ?? undefined,
    notes: patch.notes ?? undefined,
    folderId: patch.folderId ?? undefined,
    keywords: patch.keywords,
  });
}
