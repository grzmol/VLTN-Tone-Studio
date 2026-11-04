// The tuner's Mute switch sets the preset's Out volume to 0 and puts it back: it must work on every model and leave no
// unsaved change behind once the volume is restored.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS } from "@shared/devices";
import { useDevice } from "./device";

vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

const store = () => useDevice.getState();

describe("mute for tuning (Out volume)", () => {
  afterAll(async () => {
    await store().disconnect();
  });

  it.each(DEVICE_KEYS)("silences the %s and leaves nothing unsaved after the restore", async (key) => {
    await store().connect("mock", { mockDevice: key });
    const volume = store().preset!.volume;
    expect(store().unsavedChanges).toBe(0);
    store().setVolume(0);
    expect(store().preset!.volume).toBe(0);
    store().setVolume(volume);
    expect(store().preset!.volume).toBe(volume);
    expect(store().unsavedChanges).toBe(0);
    await store().disconnect();
  }, 30_000);
});
