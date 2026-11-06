// Every supported model takes memory writes on a real pedal (mode "webmidi"): including GP-180 without a session unlock. The simulator stands
// in for the pedal; only the store's mode says "real".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { profileFor } from "@shared/devices";
import { sha256Hex } from "@shared/host/song";
import { DeviceError, getDriver, useDevice } from "./device";
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

describe("unsaved edits and other slots (mock gp5)", () => {
  const slotA = 2;
  const slotB = 3;
  beforeAll(async () => {
    await store().connect("mock", { mockDevice: "gp5" });
  }, 30_000);
  afterAll(async () => {
    await store().disconnect();
  });

  /** A live edit that leaves the preset different from its saved copy. */
  const editVolume = () => store().setVolume(store().preset!.volume === 50 ? 49 : 50);

  it("refuses a write to another slot while edits are unsaved, and sends nothing", async () => {
    await store().selectSlot(slotA);
    editVolume();
    expect(store().unsavedChanges).toBeGreaterThan(0);
    const spy = vi.spyOn(getDriver()!, "writePreset");
    const prst = store().preset!.prst;
    await expect(store().writePreset(slotB, prst)).rejects.toMatchObject({ code: "unsaved" });
    await expect(store().writePreset(slotB, prst)).rejects.toBeInstanceOf(DeviceError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await store().discard();
  });

  it("writes to the active slot with unsaved edits (the save path)", async () => {
    await store().selectSlot(slotA);
    editVolume();
    const spy = vi.spyOn(getDriver()!, "writePreset");
    await store().writePreset(slotA, store().preset!.prst);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("saveToSlot to another slot carries the unsaved edits to that slot", async () => {
    await store().selectSlot(slotA);
    editVolume();
    const edited = store().preset!.volume;
    await store().saveToSlot(slotB);
    expect(store().slot).toBe(slotB);
    expect(store().preset!.volume).toBe(edited);
    expect(store().unsavedChanges).toBe(0);
  });

  it("remembers the bytes a write put in the slot, for the backup check", async () => {
    const prst = store().preset!.prst;
    await store().writePreset(slotB, prst, { discardUnsaved: true });
    expect(store().slotHashes.get(slotB)).toBe(await sha256Hex(prst));
  });

  it("writePreset with discardUnsaved writes to another slot with edits pending", async () => {
    await store().selectSlot(slotA);
    editVolume();
    await store().writePreset(slotB, store().preset!.prst, { discardUnsaved: true });
    expect(store().slot).toBe(slotB);
  });
});

describe("busy labels name slots the pedal's way (mock gp200)", () => {
  beforeAll(async () => {
    await store().connect("mock", { mockDevice: "gp200" });
  }, 30_000);
  afterAll(async () => {
    await store().disconnect();
  });

  it("writes and restores label the slot with its pedal label, not its number", async () => {
    const slot = 46;
    const label = profileFor("gp200").slotLabel(slot);
    expect(label).not.toBe(String(slot));
    const seen: string[] = [];
    const spy = vi.spyOn(getDriver()!, "writePreset").mockImplementation(async () => {
      seen.push(store().busy!.label);
    });
    const prst = store().preset!.prst;
    await store().writePreset(slot, prst);
    await store().restoreAll([{ slot, name: "Restored", prst }]);
    spy.mockRestore();
    expect(seen).toEqual([`Writing slot ${label}`, `Restoring slot ${label} (1 of 1)`]);
  });
});
