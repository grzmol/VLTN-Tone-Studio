// Deleted user content goes to the OS Trash, so a mis-click can be undone. Where the OS Trash refuses (some Linux setups have
// none), or in tests, the item moves into `<root>/.trash/<timestamp>-<name>` instead. Entries there older than 30 days are
// dropped at start-up. Nothing else reads that folder, so it never shows up as a collection or a song.
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export const TRASH_DIR = ".trash";
const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

/** Takes a file or folder out of the library. Rejects, and leaves `path` where it was, when it can't. */
export type TrashFn = (path: string) => Promise<void>;

/** `<timestamp>-` at the start of an entry name, as written by `moveToLibraryTrash`. */
const ENTRY_STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Moves `path` into `<root>/.trash/`. Missing paths are ignored, the same as `rm` with `force`. */
export async function moveToLibraryTrash(root: string, path: string, now = Date.now()): Promise<void> {
  if (!(await exists(path))) return;
  const dir = join(root, TRASH_DIR);
  await mkdir(dir, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  // Two deletes of the same name in the same millisecond must not overwrite each other.
  let target = join(dir, `${stamp}-${basename(path)}`);
  for (let n = 2; await exists(target); n++) target = join(dir, `${stamp}-${n}-${basename(path)}`);
  await rename(path, target);
}

/**
 * The Trash for a library rooted at `root`: `trashItem` (the OS Trash on desktop) first, then the in-library folder if it
 * refuses. Without `trashItem` everything goes to the in-library folder.
 */
export function createTrash(root: string, trashItem?: (path: string) => Promise<void>): TrashFn {
  return async (path) => {
    if (!(await exists(path))) return;
    if (trashItem) {
      try {
        await trashItem(path);
        return;
      } catch {
        // Fall through: the in-library folder keeps the item recoverable.
      }
    }
    await moveToLibraryTrash(root, path);
  };
}

/** Removes `<root>/.trash` entries older than 30 days. Names it doesn't recognise are left alone. Returns how many went. */
export async function sweepLibraryTrash(root: string, now = Date.now()): Promise<number> {
  const dir = join(root, TRASH_DIR);
  let removed = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const m = ENTRY_STAMP.exec(name);
    if (!m) continue;
    const [, date, h, min, s, ms] = m;
    const movedAt = Date.parse(`${date}T${h}:${min}:${s}.${ms}Z`);
    if (!(now - movedAt >= TRASH_MAX_AGE_MS)) continue;
    await rm(join(dir, name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}
