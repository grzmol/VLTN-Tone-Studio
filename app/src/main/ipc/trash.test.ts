// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrash, moveToLibraryTrash, sweepLibraryTrash, TRASH_DIR } from "./trash";

const DAY = 24 * 60 * 60_000;
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "trash-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("moveToLibraryTrash", () => {
  it("moves a folder into .trash with a timestamp in front of its name", async () => {
    const folder = join(root, "Stage set");
    await mkdir(folder);
    await writeFile(join(folder, "01-Clean.prst"), "x");
    const now = Date.UTC(2026, 9, 29, 12, 0, 0, 5);

    await moveToLibraryTrash(root, folder, now);

    expect(await exists(folder)).toBe(false);
    expect(await readdir(join(root, TRASH_DIR))).toEqual(["2026-10-29T12-00-00-005Z-Stage set"]);
    expect(await readFile(join(root, TRASH_DIR, "2026-10-29T12-00-00-005Z-Stage set", "01-Clean.prst"), "utf8")).toBe("x");
  });

  it("keeps two deletes of the same name in the same millisecond apart", async () => {
    const now = Date.UTC(2026, 9, 29);
    for (const name of ["a.prst", "a.prst"]) {
      await writeFile(join(root, name), name);
      await moveToLibraryTrash(root, join(root, name), now);
    }
    expect((await readdir(join(root, TRASH_DIR))).sort()).toEqual(["2026-10-29T00-00-00-000Z-2-a.prst", "2026-10-29T00-00-00-000Z-a.prst"]);
  });

  it("does nothing for a path that is already gone, the same as rm with force", async () => {
    await moveToLibraryTrash(root, join(root, "missing"));
    expect(await exists(join(root, TRASH_DIR))).toBe(false);
  });
});

describe("createTrash", () => {
  it("uses the OS Trash when it accepts the item", async () => {
    const file = join(root, "a.prst");
    await writeFile(file, "x");
    const trashItem = vi.fn(async (path: string) => {
      await rm(path);
    });

    await createTrash(root, trashItem)(file);

    expect(trashItem).toHaveBeenCalledWith(file);
    expect(await exists(join(root, TRASH_DIR))).toBe(false);
  });

  it("falls back to the library's .trash when the OS Trash refuses", async () => {
    const file = join(root, "a.prst");
    await writeFile(file, "x");

    await createTrash(root, async () => {
      throw new Error("no trash here");
    })(file);

    expect(await exists(file)).toBe(false);
    expect(await readdir(join(root, TRASH_DIR))).toHaveLength(1);
  });

  it("rejects, and leaves the item in place, when neither trash can take it", async () => {
    const file = join(root, "a.prst");
    await writeFile(file, "x");
    // A file where the .trash folder should go makes the fallback fail.
    await writeFile(join(root, TRASH_DIR), "not a folder");

    await expect(
      createTrash(root, async () => {
        throw new Error("no trash here");
      })(file),
    ).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("x");
  });
});

describe("sweepLibraryTrash", () => {
  it("removes entries older than 30 days and keeps newer ones", async () => {
    const dir = join(root, TRASH_DIR);
    const now = Date.UTC(2026, 9, 29, 12);
    const old = new Date(now - 31 * DAY).toISOString().replace(/[:.]/g, "-");
    const recent = new Date(now - 29 * DAY).toISOString().replace(/[:.]/g, "-");
    await mkdir(join(dir, `${old}-Old set`), { recursive: true });
    await mkdir(join(dir, `${recent}-Recent set`), { recursive: true });

    expect(await sweepLibraryTrash(root, now)).toBe(1);
    expect(await readdir(dir)).toEqual([`${recent}-Recent set`]);
  });

  it("leaves entries it does not recognise alone", async () => {
    const dir = join(root, TRASH_DIR);
    await mkdir(join(dir, "hand-placed"), { recursive: true });

    expect(await sweepLibraryTrash(root, Date.now() + 365 * DAY)).toBe(0);
    expect(await readdir(dir)).toEqual(["hand-placed"]);
  });

  it("does nothing when there is no .trash folder yet", async () => {
    expect(await sweepLibraryTrash(root)).toBe(0);
  });
});
