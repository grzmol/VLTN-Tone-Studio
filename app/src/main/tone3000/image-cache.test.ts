// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CACHE_MAX_BYTES, CACHE_TRIM_TO_BYTES, throttledTrim, trimCache } from "./image-cache";

const MB = 1024 * 1024;
let dir: string;

/** Writes `name` as `megabytes` MB, last modified `ageMinutes` minutes ago (bigger age = older). */
async function image(name: string, megabytes: number, ageMinutes: number) {
  const path = join(dir, name);
  await writeFile(path, Buffer.alloc(megabytes * MB));
  const when = new Date(Date.now() - ageMinutes * 60_000);
  await utimes(path, when, when);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tone-cache-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("trimCache", () => {
  it("leaves the folder alone while it is at or under the 50 MB cap", async () => {
    await image("a.jpg", 25, 9);
    await image("b.jpg", 25, 8);
    expect(await trimCache(dir)).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(["a.jpg", "b.jpg"]);
  });

  it("deletes the oldest files first, and stops once the folder is at or under 40 MB", async () => {
    await image("oldest.jpg", 20, 9);
    await image("middle.jpg", 20, 5);
    await image("newest.jpg", 20, 1);
    // 60 MB total: removing the oldest leaves 40 MB, which is enough.
    expect(await trimCache(dir)).toBe(20 * MB);
    expect((await readdir(dir)).sort()).toEqual(["middle.jpg", "newest.jpg"]);
  });

  it("keeps deleting until under the low-water mark, not just under the cap", async () => {
    await image("a.jpg", 30, 9);
    await image("b.jpg", 15, 7);
    await image("c.jpg", 15, 5);
    await image("d.jpg", 30, 1);
    // 90 MB: the three oldest (60 MB) have to go before the folder is at or under 40 MB.
    await trimCache(dir);
    expect(await readdir(dir)).toEqual(["d.jpg"]);
  });

  it("does nothing to a missing folder", async () => {
    expect(await trimCache(join(dir, "missing"))).toBe(0);
  });

  it("uses the 50 MB cap and 40 MB target by default", () => {
    expect(CACHE_MAX_BYTES).toBe(50 * MB);
    expect(CACHE_TRIM_TO_BYTES).toBe(40 * MB);
  });
});

describe("throttledTrim", () => {
  it("runs the trim at most once a minute", async () => {
    await image("a.jpg", 60, 9);
    let clock = 0;
    const trim = throttledTrim(() => dir, () => clock);
    expect(await trim()).toBeGreaterThan(0);
    await image("b.jpg", 60, 9);
    clock += 59_000;
    expect(await trim()).toBe(0);
    clock += 1_000;
    expect(await trim()).toBeGreaterThan(0);
  });
});
