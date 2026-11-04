// The pedal's tuner mode (the Tuner's Mute switch) exists only where the CC is documented: the GP-5 family. Every other
// model must not offer it, and must refuse rather than send something it doesn't know.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { useDevice } from "./device";

vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

const store = () => useDevice.getState();

describe("tuner mode", () => {
  afterAll(async () => {
    await store().disconnect();
  });

  it.each(["gp5", "gp50"] as const)("is offered on the %s", async (key) => {
    await store().connect("mock", { mockDevice: key });
    expect(store().features).toContain("tuner");
    await expect(store().setTuner(true)).resolves.toBeUndefined();
    await expect(store().setTuner(false)).resolves.toBeUndefined();
    await store().disconnect();
  }, 30_000);

  it.each(["gp200", "gp200lt", "gp200jr", "gp150", "gp180"] as const)("is not offered on the %s", async (key) => {
    await store().connect("mock", { mockDevice: key });
    expect(store().features).not.toContain("tuner");
    await expect(store().setTuner(true)).rejects.toThrow(/can't do this/);
    await store().disconnect();
  }, 30_000);
});
