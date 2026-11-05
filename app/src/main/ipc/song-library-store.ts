import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { exportBackup, readBackup, readBackupIndex } from "./song-library-backup";
import { createTrash, sweepLibraryTrash, type TrashFn } from "./trash";
import { decodeFlac, encodeFlac, matchesQuantized, storedBits } from "@shared/flac";
import {
  CONVERTED_PHASE,
  CONVERTING_PHASE,
  CHART_ANNOTATIONS_FILE,
  CHART_ANNOTATIONS_MAX_BYTES,
  CHART_FILE,
  CHART_PDF_MAX_BYTES,
  LIBRARY_VERSION,
  assetName,
  chartFiles,
  emptyLibrary,
  isChartFileName,
  isPdfBytes,
  validateChart,
  flacName,
  isFlacTrack,
  isIsoTime,
  isLegacySong,
  copyTrackSettings,
  isTrackFileName,
  trackFiles,
  trackKey,
  trackKindOf,
  upgradeIndex,
  validId,
  validateFolders,
  validateOrganisation,
  validatePlaylists,
  validateSong,
  validateSongPatch,
  type LibraryChange,
  type ChartUrls,
  type LibraryChart,
  type LibraryFolder,
  type LibrarySong,
  type Playlist,
  type SongLibrary,
  type SongMetaPatch,
  type StoredLibrary,
  type LibraryTransferProgress,
  type LibraryBackupPreview,
  type RestoreMode,
} from "@shared/song-library";
import { HISTORY_MAX, type HistoryEntry } from "@shared/song-library";
import { appendPlay, withoutSong } from "@shared/library-history";
import { removeEntry } from "@shared/playlist-sets";
import { isStringList } from "@shared/library-filter";
import { validateAnnotations } from "@shared/chart-annotations";
import { syncPath, writeJsonAtomic } from "./fs-atomic";

export type DiskIndex = SongLibrary & { revisions: Record<string, string> };
/**
 * Where the library keeps the v1 copy after conversion: the v1 index and each converted song's old folder, under its old name, so the old
 * index still finds it. The name is not a song id, so the sweep and the index never treat it as a song.
 */
export const V1_BACKUP = "v1-backup";
/**
 * Written into a song's folder just before it goes to the Trash, holding the song's index entry. A folder put back from the Trash is
 * in no index, so this lets the sweep recognise it and add the song again instead of deleting it.
 */
export const SONG_MARKER = "song.json";
const V1_README = `This folder is a copy of your song library from before it moved to compressed audio (library version 1).

  library.json        the old index
  <folder names>      each song's old audio, under the name the old index uses

Your songs play from the converted copies in the library. Nothing here is needed for them.
The copy is the library as it was on the first launch of the new version. Songs changed since then are not in it.

To go back to the old library:
  1. Quit VLTN Tone Studio.
  2. Move library.json and the song folders from this folder into the song library folder, the one that holds this v1-backup folder.
     Replace the current library.json. Keep the folder names the same.
  3. Open the library with an older release that reads version 1 libraries.

To delete this copy, use Settings > Library > Remove the old library copy. Nothing is deleted until you do that.
`;
/** A v1 audio file: one raw float32 file per channel. The sweep keeps folders that hold them. */
const isV1Audio = (name: string): boolean => name.endsWith(".f32");
const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );
/** The size of every file under `dir`, in bytes. */
async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? await folderBytes(path) : (await stat(path)).size;
  }
  return total;
}
/** A save session or staging folder older than this is abandoned: the renderer crashed or the user gave up. */
export const ORPHAN_AGE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** Songs with the same source audio are the same song. Older saves and raw-float songs carry no digest and never match. */
export const contentHash = (song: LibrarySong): string | undefined => song.audio.find((a) => a.name === "source")?.sha256;
/** The tempo a song's saved settings hold, when it is a usable number. The library keeps it in the song's details for sorting. */
export function tempoOf(settings: Record<string, string>): number | undefined {
  const bpm = Number(settings[":bpm"]);
  return Number.isFinite(bpm) && bpm >= 20 && bpm <= 400 ? bpm : undefined;
}

/** The song with a metadata change applied. A field the patch leaves out is kept; `null` clears it. */
function applyMetaPatch(song: LibrarySong, patch: SongMetaPatch, updated: string): LibrarySong {
  const pick = <T,>(value: T | null | undefined, current: T | undefined): T | undefined => (value === undefined ? current : (value ?? undefined));
  return {
    ...song,
    key: pick(patch.key, song.key),
    year: pick(patch.year, song.year),
    color: pick(patch.color, song.color),
    notes: pick(patch.notes, song.notes),
    folderId: pick(patch.folderId, song.folderId),
    keywords: patch.keywords ?? song.keywords,
    updated,
  };
}

/** Fields a saved song carries that the renderer's save does not send back. A re-save keeps them rather than dropping them. */
const KEPT_ON_SAVE = ["key", "year", "color", "notes", "folderId", "keywords", "playCount", "lastPlayed", "chart"] as const;

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const CHART_TOO_LARGE = "This PDF is larger than 50 MB. Choose a smaller file, or export the chart to a smaller PDF.";

/**
 * Copies a song's chart files from one revision folder to another. A re-save or a format conversion builds a new revision folder, so the
 * PDF and its annotations are carried across here. A missing file throws, so a save never drops a chart silently.
 */
async function carryChart(from: string, to: string, chart: LibraryChart | undefined): Promise<void> {
  for (const { file } of chartFiles(chart)) await copyFile(join(from, file), join(to, file));
}

/**
 * The song being saved, with the details it does not carry (the library's own counts and notes) taken from the saved copy. The creation
 * time is the first save's, so re-saving never makes an old song look new.
 */
function keepSavedDetails(saved: LibrarySong | undefined, song: LibrarySong, now: string): LibrarySong {
  const next: LibrarySong = { ...song, created: saved?.created ?? song.created ?? now };
  if (!saved) return next;
  for (const key of KEPT_ON_SAVE) if (next[key] === undefined && saved[key] !== undefined) Object.assign(next, { [key]: saved[key] });
  return next;
}

/** The folders in `ids` and every folder above them, so a folder kept on its own still has its parents. */
function withAncestors(folders: readonly LibraryFolder[], ids: readonly string[]): Set<string> {
  const parents = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  const kept = new Set<string>();
  for (const start of ids) {
    let id: string | undefined = start;
    for (let steps = 0; id !== undefined && !kept.has(id) && steps <= folders.length; steps++) {
      kept.add(id);
      id = parents.get(id);
    }
  }
  return kept;
}

/** A smart playlist's folder rules, with the folder ids of a restore. A folder not in the map keeps its id. */
function remapFolderRules(smart: NonNullable<Playlist["smart"]>, folderIds: Map<string, string>): NonNullable<Playlist["smart"]> {
  return {
    ...smart,
    rules: smart.rules.map((rule) =>
      rule.field === "folder" && isStringList(rule.value) ? { ...rule, value: rule.value.map((id) => folderIds.get(id) ?? id) } : rule,
    ),
  };
}

/** Audio is staged before publishing a new index. An interrupted save leaves the previous song intact. */
export class SongLibraryStore {
  private pending = new Map<string, { song: LibrarySong; created: number }>();
  /** Folders being written by a conversion, which runs outside `serial()`. The sweep must not take them. */
  private converting = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private sweeper: ReturnType<typeof setInterval> | undefined;
  constructor(
    private root: string,
    private now: () => number = Date.now,
    /** Takes a deleted song or its PDF out of the library. Desktop passes the OS Trash; the default keeps it in `<root>/.trash`. */
    private trash: TrashFn = createTrash(root),
  ) {}
  /** Sweeps now and then every 10 minutes. The library's Trash is emptied of 30-day-old entries once, at start-up. */
  startSweeping(): void {
    void sweepLibraryTrash(this.root).catch((e) => console.error("Song library trash sweep failed", e));
    const sweep = () => void this.sweep().catch((e) => console.error("Song library sweep failed", e));
    // The first sweep runs at start-up, queued before the v1 conversion, so it clears a conversion's leftovers first.
    void this.sweep(true).catch((e) => console.error("Song library sweep failed", e));
    this.sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }
  stopSweeping(): void {
    clearInterval(this.sweeper);
  }
  /**
   * Drops save sessions older than an hour and deletes folders in the library root that no revision refers to. Runs inside `serial()`, so no
   * commit or restore is publishing while it looks, and only deletes what is also older than an hour, so a fresh save is never touched.
   *
   * At start-up (`startup`), an unreferenced folder that is empty or holds only partial or temporary files is removed whatever its age:
   * that is what a conversion killed part-way leaves. Folders holding v1 audio are never removed here, and `v1-backup` is never a revision.
   */
  async sweep(startup = false): Promise<void> {
    return this.serial(async () => {
      const cutoff = this.now() - ORPHAN_AGE_MS;
      for (const [token, { created }] of this.pending) {
        if (created > cutoff) continue;
        this.pending.delete(token);
        await rm(join(this.root, token), { recursive: true, force: true }).catch(() => {});
      }
      let index: DiskIndex, names: string[];
      try {
        index = await this.read();
        names = await readdir(this.root);
      } catch {
        return;
      }
      const live = new Set(Object.values(index.revisions));
      for (const name of names) {
        const folder = validId(name) || name.startsWith(".restore-"),
          temp = name.startsWith("index-") && name.endsWith(".tmp");
        if ((!folder && !temp) || live.has(name) || this.pending.has(name) || this.converting.has(name)) continue;
        const path = join(this.root, name);
        if (folder) {
          const entries = await readdir(path).catch(() => null);
          if (!entries || entries.some(isV1Audio)) continue;
          if (entries.includes(SONG_MARKER) && (await this.readopt(index, name))) {
            live.add(name);
            continue;
          }
          const junk = entries.every((e) => e.endsWith(".tmp") || e.endsWith(".partial"));
          if (startup && junk) {
            await rm(path, { recursive: true, force: true }).catch(() => {});
            continue;
          }
        }
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs <= cutoff) await rm(path, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
  /**
   * Adds back a song whose folder was put back from the Trash: the folder holds the song's entry (see `SONG_MARKER`), every file it lists is
   * there at its size, and the library does not already hold a song with that id. Publishes the index, then removes the marker.
   */
  private async readopt(index: DiskIndex, folder: string): Promise<boolean> {
    try {
      const path = join(this.root, folder);
      const song = JSON.parse(await readFile(join(path, SONG_MARKER), "utf8")) as LibrarySong;
      validateSong(song);
      if (index.songs.some((s) => s.id === song.id) || !song.audio.every(isFlacTrack)) return false;
      for (const track of song.audio)
        for (const { file, bytes } of trackFiles(track)) if ((await stat(join(path, file))).size !== bytes) return false;
      index.songs = [...index.songs, song];
      index.revisions[song.id] = folder;
      await this.publish(index);
      await rm(join(path, SONG_MARKER), { force: true });
      return true;
    } catch {
      return false;
    }
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(fn, fn);
    this.tail = job.catch(() => {});
    return job;
  }
  private async read(): Promise<DiskIndex> {
    try {
      const index = JSON.parse(await readFile(join(this.root, "library.json"), "utf8")) as StoredLibrary & { revisions: Record<string, string> };
      if (![1, 2, 3, 4].includes(index.version) || !index.revisions) throw new Error("Unsupported song library.");
      // An older index gets the v4 model in memory; the next publish writes it back as v4.
      return upgradeIndex(index);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ...emptyLibrary(), revisions: {} };
      throw e;
    }
  }
  private async publish(index: DiskIndex): Promise<void> {
    await mkdir(this.root, { recursive: true });
    // A v4 library is refused by older apps, which would otherwise misread the metadata and folders. See SONG-LIBRARY.md.
    await writeJsonAtomic(join(this.root, "library.json"), { ...index, version: LIBRARY_VERSION });
  }
  async preflight(ids: string[]): Promise<import("@shared/song-library").LibraryPreflightSong[]> {
    if (!Array.isArray(ids) || ids.length > 10000 || ids.some((id) => typeof id !== "string" || !validId(id))) throw new Error("Invalid playlist song IDs.");
    return this.serial(async () => {
      const index = await this.read();
      const results: import("@shared/song-library").LibraryPreflightSong[] = [];
      for (const id of new Set(ids)) {
        const song = index.songs.find((s) => s.id === id),
          errors: string[] = [];
        if (!song) {
          results.push({ id, errors: ["Song is missing from the library."] });
          continue;
        }
        try {
          validateSong(song);
        } catch {
          results.push({ id, errors: ["Saved song metadata is invalid."] });
          continue;
        }
        const revision = index.revisions[id];
        if (!revision || !validId(revision)) errors.push("Saved audio revision is missing.");
        else
          for (const track of song.audio)
            for (const { file, bytes } of trackFiles(track)) {
              try {
                const info = await stat(join(this.root, revision, file));
                if (!info.isFile() || info.size !== bytes) errors.push(`${file}: audio file has an invalid size or type.`);
              } catch {
                errors.push(`${file}: audio file is missing or inaccessible.`);
              }
            }
        results.push({ id, song, errors });
      }
      return results;
    });
  }
  async index(): Promise<SongLibrary> {
    const { revisions: _, ...index } = await this.read();
    return index;
  }
  async begin(song: LibrarySong): Promise<string> {
    // The tempo follows the song's saved setting, so the library's copy never drifts from the song's own.
    song = { ...song, bpm: tempoOf(song.settings) };
    validateSong(song);
    if (!song.audio.every(isFlacTrack)) throw new Error("Songs are saved as FLAC.");
    const token = randomUUID();
    await mkdir(join(this.root, token), { recursive: true });
    this.pending.set(token, { song, created: this.now() });
    return token;
  }
  async write(token: string, name: string, bytes: Uint8Array): Promise<void> {
    const song = this.pending.get(token)?.song;
    const track = song?.audio.find((a) => a.file === name);
    if (!track || bytes.byteLength !== track.bytes || createHash("sha256").update(bytes).digest("hex") !== track.sha256)
      throw new Error("Invalid song audio asset.");
    await writeFile(join(this.root, token, name), bytes);
  }
  async commit(token: string): Promise<void> {
    return this.serial(async () => {
      const song = this.pending.get(token)?.song;
      if (!song) throw new Error("Save session expired.");
      const index = await this.read();
      const old = index.revisions[song.id];
      const saved = index.songs.find((s) => s.id === song.id);
      await this.carryAudio(token, song, old && validId(old) ? old : undefined, saved);
      for (const a of song.audio) {
        if ((await stat(join(this.root, token, a.file!))).size !== a.bytes) throw new Error("Incomplete song save.");
      }
      // Every file of the new revision, and the folder holding them, is on disk before the index points at it. The old revision stays until then.
      const folder = join(this.root, token);
      for (const name of await readdir(folder)) await syncPath(join(folder, name));
      await syncPath(folder);
      const kept = keepSavedDetails(saved, song, new Date().toISOString());
      validateSong(kept);
      if (old && validId(old)) await carryChart(join(this.root, old), join(this.root, token), kept.chart);
      index.songs = [...index.songs.filter((s) => s.id !== song.id), kept];
      index.revisions[song.id] = token;
      await this.publish(index);
      this.pending.delete(token);
      if (old && validId(old)) await rm(join(this.root, old), { recursive: true, force: true }).catch(() => {});
    });
  }
  /**
   * Puts into the new revision each track the save did not send, because its audio did not change. The file comes from the song's current
   * revision: a hard link where the disk allows it, a copy otherwise. Its size and SHA-256 must match the index, so a file that is missing
   * or changed fails the save instead of saving a broken song.
   */
  private async carryAudio(token: string, song: LibrarySong, old: string | undefined, saved: LibrarySong | undefined): Promise<void> {
    for (const a of song.audio) {
      const target = join(this.root, token, a.file!);
      if (await exists(target)) continue;
      const previous = saved?.audio.find((p) => p.file === a.file);
      if (!old || !previous || previous.sha256 !== a.sha256 || previous.bytes !== a.bytes) throw new Error("Incomplete song save.");
      const from = join(this.root, old, a.file!);
      await link(from, target).catch(() => copyFile(from, target)).catch(() => {
        throw new Error("Incomplete song save.");
      });
      const bytes = await readFile(target);
      if (bytes.byteLength !== a.bytes || sha256Hex(bytes) !== a.sha256) throw new Error("Incomplete song save.");
    }
  }
  async abort(token: string): Promise<void> {
    if (!this.pending.delete(token) || !validId(token)) return;
    await rm(join(this.root, token), { recursive: true, force: true });
  }
  /** The renderer fetches these straight from the `app` protocol, so audio never travels over IPC. */
  async audioUrls(id: string): Promise<Record<string, string>> {
    return this.serial(async () => {
      const index = await this.read(),
        song = index.songs.find((s) => s.id === id),
        rev = index.revisions[id];
      if (!song || !rev || !validId(rev)) throw new Error("Song audio not found.");
      if (isLegacySong(song)) throw new Error("This song is still being converted to the compact library format. Try again in a moment.");
      return Object.fromEntries(song.audio.map((a) => [trackKey(a), `app://library/${rev}/${a.file}`]));
    });
  }
  async playlists(playlists: Playlist[]): Promise<void> {
    return this.serial(async () => {
      const index = await this.read();
      validatePlaylists(playlists, index.songs);
      index.playlists = playlists;
      await this.publish(index);
    });
  }
  /**
   * Copies the track settings of song `id` onto every other song with the same imported tracks. Only the saved settings change, never the
   * audio, so this publishes one index and no files. Resolves with how many songs changed.
   */
  async applyTrackSettings(id: string): Promise<number> {
    if (!validId(id)) throw new Error("Saved song not found.");
    return this.serial(async () => {
      const index = await this.read(),
        from = index.songs.find((s) => s.id === id);
      if (!from) throw new Error("Saved song not found.");
      const now = new Date().toISOString();
      let changed = 0;
      index.songs = index.songs.map((song) => {
        if (song.id === id) return song;
        const copied = copyTrackSettings(from, song);
        if (!copied) return song;
        changed++;
        const updated = { ...copied, updated: now };
        validateSong(updated);
        return updated;
      });
      if (changed) await this.publish(index);
      return changed;
    });
  }
  /**
   * Applies one change to the library's organisation in a single publish: song details, the folders, a play, or the history. Everything
   * is checked against the whole index before it is written, so a bad change leaves the library as it was.
   */
  async organise(change: LibraryChange): Promise<void> {
    if (!change || typeof change !== "object") throw new Error("Invalid library change.");
    return this.serial(async () => {
      const index = await this.read();
      switch (change.kind) {
        case "songs": {
          if (!Array.isArray(change.ids) || change.ids.length > 10000 || change.ids.some((id) => !validId(id))) throw new Error("Invalid song details.");
          validateSongPatch(change.patch);
          const ids = new Set(change.ids);
          const now = new Date().toISOString();
          index.songs = index.songs.map((song) => (ids.has(song.id) ? applyMetaPatch(song, change.patch, now) : song));
          break;
        }
        case "folders": {
          validateFolders(change.folders);
          const kept = new Set(change.folders.map((f) => f.id));
          for (const folder of index.folders) {
            if (kept.has(folder.id)) continue;
            if (index.songs.some((song) => song.folderId === folder.id)) throw new Error("Only an empty folder can be deleted.");
          }
          index.folders = change.folders;
          break;
        }
        case "played": {
          if (!validId(change.id) || !isIsoTime(change.at) || (change.setId !== undefined && !validId(change.setId))) throw new Error("Invalid play.");
          // A song removed while it was playing is simply not counted; the play is not an error.
          if (!index.songs.some((song) => song.id === change.id)) return;
          const entry: HistoryEntry = change.setId ? { songId: change.id, at: change.at, setId: change.setId } : { songId: change.id, at: change.at };
          index.history = appendPlay(index.history, entry);
          index.songs = index.songs.map((song) =>
            song.id === change.id ? { ...song, playCount: (song.playCount ?? 0) + 1, lastPlayed: change.at } : song,
          );
          break;
        }
        case "history": {
          if (!Array.isArray(change.history) || change.history.length > HISTORY_MAX) throw new Error("Invalid play history.");
          index.history = change.history;
          break;
        }
        default:
          throw new Error("Invalid library change.");
      }
      validateOrganisation(index);
      await this.publish(index);
    });
  }
  /** Merges the changed entries into the song's settings. An empty value removes the entry. */
  async updateSettings(id: string, patch: Record<string, string>): Promise<void> {
    if (!validId(id) || !patch || typeof patch !== "object" || Object.values(patch).some((v) => typeof v !== "string"))
      throw new Error("Invalid song settings.");
    return this.serial(async () => {
      const index = await this.read(),
        song = index.songs.find((s) => s.id === id);
      if (!song) throw new Error("Saved song not found.");
      const merged = Object.fromEntries(Object.entries({ ...song.settings, ...patch }).filter(([, value]) => value));
      // The tempo is kept in the song's details too, so the library can sort and search by it.
      const updated = { ...song, settings: merged, bpm: tempoOf(merged), updated: new Date().toISOString() };
      validateSong(updated);
      index.songs = index.songs.map((s) => (s.id === id ? updated : s));
      await this.publish(index);
    });
  }
  async exportBackup(path: string, progress?: (p: LibraryTransferProgress) => void): Promise<{ songs: number; playlists: number }> {
    return this.serial(async () => {
      const index = await this.read();
      // Materialize the empty index too, so even an empty backup has a complete format.
      await this.publish(index);
      await exportBackup(this.root, index, path, progress);
      return { songs: index.songs.length, playlists: index.playlists.length };
    });
  }
  /** Reads just the library index of a backup, so the user can choose how to restore before any audio is extracted. */
  async inspectBackup(path: string): Promise<Omit<LibraryBackupPreview, "fileName">> {
    const backup = await readBackupIndex(path),
      known = new Set((await this.serial(() => this.read())).songs.map(contentHash).filter(Boolean));
    const duplicates = backup.songs.filter((song) => known.has(contentHash(song))).length;
    return { songs: backup.songs.length, playlists: backup.playlists.length, duplicates };
  }
  /**
   * "copy" gives every song and playlist in the backup a new ID. "skip" leaves out songs whose source audio is already in the library, points
   * playlist entries at the existing songs, and leaves out playlists that already exist with the same name and songs.
   */
  async restoreBackup(
    path: string,
    progress?: (p: LibraryTransferProgress) => void,
    mode: RestoreMode = "copy",
  ): Promise<{ songs: number; playlists: number; skipped?: number }> {
    const result = await this.restoreSongs(path, progress, mode);
    // Songs a v1 backup brought back are converted now, with progress, so they open without waiting for a restart. A song that fails
    // stays as it was and is tried again at the next start; the restore itself has succeeded.
    await this.migrate(progress).catch((e) => console.error("Song library conversion failed", e));
    return result;
  }
  private async restoreSongs(
    path: string,
    progress: ((p: LibraryTransferProgress) => void) | undefined,
    mode: RestoreMode,
  ): Promise<{ songs: number; playlists: number; skipped?: number }> {
    return this.serial(async () => {
      const stage = join(this.root, ".restore-" + randomUUID()),
        moved: string[] = [];
      try {
        const backup = await readBackup(path, stage, progress),
          current = await this.read();
        const existing = new Map<string, string>();
        if (mode === "skip") for (const song of current.songs) if (contentHash(song)) existing.set(contentHash(song)!, song.id);
        const ids = new Map<string, string>(),
          fresh: LibrarySong[] = [];
        for (const song of backup.songs) {
          const same = existing.get(contentHash(song) ?? "");
          if (same) ids.set(song.id, same);
          else {
            ids.set(song.id, randomUUID());
            fresh.push(song);
          }
        }
        const revisions: Record<string, string> = { ...current.revisions };
        for (const song of fresh) {
          const revision = randomUUID(),
            target = join(this.root, revision);
          await rename(join(stage, backup.revisions[song.id]), target);
          moved.push(target);
          revisions[ids.get(song.id)!] = revision;
        }
        // Folders get new ids, so a restore never merges into a folder of the same id. Skip mode brings back only the folders the restored
        // songs are in, and their parents, so a skipped song does not leave empty folders behind.
        const needed = mode === "skip" ? withAncestors(backup.folders, fresh.map((song) => song.folderId).filter((id): id is string => !!id)) : null;
        const folderIds = new Map<string, string>();
        for (const folder of backup.folders) if (!needed || needed.has(folder.id)) folderIds.set(folder.id, randomUUID());
        const folders: LibraryFolder[] = backup.folders
          .filter((folder) => folderIds.has(folder.id))
          .map((folder) => ({ id: folderIds.get(folder.id)!, name: folder.name, ...(folder.parentId ? { parentId: folderIds.get(folder.parentId) } : {}) }));
        const songs = fresh.map((song) => ({
          ...song,
          id: ids.get(song.id)!,
          folderId: song.folderId ? folderIds.get(song.folderId) : undefined,
        }));
        let playlists = backup.playlists.map((playlist) => ({
          ...playlist,
          id: randomUUID(),
          songs: playlist.songs.map((id) => ids.get(id)!),
          ...(playlist.smart ? { smart: remapFolderRules(playlist.smart, folderIds) } : {}),
        }));
        if (mode === "skip") {
          const key = (p: Playlist) => JSON.stringify([p.name, p.songs]);
          const have = new Set(current.playlists.map(key));
          playlists = playlists.filter((p) => !have.has(key(p)));
        }
        const history = backup.history.map((entry) => ({ ...entry, songId: ids.get(entry.songId)! }));
        const next: DiskIndex = {
          version: LIBRARY_VERSION,
          songs: [...current.songs, ...songs],
          playlists: [...current.playlists, ...playlists],
          folders: [...current.folders, ...folders],
          history: [...current.history, ...history].slice(-HISTORY_MAX),
          revisions,
        };
        validateOrganisation(next);
        validatePlaylists(next.playlists, next.songs);
        await this.publish(next);
        moved.length = 0;
        const result = { songs: songs.length, playlists: playlists.length };
        return mode === "skip" ? { ...result, skipped: backup.songs.length - songs.length } : result;
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(() => {});
        for (const path of moved) await rm(path, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
  /**
   * Converts v1 songs (raw float32 per channel) to FLAC, one song at a time. The v1 revision stays on disk until the FLAC revision has been
   * decoded back and compared sample for sample, so an interruption or a failure leaves the song playable. Running it again resumes.
   */
  async migrate(progress: (p: LibraryTransferProgress) => void = () => {}): Promise<{ converted: number; failed: number }> {
    const todo = (await this.serial(() => this.read())).songs.filter(isLegacySong).map((s) => s.id);
    if (todo.length) await this.keepV1Index();
    let converted = 0,
      failed = 0;
    for (const id of todo) {
      progress({ phase: CONVERTING_PHASE, completed: converted + failed, total: todo.length });
      try {
        if (await this.migrateSong(id)) converted++;
      } catch {
        failed++;
      }
    }
    if (todo.length) progress({ phase: CONVERTED_PHASE, completed: todo.length, total: todo.length });
    return { converted, failed };
  }
  /**
   * Keeps the v1 index before the first conversion writes anything, and a README beside it. Kept once: a later run after an interruption
   * must not overwrite the index that was on disk before any conversion.
   */
  private async keepV1Index(): Promise<void> {
    const dir = join(this.root, V1_BACKUP);
    await mkdir(dir, { recursive: true });
    if (!(await exists(join(dir, "library.json")))) await copyFile(join(this.root, "library.json"), join(dir, "library.json"));
    if (!(await exists(join(dir, "README.txt")))) await writeFile(join(dir, "README.txt"), V1_README);
  }
  private async migrateSong(id: string): Promise<boolean> {
    const { song, revision } = await this.serial(async () => {
      const index = await this.read(),
        found = index.songs.find((s) => s.id === id);
      return { song: found, revision: index.revisions[id] };
    });
    if (!song || !isLegacySong(song) || !validId(revision ?? "")) return false;
    const target = randomUUID(),
      audio: LibrarySong["audio"] = [];
    await mkdir(join(this.root, target), { recursive: true });
    this.converting.add(target);
    try {
      for (const track of song.audio) {
        if (isFlacTrack(track)) {
          audio.push(track);
          continue;
        }
        const channels: Float32Array[] = [];
        for (let c = 0; c < track.channels; c++) {
          const raw = await readFile(join(this.root, revision, assetName(track.name, c)));
          if (raw.byteLength !== track.frames * 4) throw new Error("Damaged saved audio.");
          channels.push(new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
        }
        // v1 saves do not record the original file's depth, so the source is stored at 16 bits (see `storedBits`).
        const bits = storedBits(trackKindOf(track));
        const bytes = await encodeFlac({ sampleRate: track.sampleRate, channels, bits });
        const check = await decodeFlac(bytes);
        // The check compares against the integers that were written, so the 16-bit dither is part of the expected value.
        if (!matchesQuantized(check, channels, bits) || check.sampleRate !== track.sampleRate) throw new Error("Converted audio did not match the original.");
        await writeFile(join(this.root, target, flacName(track.name)), bytes);
        audio.push({ ...track, file: flacName(track.name), codec: "flac", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      return await this.serial(async () => {
        const index = await this.read(),
          now = index.songs.find((s) => s.id === id);
        // The song may have been replaced or removed while it was being converted. Settings edits are kept; only the audio changes.
        if (!now || index.revisions[id] !== revision) throw new Error("Song changed during conversion.");
        await carryChart(join(this.root, revision), join(this.root, target), now.chart);
        index.songs = index.songs.map((s) => (s.id === id ? { ...now, audio } : s));
        index.revisions[id] = target;
        await this.publish(index);
        // The published song no longer needs the v1 folder, but the copy stays for a way back. The move cannot fail the conversion: the song
        // is already converted, and a folder left behind is kept by the sweep.
        await rename(join(this.root, revision), join(this.root, V1_BACKUP, revision)).catch((e) => console.error("Could not move the v1 copy to v1-backup", e));
        return true;
      });
    } catch (e) {
      await rm(join(this.root, target), { recursive: true, force: true }).catch(() => {});
      throw e;
    } finally {
      this.converting.delete(target);
    }
  }
  /**
   * Attaches a PDF chart to a saved song. The PDF is staged in the revision folder and renamed into place, so an earlier PDF is put back if
   * the index cannot be published. The song's annotations belonged to the earlier PDF, so they are removed.
   */
  async attachChart(id: string, bytes: Uint8Array): Promise<void> {
    if (!validId(id)) throw new Error("Saved song not found.");
    if (!ArrayBuffer.isView(bytes) || !bytes.byteLength) throw new Error("Choose a PDF file.");
    if (bytes.byteLength > CHART_PDF_MAX_BYTES) throw new Error(CHART_TOO_LARGE);
    if (!isPdfBytes(bytes)) throw new Error("This file is not a PDF.");
    const chart: LibraryChart = { bytes: bytes.byteLength, sha256: sha256Hex(bytes) };
    validateChart(chart);
    return this.serial(async () => {
      const index = await this.read(),
        rev = index.revisions[id];
      if (!index.songs.some((s) => s.id === id) || !validId(rev ?? "")) throw new Error("Saved song not found.");
      const dir = join(this.root, rev),
        staged = join(dir, `chart-${randomUUID()}.tmp`),
        previous = join(dir, `chart-previous-${randomUUID()}.tmp`);
      await writeFile(staged, bytes);
      const hadPdf = await rename(join(dir, CHART_FILE), previous).then(
        () => true,
        () => false,
      );
      try {
        await rename(staged, join(dir, CHART_FILE));
        index.songs = index.songs.map((s) => (s.id === id ? { ...s, chart } : s));
        await this.publish(index);
      } catch (e) {
        await rm(join(dir, CHART_FILE), { force: true }).catch(() => {});
        if (hadPdf) await rename(previous, join(dir, CHART_FILE)).catch(() => {});
        throw e;
      } finally {
        await rm(staged, { force: true }).catch(() => {});
      }
      await rm(previous, { force: true }).catch(() => {});
      await rm(join(dir, CHART_ANNOTATIONS_FILE), { force: true }).catch(() => {});
    });
  }
  /** Removes a song's PDF and its annotations. The index is published first, so the song never points at a file that is gone. */
  async removeChart(id: string): Promise<void> {
    if (!validId(id)) throw new Error("Saved song not found.");
    return this.serial(async () => {
      const index = await this.read(),
        song = index.songs.find((s) => s.id === id),
        rev = index.revisions[id];
      if (!song) throw new Error("Saved song not found.");
      if (!song.chart) return;
      index.songs = index.songs.map((s) => {
        if (s.id !== id) return s;
        const { chart: _, ...rest } = s;
        return rest;
      });
      await this.publish(index);
      if (validId(rev ?? ""))
        for (const { file } of chartFiles(song.chart)) await this.trash(join(this.root, rev, file)).catch(() => {});
    });
  }
  /**
   * Saves the annotations of a song's PDF. The text is checked before anything is written, and it is refused without a PDF. The index holds
   * the file's size and digest, so a backup can check it like any other saved file.
   */
  async saveAnnotations(id: string, json: string): Promise<void> {
    if (!validId(id) || typeof json !== "string") throw new Error("Saved song not found.");
    const bytes = Buffer.from(json, "utf8");
    if (bytes.length > CHART_ANNOTATIONS_MAX_BYTES) throw new Error("The annotations are too large to save.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("Invalid chart annotations.");
    }
    validateAnnotations(parsed);
    return this.serial(async () => {
      const index = await this.read(),
        song = index.songs.find((s) => s.id === id),
        rev = index.revisions[id];
      if (!song || !validId(rev ?? "")) throw new Error("Saved song not found.");
      if (!song.chart) throw new Error("Attach a PDF chart before annotating it.");
      const temp = join(this.root, rev, `annotations-${randomUUID()}.tmp`);
      await writeFile(temp, bytes);
      await rename(temp, join(this.root, rev, CHART_ANNOTATIONS_FILE)).catch(async (e) => {
        await rm(temp, { force: true }).catch(() => {});
        throw e;
      });
      index.songs = index.songs.map((s) => (s.id === id ? { ...s, chart: { ...s.chart!, annotations: { bytes: bytes.length, sha256: sha256Hex(bytes) } } } : s));
      await this.publish(index);
    });
  }
  /** The protocol URLs of a song's PDF and its annotations. Null when the song has no PDF. */
  async chartUrls(id: string): Promise<ChartUrls | null> {
    if (!validId(id)) return null;
    return this.serial(async () => {
      const index = await this.read(),
        song = index.songs.find((s) => s.id === id),
        rev = index.revisions[id];
      if (!song?.chart || !validId(rev ?? "")) return null;
      return {
        pdf: `app://library/${rev}/${CHART_FILE}`,
        ...(song.chart.annotations ? { annotations: `app://library/${rev}/${CHART_ANNOTATIONS_FILE}` } : {}),
      };
    });
  }
  /** The size of the v1 copy in bytes, or null when there is none to remove. */
  async v1BackupBytes(): Promise<number | null> {
    return this.serial(async () => {
      const dir = join(this.root, V1_BACKUP);
      return (await exists(dir)) ? folderBytes(dir) : null;
    });
  }
  /** Moves the v1 copy to the Trash, the OS Trash on desktop. Songs are not affected: they play from their converted copies. */
  async removeV1Backup(): Promise<void> {
    return this.serial(async () => {
      await this.trash(join(this.root, V1_BACKUP));
    });
  }
  async remove(id: string): Promise<void> {
    return this.serial(async () => {
      const index = await this.read(),
        rev = index.revisions[id],
        removed = index.songs.find((s) => s.id === id);
      index.songs = index.songs.filter((s) => s.id !== id);
      // Each entry that was the removed song is taken out, and any set heading that pointed past it moves with it.
      index.playlists = index.playlists.map((playlist) => {
        let next = playlist;
        for (let i = playlist.songs.length - 1; i >= 0; i--) if (next.songs[i] === id) next = { ...next, ...removeEntry(next, i) };
        return next;
      });
      delete index.revisions[id];
      index.history = withoutSong(index.history, id);
      await this.publish(index);
      if (rev && validId(rev)) {
        // Best effort: without the marker the folder still goes to the Trash, it just cannot be put back.
        if (removed) await writeJsonAtomic(join(this.root, rev, SONG_MARKER), removed).catch(() => {});
        await this.trash(join(this.root, rev)).catch(() => {});
      }
    });
  }
}

/** Maps `app://library/<revision>/<track>.flac` to a path inside the library root, or null for anything else. */
export function libraryFilePath(root: string, url: string): string | null {
  const parsed = new URL(url),
    [, revision, file, ...rest] = decodeURIComponent(parsed.pathname).split("/");
  if (parsed.host !== "library" || rest.length || !validId(revision ?? "")) return null;
  if (!isTrackFileName(file ?? "") && !isChartFileName(file ?? "")) return null;
  return join(root, revision, file);
}
