import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// Downloaded TONE3000 images live in userData/tone-cache, one JPEG per URL, and nothing else ever removes them. When the
// folder passes CACHE_MAX_BYTES the oldest files go until it is back under CACHE_TRIM_TO_BYTES. The check runs at most
// once a minute, so browsing doesn't stat the folder on every image.

export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const CACHE_TRIM_TO_BYTES = 40 * 1024 * 1024;
export const CACHE_TRIM_EVERY_MS = 60_000;

/** Deletes the oldest files in `dir` until its total size is at most `lowBytes`, if it is over `maxBytes`. Returns the bytes removed. */
export async function trimCache(dir: string, maxBytes = CACHE_MAX_BYTES, lowBytes = CACHE_TRIM_TO_BYTES): Promise<number> {
  const files = await Promise.all(
    (await readdir(dir).catch(() => [] as string[])).map(async (name) => {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      return info?.isFile() ? { path, size: info.size, mtimeMs: info.mtimeMs } : null;
    }),
  );
  const kept = files.filter((f) => f !== null);
  let total = kept.reduce((sum, f) => sum + f.size, 0);
  if (total <= maxBytes) return 0;
  let removed = 0;
  for (const file of kept.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= lowBytes) break;
    await rm(file.path, { force: true });
    total -= file.size;
    removed += file.size;
  }
  return removed;
}

/** A trim function that runs `trimCache` at most once per CACHE_TRIM_EVERY_MS. `dir` and `now` are functions so nothing is read until the first call (`app` isn't ready at import). */
export function throttledTrim(dir: () => string, now: () => number = Date.now): () => Promise<number> {
  let last = Number.NEGATIVE_INFINITY;
  return async () => {
    const at = now();
    if (at - last < CACHE_TRIM_EVERY_MS) return 0;
    last = at;
    return trimCache(dir());
  };
}
