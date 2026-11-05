// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// Windows can refuse a rename while Defender holds a file. These tests make the rename fail that way.
const lock = vi.hoisted(() => ({ failures: 0, only: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (lock.failures > 0 && basename(from).startsWith(lock.only)) {
        lock.failures--;
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      }
      return real.rename(from, to);
    },
  };
});

import { LibraryStore } from "./files-store";
import { writeJsonAtomic } from "./fs-atomic";

function fakePrst(name: string): Uint8Array {
  const b = new Uint8Array(507);
  b.set(new TextEncoder().encode("GP-5"), 0);
  for (let i = 0; i < name.length; i++) b[0x19 + i] = name.charCodeAt(i);
  return b;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gp5-locked-"));
  lock.failures = 0;
  lock.only = "";
});
afterEach(() => rm(root, { recursive: true, force: true }));

const slots = [{ slot: 0, name: "A", prst: fakePrst("A") }];

describe("a locked file on Windows", () => {
  it("still saves a backup when the rename fails a few times first", async () => {
    lock.failures = 2;
    lock.only = ".tmp-";
    const info = await new LibraryStore(root).saveBackup(slots);
    expect(info.count).toBe(1);
  });

  it("still writes a JSON file when the rename fails a few times first", async () => {
    lock.failures = 2;
    const path = join(root, "settings.json");
    await writeJsonAtomic(path, { a: 1 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 1 });
  });

  it("keeps the finished temp backup and says where it is when the rename never works", async () => {
    lock.failures = 99;
    lock.only = ".tmp-"; // the backup folder's rename, not the backup.json inside it
    const store = new LibraryStore(root);
    const err = await store.saveBackup(slots).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toMatch(/complete/);
    lock.failures = 0;
    const kept = (await readdir(join(root, "backups"))).filter((n) => n.startsWith(".tmp-"));
    expect(kept).toHaveLength(1);
    expect(err?.message).toContain(join(root, "backups", kept[0]));
    expect((await readdir(join(root, "backups", kept[0]))).sort()).toContain("backup.json");
  });
});
