// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const events = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        events.push(`sync ${basename(String(args[0]))}`);
        return sync();
      };
      return handle;
    },
    rename: async (from: string, to: string) => {
      events.push(`rename ${basename(to)}`);
      return fs.rename(from, to);
    },
  };
});
import { SongLibraryStore } from "./song-library-store";
import { flacSong, saveFlacSong } from "./song-library-fixtures";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vltn-song-library-durable-"));
  events.length = 0;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("flushes each track file and its folder to disk before the index is swapped in", async () => {
  const store = new SongLibraryStore(root);
  await saveFlacSong(store, await flacSong());
  const swap = events.indexOf("rename library.json");
  expect(swap).toBeGreaterThan(-1);
  const before = events.slice(0, swap);
  expect(before).toContain("sync source.flac");
  expect(before).toContain("sync guitar.flac");
  // The revision folder is named by a UUID; the sync just before the index temp file is the folder's.
  expect(before.filter((e) => e.startsWith("sync ") && !e.endsWith(".flac") && !e.endsWith(".tmp")).length).toBeGreaterThan(0);
  // The index temp file is flushed before it is renamed, and the library folder after.
  expect(before.at(-1)).toMatch(/^sync library\.json\..*\.tmp$/);
  expect(events.at(-1)).toBe(`sync ${basename(root)}`);
});
