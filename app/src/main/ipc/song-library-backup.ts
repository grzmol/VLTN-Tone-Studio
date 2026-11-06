import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { c as createTar, Parser, type ReadEntry } from "tar";
import {
  LIBRARY_VERSION,
  TRACK_NAMES,
  chartFiles,
  isChartFileName,
  isTrackFileName,
  trackFiles,
  upgradeIndex,
  validId,
  validateOrganisation,
  validatePlaylists,
  validateSong,
  type LibraryTransferProgress,
  type StoredLibrary,
} from "@shared/song-library";
import type { DiskIndex } from "./song-library-store";

const MANIFEST = "backup-manifest.json",
  INDEX = "library.json";
const MAX_METADATA = 8 * 1024 * 1024,
  MAX_FILES = 50000,
  MAX_BYTES = 512 * 1024 ** 3;
interface BackupFile {
  path: string;
  bytes: number;
  sha256: string;
}
interface Manifest {
  format: "vltn-song-library";
  /** 1: raw float32 files. 2: FLAC files. 3: FLAC files and per-track settings. 4: song details, folders, history and sets. All are read. */
  version: 1 | 2 | 3 | 4;
  files: BackupFile[];
}
type Progress = (value: LibraryTransferProgress) => void;
const invalid = () => new Error("Invalid or damaged song-library backup.");
const SAFE_RAW = new RegExp(`^[a-f0-9-]{36}/(${TRACK_NAMES.join("|")})-[01]\\.f32$`);
/** A revision folder's file: the UUID, one slash, then one name with no slash in it. The name is checked against the allow-lists below. */
const SAFE_FLAC = /^[a-f0-9-]{36}\/([^/]+)$/;
/**
 * Raw v1 channels, a FLAC track file (a legacy track or an imported one), or a song's PDF chart and its annotations. Anything else, including
 * a name with a slash, a dot-dot or a different extension, is refused before any file is written.
 */
const safePath = (path: string) => {
  if (path === INDEX || SAFE_RAW.test(path)) return true;
  const name = SAFE_FLAC.exec(path)?.[1];
  return name !== undefined && (isTrackFileName(name) || isChartFileName(name));
};
export function validateDiskIndex(value: unknown): DiskIndex {
  const index = value as DiskIndex;
  if (
    !index ||
    ![1, 2, 3, 4].includes(index.version) ||
    !Array.isArray(index.songs) ||
    !Array.isArray(index.playlists) ||
    !index.revisions ||
    typeof index.revisions !== "object" ||
    Array.isArray(index.revisions)
  )
    throw invalid();
  if (new Set(index.songs.map((s) => s.id)).size !== index.songs.length || Object.keys(index.revisions).length !== index.songs.length) throw invalid();
  const revisions = new Set<string>();
  for (const song of index.songs) {
    validateSong(song);
    const rev = index.revisions[song.id];
    if (!validId(rev) || revisions.has(rev)) throw invalid();
    revisions.add(rev);
    for (const track of song.audio) if (!Number.isSafeInteger(track.frames * 4)) throw invalid();
  }
  validatePlaylists(index.playlists, index.songs);
  // An older backup is read in the v4 model, so its folders and history are empty and the restore needs no special case.
  const upgraded = upgradeIndex(index as StoredLibrary & { revisions: DiskIndex["revisions"] });
  validateOrganisation(upgraded);
  return upgraded;
}
/** Every file a backup holds for the songs: their audio, and their PDF chart with its annotations. */
function audioFiles(index: DiskIndex): Map<string, number> {
  const result = new Map<string, number>();
  for (const song of index.songs) {
    for (const track of song.audio) for (const { file, bytes } of trackFiles(track)) result.set(`${index.revisions[song.id]}/${file}`, bytes);
    for (const { file, bytes } of chartFiles(song.chart)) result.set(`${index.revisions[song.id]}/${file}`, bytes);
  }
  return result;
}
/** The digests a v2 index promises for its FLAC files; the manifest must agree with them. */
function audioHashes(index: DiskIndex): Map<string, string> {
  const result = new Map<string, string>();
  for (const song of index.songs) {
    for (const track of song.audio) for (const { file, sha256 } of trackFiles(track)) if (sha256) result.set(`${index.revisions[song.id]}/${file}`, sha256);
    for (const { file, sha256 } of chartFiles(song.chart)) result.set(`${index.revisions[song.id]}/${file}`, sha256);
  }
  return result;
}
async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
/** The caller holds the store's serialization lock for a consistent snapshot. */
export async function exportBackup(root: string, index: DiskIndex, target: string, progress: Progress = () => {}): Promise<void> {
  validateDiskIndex(index);
  await mkdir(root, { recursive: true });
  const rootPath = await realpath(root),
    parent = await realpath(dirname(resolve(target)));
  const inside = relative(rootPath, parent);
  if (!inside || (!inside.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) && inside !== ".." && !isAbsolute(inside)))
    throw new Error("Choose a backup location outside the managed song-library folder.");
  const files = audioFiles(index);
  if (files.size + 1 > MAX_FILES) throw new Error("This library exceeds the backup file limit.");
  const metadata = await readFile(join(root, INDEX));
  if (metadata.length > MAX_METADATA) throw new Error("Library metadata exceeds the supported backup size.");
  files.set(INDEX, metadata.length);
  const manifest: Manifest = { format: "vltn-song-library", version: LIBRARY_VERSION, files: [] };
  let total = 0,
    done = 0;
  for (const [path, bytes] of files) {
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.size !== bytes) throw new Error(`Missing or damaged saved audio: ${path}`);
    total += bytes;
    if (total > MAX_BYTES) throw new Error("Library backup exceeds 512 GiB uncompressed.");
    progress({ phase: "Checking saved files", completed: done, total: files.size });
    manifest.files.push({ path, bytes, sha256: await fileHash(join(root, path)) });
    done++;
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_METADATA) throw new Error("Backup manifest exceeds the supported size.");
  const temp = join(parent, `.${basename(target)}.${randomUUID()}.partial`);
  try {
    await writeFile(join(root, MANIFEST), manifestBytes);
    done = 0;
    await createTar(
      {
        cwd: root,
        file: temp,
        gzip: true,
        portable: true,
        strict: true,
        follow: false,
        filter: () => {
          progress({ phase: "Compressing library", completed: done++, total: files.size + 1 });
          return true;
        },
      },
      [MANIFEST, INDEX, ...[...files.keys()].filter((p) => p !== INDEX)],
    );
    await rename(temp, resolve(target));
    progress({ phase: "Backup complete", completed: files.size + 1, total: files.size + 1 });
  } finally {
    await rm(temp, { force: true }).catch(() => {});
    await rm(join(root, MANIFEST), { force: true }).catch(() => {});
  }
}
/** Read only regular, declared files. No archive path is passed to an extraction API. */
export async function readBackup(file: string, stage: string, progress: Progress = () => {}): Promise<DiskIndex> {
  await mkdir(stage, { recursive: true });
  let manifest: Manifest | undefined,
    index: DiskIndex | undefined,
    totalBytes = 0,
    completed = 0;
  const seen = new Set<string>(),
    declared = new Map<string, BackupFile>(),
    pending: Promise<void>[] = [];
  const controller = new AbortController();
  let failed = false;
  const input = createReadStream(file);
  const parser = new Parser({ strict: true, maxMetaEntrySize: MAX_METADATA, maxDecompressionRatio: 2048 });
  let rejectArchive: (error: Error) => void = () => {};
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    const e = error instanceof Error ? error : invalid();
    controller.abort();
    input.destroy();
    parser.abort(e);
    rejectArchive(e);
  };
  const complete = new Promise<void>((resolve, reject) => {
    rejectArchive = reject;
    parser.on("error", fail);
    input.on("error", fail);
    parser.on("end", resolve);
    parser.on("entry", (entry: ReadEntry) => {
      try {
        entry.on("error", fail);
        const path = entry.path;
        if (entry.type !== "File" || seen.has(path) || seen.size >= MAX_FILES + 1 || !Number.isSafeInteger(entry.size) || entry.size < 0) throw invalid();
        seen.add(path);
        totalBytes += entry.size;
        if (totalBytes > MAX_BYTES + MAX_METADATA) throw invalid();
        if (path === MANIFEST) {
          if (seen.size !== 1 || entry.size > MAX_METADATA) throw invalid();
          const chunks: Buffer[] = [];
          entry.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          entry.on("end", () => {
            try {
              manifest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Manifest;
              if (
                !manifest ||
                manifest.format !== "vltn-song-library" ||
                ![1, 2, 3, 4].includes(manifest.version) ||
                !Array.isArray(manifest.files) ||
                !manifest.files.length ||
                manifest.files.length > MAX_FILES
              )
                throw invalid();
              const paths = new Set<string>();
              let bytes = 0;
              for (const f of manifest.files) {
                if (
                  !f ||
                  typeof f.path !== "string" ||
                  !safePath(f.path) ||
                  paths.has(f.path) ||
                  !Number.isSafeInteger(f.bytes) ||
                  f.bytes < 1 ||
                  !/^[a-f0-9]{64}$/.test(f.sha256)
                )
                  throw invalid();
                paths.add(f.path);
                declared.set(f.path, f);
                bytes += f.bytes;
              }
              if (!paths.has(INDEX) || bytes > MAX_BYTES) throw invalid();
            } catch (e) {
              fail(e);
            }
          });
          entry.resume();
          return;
        }
        const expected = declared.get(path);
        if (!expected || !safePath(path) || expected.bytes !== entry.size) throw invalid();
        if (path === INDEX) {
          if (seen.size !== 2 || entry.size > MAX_METADATA) throw invalid();
          const chunks: Buffer[] = [];
          entry.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          entry.on("end", () => {
            try {
              const bytes = Buffer.concat(chunks);
              if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw invalid();
              index = validateDiskIndex(JSON.parse(bytes.toString("utf8")));
              const required = audioFiles(index);
              if (required.size + 1 !== manifest!.files.length) throw invalid();
              const hashes = audioHashes(index);
              for (const f of manifest!.files)
                if (
                  f.path !== INDEX &&
                  (required.get(f.path) !== f.bytes || (hashes.has(f.path) && hashes.get(f.path) !== f.sha256))
                )
                  throw invalid();
            } catch (e) {
              fail(e);
            }
          });
          entry.resume();
          return;
        }
        if (!index) throw invalid();
        const hash = createHash("sha256");
        let count = 0;
        // Parent paths come only from the UUID/track allowlist above.
        const destination = join(stage, path);
        const task = (async () => {
          await mkdir(dirname(destination), { recursive: true });
          await new Promise<void>((resolve, reject) => {
            const output = createWriteStream(destination, { flags: "wx", signal: controller.signal });
            const checked = new Transform({
              transform(chunk, _encoding, callback) {
                count += chunk.length;
                hash.update(chunk);
                callback(null, chunk);
              },
            });
            output.on("error", reject);
            entry.on("error", reject);
            checked.on("error", reject);
            output.on("close", () => (count === expected.bytes && hash.digest("hex") === expected.sha256 ? resolve() : reject(invalid())));
            entry.pipe(checked).pipe(output);
          });
          progress({ phase: "Restoring checked audio", completed: ++completed, total: manifest!.files.length - 1 });
        })();
        pending.push(task);
        void task.catch(fail);
      } catch (e) {
        fail(e);
      }
    });
    input.pipe(parser);
  });
  try {
    await complete;
    await Promise.all(pending);
    if (!manifest || !index || seen.size !== manifest.files.length + 1 || manifest.files.some((f) => !seen.has(f.path))) throw invalid();
    return index;
  } catch (e) {
    controller.abort();
    input.destroy();
    await Promise.allSettled(pending);
    throw e;
  }
}
/**
 * Reads only the library index (the second entry), then stops. It lets the restore dialog count songs and duplicates without extracting audio.
 * The full checks still run in `readBackup` when the restore itself starts.
 */
export async function readBackupIndex(file: string): Promise<DiskIndex> {
  const input = createReadStream(file),
    parser = new Parser({ strict: true, maxMetaEntrySize: MAX_METADATA, maxDecompressionRatio: 2048 });
  return new Promise<DiskIndex>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, index?: DiskIndex) => {
      if (settled) return;
      settled = true;
      input.destroy();
      parser.abort(error ?? invalid());
      if (index) resolve(index);
      else reject(error ?? invalid());
    };
    parser.on("error", (e) => finish(e instanceof Error ? e : invalid()));
    input.on("error", (e) => finish(e));
    parser.on("end", () => finish());
    parser.on("entry", (entry: ReadEntry) => {
      if (entry.path !== INDEX) {
        entry.resume();
        return;
      }
      if (entry.type !== "File" || entry.size > MAX_METADATA) return finish();
      const chunks: Buffer[] = [];
      entry.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      entry.on("end", () => {
        try {
          finish(undefined, validateDiskIndex(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        } catch (e) {
          finish(e instanceof Error ? e : invalid());
        }
      });
    });
    input.pipe(parser);
  });
}
