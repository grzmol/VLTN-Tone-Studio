// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeJson, retryBusy, serial, writeJsonAtomic, writeJsonAtomicSync } from "./fs-atomic";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fs-atomic-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("writeJsonAtomic", () => {
  it("writes pretty JSON, creating the folder, and leaves no temp file behind", async () => {
    const path = join(dir, "nested", "settings.json");
    await writeJsonAtomic(path, { showValues: true });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ showValues: true });
    expect(await readdir(join(dir, "nested"))).toEqual(["settings.json"]);
  });

  it("keeps the old file when the new value can't be serialised", async () => {
    const path = join(dir, "settings.json");
    await writeJsonAtomic(path, { showValues: true });
    await expect(writeJsonAtomic(path, { n: BigInt(1) })).rejects.toThrow();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ showValues: true });
    expect(await readdir(dir)).toEqual(["settings.json"]);
  });
});

describe("writeJsonAtomicSync", () => {
  it("writes the same format as the async writer", () => {
    const path = join(dir, "window.json");
    writeJsonAtomicSync(path, { width: 1440, height: 900 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ width: 1440, height: 900 });
    expect(readdirSync(dir)).toEqual(["window.json"]);
  });
});

describe("serial", () => {
  it("runs jobs for one key in the order they were queued, even when an earlier one is slow", async () => {
    const order: string[] = [];
    const slow = serial("k", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("slow");
    });
    const fast = serial("k", async () => {
      order.push("fast");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow", "fast"]);
  });

  it("keeps running later jobs after one rejects", async () => {
    const failed = serial("k", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(serial("k", async () => "next")).resolves.toBe("next");
  });
});

describe("mergeJson", () => {
  it("lands 50 concurrent updates to different keys", async () => {
    const path = join(dir, "tone3000.json");
    await writeFile(path, JSON.stringify({ clientId: "kept" }));
    await Promise.all(Array.from({ length: 50 }, (_, i) => mergeJson(path, { [`key${i}`]: i })));
    const state = JSON.parse(await readFile(path, "utf8"));
    expect(state.clientId).toBe("kept");
    for (let i = 0; i < 50; i++) expect(state[`key${i}`]).toBe(i);
  });

  it("treats a missing or damaged file as empty", async () => {
    const path = join(dir, "state.json");
    await mergeJson(path, { a: 1 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 1 });
    await writeFile(path, "{ not json");
    await mergeJson(path, { b: 2 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ b: 2 });
  });
});

describe("retryBusy", () => {
  const locked = (code: string) => Object.assign(new Error(`${code}: locked`), { code });

  it("tries again after EPERM, EBUSY and EACCES and returns the result", async () => {
    for (const code of ["EPERM", "EBUSY", "EACCES"]) {
      const sleep = vi.fn(async () => {});
      let failures = 2;
      const op = vi.fn(async () => {
        if (failures-- > 0) throw locked(code);
        return "done";
      });
      await expect(retryBusy(op, sleep)).resolves.toBe("done");
      expect(op).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    }
  });

  it("waits a little longer each time, about a second in all", async () => {
    const waits: number[] = [];
    const op = vi.fn(async () => {
      throw locked("EBUSY");
    });
    await expect(retryBusy(op, async (ms) => void waits.push(ms))).rejects.toThrow("EBUSY");
    expect(op).toHaveBeenCalledTimes(5);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
  });

  it("gives up with the original error when the file stays locked", async () => {
    const error = locked("EPERM");
    await expect(retryBusy(() => Promise.reject(error), async () => {})).rejects.toBe(error);
  });

  it("does not retry other errors", async () => {
    const op = vi.fn(async () => {
      throw locked("ENOENT");
    });
    await expect(retryBusy(op, async () => {})).rejects.toThrow("ENOENT");
    expect(op).toHaveBeenCalledTimes(1);
  });
});
