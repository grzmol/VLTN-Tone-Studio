// Crash-safe JSON files. A write goes to a temp file in the same folder, is flushed to disk, and is then renamed over the
// target. A crash, a full disk or a force quit leaves the old file (or none) in place, never half of a new one.
import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Flushes a file or a folder to disk. A folder's flush makes the files created or renamed in it durable. Some systems cannot open a
 * folder to flush it (Windows), and there the call does nothing.
 */
export async function syncPath(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (e) {
    if (process.platform === "win32") return;
    throw e;
  }
  try {
    await handle.sync();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "EPERM" && code !== "EISDIR") throw e;
  } finally {
    await handle.close();
  }
}

/** Waits between the attempts of retryBusy: five tries, about a second in all. */
const RETRY_DELAYS_MS = [50, 150, 300, 500];
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

const sleepFor = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Runs a file operation again when Windows says the file is locked (EPERM, EBUSY, EACCES), which happens while
 * Defender or an indexer holds a file we just wrote. After the last try the original error is thrown.
 */
export async function retryBusy<T>(op: () => Promise<T>, sleep: (ms: number) => Promise<void> = sleepFor): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | null)?.code;
      if (attempt >= RETRY_DELAYS_MS.length || !code || !BUSY_CODES.has(code)) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** rename that retries while the file is locked. */
export const renameRetry = (from: string, to: string) => retryBusy(() => rename(from, to));

/** rm that retries while the file or folder is locked. */
export const rmRetry = (path: string, options: { recursive?: boolean; force?: boolean } = {}) => retryBusy(() => rm(path, options));

const tempPathFor = (path: string) => `${path}.${randomBytes(6).toString("hex")}.tmp`;

/** Writes `value` as pretty JSON, creating the folder if needed. Rejects, and leaves `path` untouched, if anything fails. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tempPathFor(path);
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(JSON.stringify(value, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameRetry(tmp, path);
    // The rename is only durable once the folder is flushed too.
    await syncPath(dirname(path));
  } catch (e) {
    await rmRetry(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** writeJsonAtomic for the few writers that must finish before the app quits (window bounds, on close). */
export function writeJsonAtomicSync(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tempPathFor(path);
  try {
    const fd = openSync(tmp, "w");
    try {
      writeFileSync(fd, JSON.stringify(value, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

const queues = new Map<string, Promise<void>>();

/**
 * Runs `job` after every earlier job with the same key has settled, so read-modify-write cycles on one file never
 * interleave and drop each other's changes. A failed job does not stop the ones queued after it.
 */
export function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(() => job());
  queues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Merges `patch` into the JSON object at `path` (a missing or unreadable file counts as empty), one update at a time. */
export function mergeJson(path: string, patch: object): Promise<void> {
  return serial(path, async () => writeJsonAtomic(path, { ...(await readObject(path)), ...patch }));
}
