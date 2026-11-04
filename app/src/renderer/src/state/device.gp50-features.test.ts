// The device store's GP-50 features over the simulator: EXP, tempo, Sync, footswitches, chain order, unsaved-edits
// read at sync, list notifications, export reads, in-pedal delete/copy/move (backup first), and the experimental gate.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parsePrst } from "@/gp5/lib/prst.mjs";
import { SYNC_ON_DIVISION } from "@/gp5/lib/catalog.mjs";
import { REPLACED_ID } from "@shared/host/files";
import { runNative } from "@/screens/library/native";
import { clearSteps, copySteps, moveSteps } from "@/screens/library/plans";
import { isEmptyName } from "@/screens/library/store";
import { getDriver, useDevice } from "./device";
import { toPresetState } from "./preset-codec";
import type { Gp5Driver } from "./driver/gp5-driver";

vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

/** Backups the Library saved, with what the pedal held in that slot at that moment. */
const backups: { collection: string; slot: number; name: string; pedalHad: string }[] = [];
vi.mock("@/host", () => ({
  host: {
    kind: "web",
    app: { getSettings: async () => ({ gp50Extras: false, portPattern: "", backupBeforeWrite: true }) },
    device: { status: async () => null },
    files: {
      addPresets: async (collection: string, presets: { slot: number; name: string; prst: Uint8Array }[]) => {
        for (const p of presets) backups.push({ collection, slot: p.slot, name: parsePrst(p.prst).name, pedalHad: mock().slots[p.slot].name });
      },
      listCollections: async () => [],
    },
  },
}));

const store = () => useDevice.getState();
const mock = () => (getDriver() as Gp5Driver).mock!;
/** Edit buffer as the simulated pedal holds it now. */
const onPedal = async () => toPresetState(0, await getDriver()!.readEditBuffer("x"));
/** Wait until the coalesced live sends reached the simulator (`check` passes). */
const until = (check: () => Promise<void>) => vi.waitFor(check, { timeout: 5000, interval: 50 });
/** Long enough for a live send to arrive, for checks that nothing was sent. */
const settle = () => sleep(500);

describe("GP-50 features in the device store", () => {
  beforeAll(async () => {
    await store().connect("mock", { mockDevice: "gp50" });
  }, 30_000);
  afterAll(async () => {
    await store().disconnect();
  });

  it("offers every GP-50 feature on the simulator", () => {
    expect([...store().features].sort()).toEqual(["copyPreset", "deletePreset", "exp", "exportPreset", "liveBpm", "liveFootswitches", "liveOrder", "modified", "movePreset", "sync"]);
    expect(store().lockedFeatures).toEqual([]);
    expect(store().preset?.exp).not.toBeNull();
  });

  it("edits EXP live, counts each changed field as unsaved and refuses values out of range", async () => {
    const saved = store().saved!.exp!;
    const edit = { on: !saved.on, targetModule: 9, targetParam: 0, paramMin: saved.paramMin === 10 ? 11 : 10, paramMax: 90 };
    store().setExp(edit);
    const changed = (Object.keys(edit) as (keyof typeof edit)[]).filter((k) => saved[k] !== edit[k]).length;
    expect(store().preset!.exp).toMatchObject(edit);
    expect(store().unsavedChanges).toBe(changed);
    await until(async () => expect((await onPedal()).exp).toMatchObject(edit));

    const before = store().preset;
    expect(() => store().setExp({ paramMax: 101 })).toThrow(RangeError);
    expect(store().preset).toBe(before);
  });

  it("sends the tempo live, clamped to 40..260", async () => {
    store().setBpm(300);
    expect(store().preset!.bpm).toBe(260);
    store().setBpm(133.4);
    expect(store().preset!.bpm).toBe(133);
    await until(async () => expect((await onPedal()).bpm).toBe(133));
    expect(store().lastError).toBeNull();
  });

  it("checks footswitch assignments before sending them live", async () => {
    const before = store().preset;
    expect(() => store().setFootswitches([[1, 2, 3, 6], []])).toThrow(RangeError);
    expect(() => store().setFootswitches([[2], [2]])).toThrow(RangeError);
    expect(store().preset).toBe(before);
    store().setFootswitches([[2, 6], [7]]);
    await until(async () => expect((await onPedal()).footswitches).toEqual([[2, 6], [7]]));
  });

  it("sends a legal chain order live and refuses one that splits the amp group", async () => {
    expect(() => store().setOrder([0, 1, 2, 3, 9, 4, 5, 6, 7, 8])).toThrow(RangeError);
    store().setOrder([0, 1, 2, 9, 3, 4, 5, 6, 8, 7]);
    expect(store().preset!.order).toEqual([0, 1, 2, 9, 3, 4, 5, 6, 8, 7]);
    await until(async () => expect((await onPedal()).order).toEqual([0, 1, 2, 9, 3, 4, 5, 6, 8, 7]));
  });

  it("turns Sync on: Time shows note divisions and the block is refreshed from the pedal", async () => {
    await store().setModel(7, 0x0b000000); // DLY Pure Eko: Time (1), Sync (3)
    const sync = store().preset!.blocks[7].model!.params.find((p) => p.syncs !== undefined)!;
    expect(sync.syncs).toBe(1);
    store().setParam(7, sync.index, 1);
    await until(async () => expect((await onPedal()).blocks[7].params[sync.index]).toBe(1));
    await until(async () => expect(store().preset!.blocks[7].params).toEqual((await onPedal()).blocks[7].params));
    const dly = store().preset!.blocks[7];
    expect(dly.params[sync.index]).toBe(1);
    expect(dly.params[1]).toBe(SYNC_ON_DIVISION);
    const time = dly.model!.params.find((p) => p.index === 1)!;
    expect(time.labels?.[dly.params[1] - time.min]).toBe("1/4");
  });

  it("keeps the stored preset as 'saved' when the pedal reports unsaved edits on sync", async () => {
    const count = store().unsavedChanges;
    expect(count).toBeGreaterThan(0);
    expect(mock().modified).toBe(true);
    await store().sync();
    expect(store().unsavedChanges).toBe(count);
    const slot = store().slot!;
    expect(store().saved!.prst.subarray(41)).toEqual(new Uint8Array(await getDriver()!.exportPreset!(slot)).subarray(41));
  }, 30_000);

  it("reads another slot through the export read, leaving the active preset and its edits alone", async () => {
    const slot = store().slot!;
    const count = store().unsavedChanges;
    const prst = await store().readPreset(20);
    expect(parsePrst(prst).name).toBe(mock().slots[20].name);
    expect(store().slot).toBe(slot);
    expect(store().unsavedChanges).toBe(count);
    await store().discard();
    expect(store().unsavedChanges).toBe(0);
  }, 30_000);

  it("re-reads the preset names when the pedal says they changed", async () => {
    await getDriver()!.rename(10, "Renamed");
    await vi.waitFor(() => expect(store().names[10].name).toBe("Renamed"), { timeout: 3000 });
  });

  it("backs up the replaced slot, then clears it inside the pedal", async () => {
    const name = store().names[1].name;
    expect(isEmptyName(name)).toBe(false);
    backups.length = 0;
    const op = { kind: "delete" as const, slots: [1] };
    await runNative({ op, steps: clearSteps(op.slots), pedal: "GP-50", read: new Map(), backedUp: false });
    expect(backups).toEqual([{ collection: REPLACED_ID, slot: 1, name, pedalHad: name }]);
    expect(isEmptyName(store().names[1].name)).toBe(true);
  }, 30_000);

  it("copies inside the pedal, backing up only a slot that held a preset", async () => {
    backups.length = 0;
    const empty = store().names.find((n) => n.slot > 1 && isEmptyName(n.name))!.slot;
    await runNative({ op: { kind: "copy", from: 2, to: empty }, steps: copySteps([2], empty, 100)!, pedal: "GP-50", read: new Map(), backedUp: false });
    expect(backups).toEqual([]);
    expect(store().names[empty].name).toBe(store().names[2].name);

    const replaced = store().names[3].name;
    await runNative({ op: { kind: "copy", from: 2, to: 3 }, steps: copySteps([2], 3, 100)!, pedal: "GP-50", read: new Map(), backedUp: false });
    expect(backups).toEqual([{ collection: REPLACED_ID, slot: 3, name: replaced, pedalHad: replaced }]);
    expect(store().names[3].name).toBe(store().names[2].name);
  }, 30_000);

  it("moves inside the pedal: the slots in between shift, every replaced one is backed up first", async () => {
    backups.length = 0;
    const before = store().names.map((n) => n.name);
    const op = { kind: "move" as const, from: 4, to: 6 };
    await runNative({ op, steps: moveSteps([4], 6, 100)!, pedal: "GP-50", read: new Map(), backedUp: false });
    expect(store().names.slice(4, 7).map((n) => n.name)).toEqual([before[5], before[6], before[4]]);
    expect(backups.map((b) => b.slot)).toEqual([4, 5, 6]);
    expect(backups.every((b) => b.name === b.pedalHad)).toBe(true);
  }, 30_000);

  describe("with Experimental pedal commands off on a real pedal", () => {
    beforeAll(() => {
      useDevice.setState({ mode: "webmidi" });
      store().setGp50Extras(false);
    });
    afterAll(() => {
      useDevice.setState({ mode: "mock" });
      store().setGp50Extras(false);
    });

    it("locks the reverse-engineered features and keeps the documented ones", () => {
      expect([...store().features].sort()).toEqual(["modified", "sync"]);
      expect(store().lockedFeatures).toContain("exp");
      expect(store().can("liveOrder")).toBe(false);
    });

    it("falls back to the full write for order, footswitches and tempo, and refuses EXP edits", async () => {
      const pedal = await onPedal();
      const order = pedal.order.join() === "0,1,2,9,3,4,5,6,8,7" ? [0, 1, 2, 9, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 9, 3, 4, 5, 6, 8, 7];
      store().setOrder(order);
      store().setFootswitches([[1], [8]]);
      store().setBpm(pedal.bpm === 100 ? 101 : 100);
      expect(store().unsavedChanges).toBe(3);
      await settle();
      const after = await onPedal();
      expect(after.order).toEqual(pedal.order);
      expect(after.footswitches).toEqual(pedal.footswitches);
      expect(after.bpm).toBe(pedal.bpm);
      expect(() => store().setExp({ on: true })).toThrow(/Experimental pedal commands/);

      await store().saveToSlot(store().slot!);
      const written = await onPedal();
      expect(written.order).toEqual(order);
      expect(written.footswitches).toEqual([[1], [8]]);
      expect(store().unsavedChanges).toBe(0);
    }, 60_000);
  });
});
