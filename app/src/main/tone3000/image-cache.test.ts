// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idleAbort } from "@shared/idle-abort";
import { CACHE_MAX_BYTES, CACHE_TRIM_TO_BYTES, isImageResponse, MAX_IMAGE_BYTES, readImageBody, throttledTrim, trimCache } from "./image-cache";

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

describe("isImageResponse", () => {
  const response = (headers: Record<string, string>) => new Response(null, { headers });

  it("accepts an image of a reasonable size", () => {
    expect(isImageResponse(response({ "content-type": "image/jpeg", "content-length": "20000" }))).toBe(true);
  });

  it("refuses anything that isn't an image, such as an HTML error page", () => {
    expect(isImageResponse(response({ "content-type": "text/html" }))).toBe(false);
    expect(isImageResponse(response({}))).toBe(false);
  });

  it("refuses an image whose declared length is over the cap", () => {
    expect(isImageResponse(response({ "content-type": "image/png", "content-length": String(MAX_IMAGE_BYTES + 1) }))).toBe(false);
  });
});

describe("readImageBody", () => {
  const streamOf = (...parts: string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
          controller.close();
        },
      }),
    );
  const watch = () => idleAbort({ connectMs: 30_000, idleMs: 60_000 });

  it("returns the whole body when it is under the cap", async () => {
    const w = watch();
    expect((await readImageBody(streamOf("ab", "cd"), w, 10))?.toString()).toBe("abcd");
    w.finish();
  });

  it("gives up with null once the bytes pass the cap, even when the length header was missing", async () => {
    const w = watch();
    expect(await readImageBody(streamOf("abcdef", "ghijkl"), w, 10)).toBeNull();
    w.finish();
  });
});
