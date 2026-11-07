import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ClickSampleStore } from "./click-samples-store";

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), "click-samples-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

it("copies a sample into its slot and reads it back, after a restart too", async () => {
  await new ClickSampleStore(join(dir, "click-sounds")).put("down", "stick.wav", new Uint8Array([1, 2, 3]));
  const stored = await new ClickSampleStore(join(dir, "click-sounds")).get("down");
  expect(stored?.name).toBe("stick.wav");
  expect([...new Uint8Array(stored!.bytes)]).toEqual([1, 2, 3]);
  expect(await new ClickSampleStore(join(dir, "click-sounds")).get("other")).toBeNull();
});

it("replaces a slot, clears it, and keeps no temporary files", async () => {
  const store = new ClickSampleStore(dir);
  await store.put("other", "a.wav", new Uint8Array([1]));
  await store.put("other", "../b.wav", new Uint8Array([9, 9]));
  expect((await store.get("other"))?.name).toBe(".._b.wav");
  expect((await readdir(dir)).sort()).toEqual(["other.bin", "other.json"]);
  await store.clear("other");
  expect(await store.get("other")).toBeNull();
  expect(await readdir(dir)).toEqual([]);
});

it("refuses an empty or oversized file", async () => {
  const store = new ClickSampleStore(dir);
  await expect(store.put("down", "a.wav", new Uint8Array())).rejects.toThrow();
  await expect(store.put("down", "a.wav", new Uint8Array(9 * 1024 * 1024))).rejects.toThrow();
});
