// Every supported model takes memory writes on a real pedal (mode "webmidi"): including GP-180 without a session unlock. The simulator stands
// in for the pedal; only the store's mode says "real".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { profileFor } from "@shared/devices";
import { useDevice } from "./device";
import { globalSpecsFor } from "./device-model";
import { SUPPORTED_DEVICE_KEYS } from "./driver/types";

// The GP-5 family simulator loads the bundled backup by URL; serve those URLs from disk (paths are relative to the app root).
vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

const store = () => useDevice.getState();

describe.each(SUPPORTED_DEVICE_KEYS)("%s on a real pedal", (key) => {
  beforeAll(async () => {
    await store().connect("mock", { mockDevice: key });
    useDevice.setState({ mode: "webmidi" });
  }, 30_000);
  afterAll(async () => {
    useDevice.setState({ mode: "mock" });
    await store().disconnect();
  });

  it("renames, writes, restores, changes settings and uploads a User IR", async () => {
    expect(store().device).toBe(key);
    const profile = profileFor(key);
    const prst = store().preset!.prst;

    await store().rename(5, "Real Write");
    expect(store().names[5].name).toBe("Real Write");
    await store().writePreset(7, prst);
    await store().restoreAll([{ slot: 9, name: "Restored", prst }]);

    const setting = globalSpecsFor(key).find((g) => g.kind === "number")!;
    const value = setting.min === store().globals?.[setting.name] ? setting.min + 1 : setting.min;
    store().setGlobal(setting.name, value);
    expect(store().globals?.[setting.name]).toBe(value);

    expect(await store().uploadUserIr(0, "Real IR", new Uint8Array(profile.userIr.samples * 4))).toBe("Real IR");
  }, 60_000);
});
