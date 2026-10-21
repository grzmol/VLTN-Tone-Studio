// The device store on the simulated GP-200 family: connect and sync, live edits, the GP-200 patch fields, save, rename,
// write, the effect catalog (built in, then the user's import), and a clean protocol log.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { buildCatalogFromXml } from "@/gp200/lib/catalog.mjs";
import { BUILT_IN_CATALOG } from "@/gp200/lib/catalog-data.mjs";
import { GLOBAL_EQ_INDEX } from "@/gp200/lib/protocol.mjs";
import { host } from "@/host";
import { profileFor } from "@shared/devices";
import { getDriver, useDevice } from "./device";
import { acksFrames, attachedDevice, writeFrameCount } from "./device-model";
import type { Gp200Driver } from "./driver/gp200-driver";
import { GP200_EQ_DEFAULTS } from "./driver/gp200-globals";
import { editPrst, toPresetState } from "./preset-codec";

const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

const store = () => useDevice.getState();
const driver = () => getDriver() as Gp200Driver;
/** The edit buffer as the simulated pedal holds it now. */
const onPedal = async () => toPresetState(0, await driver().readEditBuffer(""), store().device);
/** What the simulated pedal stores in `slot` (a read that selects nothing). */
const storedIn = async (slot: number) => toPresetState(slot, await driver().readPreset(slot), store().device);
/** Wait until the coalesced live sends reached the simulator (`check` passes). */
const until = (check: () => Promise<void>) => vi.waitFor(check, { timeout: 5000, interval: 50 });

// Synthetic catalog in the editor's format (written for this test; not Valeton data): a PRE model and an amp.
const XML = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  "<GP-200>",
  '  <Catalog Name = "PRE">',
  '    <Alg Name="Test Boost" Module="PRE" Code="26" Index="0">',
  '      <Knob  Name = "Gain"  idx = "0" ID = "0" default = "20" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "AMP">',
  '    <Alg Name="Test Amp" Module="AMP" Code="117440513" Index="0">',
  '      <Knob  Name = "Detune"  idx = "0" ID = "0" Suffix = "cents" default = "-25 Cents" Dmin = "-50" Dmax = "50" Type = "1" step = "1.0" />',
  "    </Alg>",
  "  </Catalog>",
  "</GP-200>",
].join("\r\n");

describe("GP-200 in the device store", () => {
  beforeAll(async () => {
    await store().connect("mock", { mockDevice: "gp200" });
  }, 30_000);
  afterAll(async () => {
    await store().disconnect();
  });

  it("connects with the built-in effect list: every block is there with its model, the GP-200 fields read", () => {
    const s = store();
    expect(s.device).toBe("gp200");
    expect([...s.features].sort()).toEqual(["exportPreset", "globalEq", "liveBpm", "modified"]);
    const p = s.preset!;
    expect(p.blocks).toHaveLength(11);
    expect(p.blocks.every((b) => b.params.length === 15 && b.model !== undefined)).toBe(true);
    expect(p.blocks[3].model?.name).toBe("Mess2C+ 2");
    expect(p.exp).toBeNull();
    expect(p.footswitches).toHaveLength(8);
    expect(p.gp200?.exp).toHaveLength(9);
    expect(p.gp200?.quickAccess).toHaveLength(3);
    expect(s.unsavedChanges).toBe(0);
    // The write dialog counts the frames of a GP-200 full write, which the pedal doesn't acknowledge
    expect([writeFrameCount(p.prst), acksFrames("gp200")]).toEqual([7, false]);
  });

  it("keeps the export read and live tempo open on a real GP-200; the Global EQ write is experimental", () => {
    useDevice.setState({ mode: "webmidi" });
    store().setGp50Extras(false);
    expect([...store().features].sort()).toEqual(["exportPreset", "liveBpm", "modified"]);
    expect(store().lockedFeatures).toEqual(["globalEq"]);
    expect(() => store().setGlobalEq(GLOBAL_EQ_INDEX.level, 60)).toThrow(/Experimental pedal commands/);
    useDevice.setState({ mode: "mock" });
    store().setGp50Extras(false);
  });

  it("sets Global EQ values live, starting from the factory values until the pedal reports its own", async () => {
    expect(store().globalEq).toEqual({ values: GP200_EQ_DEFAULTS, read: false });
    store().setGlobalEq(GLOBAL_EQ_INDEX.level, 70.4);
    store().setGlobalEq(GLOBAL_EQ_INDEX.band2.gain, -30);
    expect([store().globalEq!.values[GLOBAL_EQ_INDEX.level], store().globalEq!.values[GLOBAL_EQ_INDEX.band2.gain]]).toEqual([70, -20]);
    await until(async () => expect([driver().mock!.globalEq[GLOBAL_EQ_INDEX.level], driver().mock!.globalEq[GLOBAL_EQ_INDEX.band2.gain]]).toEqual([70, -20]));
    expect(() => store().setGlobalEq(2, 1)).toThrow(RangeError);
    expect(store().unsavedChanges).toBe(0);
  });

  it("plays param, on/off, volume and tempo edits live; tempo stops at 250", async () => {
    const enabled = store().preset!.blocks[5].enabled;
    store().setParam(2, 0, 42);
    store().setBlockEnabled(5, !enabled);
    store().setVolume(77);
    store().setBpm(300);
    expect(store().preset!.bpm).toBe(250);
    await until(async () => {
      const p = await onPedal();
      expect([p.blocks[2].params[0], p.blocks[5].enabled, p.volume, p.bpm]).toEqual([42, !enabled, 77, 250]);
    });
    expect(store().unsavedChanges).toBe(4);
  });

  it("keeps the GP-200 fields and CTRL assignments local until saved, then writes them", async () => {
    const before = await onPedal();
    store().editPatch({ pan: -20, author: "Tester", quickAccess: { 1: { block: 3, param: 1 } } });
    store().setFootswitches(store().preset!.footswitches.map((l, i) => (i === 0 ? [2, 3] : l)));
    expect(store().preset!.gp200).toMatchObject({ pan: -20, author: "Tester" });
    expect(store().unsavedChanges).toBe(8);
    expect((await onPedal()).gp200?.pan).toBe(before.gp200?.pan);

    const slot = store().slot!;
    await store().saveToSlot(slot);
    expect(store().unsavedChanges).toBe(0);
    const saved = await storedIn(slot);
    expect(saved.gp200).toMatchObject({ pan: -20, author: "Tester" });
    expect(saved.gp200?.quickAccess[1]).toMatchObject({ block: 3, param: 1 });
    expect(saved.footswitches[0]).toEqual([2, 3]);
    expect([saved.blocks[2].params[0], saved.volume, saved.bpm]).toEqual([42, 77, 250]);
  }, 30_000);

  it("keeps unsaved edits counted after Read pedal again: the pedal reports its edited buffer", async () => {
    const volume = store().preset!.volume === 41 ? 42 : 41;
    store().setVolume(volume);
    await until(async () => expect(driver().mock!.dirty).toBe(true));
    await store().sync();
    expect(store().preset!.volume).toBe(volume);
    expect(store().saved!.volume).not.toBe(volume);
    expect(store().unsavedChanges).toBe(1);
    await store().discard();
    expect(store().unsavedChanges).toBe(0);
  }, 30_000);

  it("refuses to rename the active slot while it has unsaved edits, then renames it", async () => {
    const slot = store().slot!;
    store().setVolume(60);
    await expect(store().rename(slot, "Too Early")).rejects.toMatchObject({ code: "unsaved" });
    await store().discard();
    expect(store().unsavedChanges).toBe(0);
    await store().rename(slot, "Live Name");
    expect(store().names[slot].name).toBe("Live Name");
    expect(store().preset!.name).toBe("Live Name");
    expect((await storedIn(slot)).name).toBe("Live Name");
  }, 30_000);

  it("renames another slot with a verified write, leaving the active one alone", async () => {
    const slot = store().slot!;
    const other = (slot + 5) % profileFor("gp200").slotCount;
    await store().rename(other, "Other Name");
    expect(store().names[other].name).toBe("Other Name");
    expect((await storedIn(other)).name).toBe("Other Name");
    expect(store().slot).toBe(slot);
  }, 30_000);

  it("writes a preset into another slot and makes it the active one", async () => {
    const target = (store().slot! + 9) % profileFor("gp200").slotCount;
    await store().writePreset(target, editPrst(store().preset!.prst, { name: "Written", volume: 33 }));
    expect(store().slot).toBe(target);
    expect(store().preset).toMatchObject({ name: "Written", volume: 33 });
    expect(store().names[target].name).toBe("Written");
    expect((await storedIn(target)).volume).toBe(33);
  }, 30_000);

  it("describes the blocks from the user's catalog once it is imported, and from the built-in one after", async () => {
    await store().writePreset(store().slot!, editPrst(store().preset!.prst, { blocks: { 0: { fxid: 26 }, 3: { fxid: 117440513 } } }));
    expect(store().preset!.blocks[3].model?.name).toBe("Tweedy");

    await useGp200Catalog.getState().importXml(XML, "algorithm.xml");
    const [pre, amp] = [store().preset!.blocks[0].model, store().preset!.blocks[3].model];
    expect([pre?.name, pre?.params[0].default, amp?.name]).toEqual(["Test Boost", 20, "Test Amp"]);
    expect(store().saved!.blocks[3].model?.name).toBe("Test Amp");
    store().setParam(3, 0, 999);
    expect(store().preset!.blocks[3].params[0]).toBe(50);

    await useGp200Catalog.getState().remove();
    expect(store().preset!.blocks[3].model?.name).toBe("Tweedy");
    await store().discard();
  }, 30_000);

  it("leaves no protocol violations in the simulator", () => {
    expect(driver().mock!.violations).toEqual([]);
  });
});

describe("GP-200 with a catalog imported before it connects", () => {
  afterAll(async () => {
    await useGp200Catalog.getState().remove();
    await store().disconnect();
  });

  it("describes the first preset with it", async () => {
    // The simulator's generated amp (0x0700003A) in a synthetic catalog, kept where the app reads it at startup
    const xml = XML.replace('Name="Test Amp" Module="AMP" Code="117440513"', 'Name="Init Amp" Module="AMP" Code="117440570"');
    await host.gp200Catalog.save(buildCatalogFromXml(xml), "algorithm.xml");
    useGp200Catalog.setState({ catalog: BUILT_IN_CATALOG, source: null, savedAt: null, loaded: false });
    await store().connect("mock", { mockDevice: "gp200" });
    expect(store().preset!.blocks[3].model?.name).toBe("Init Amp");
  }, 30_000);
});

describe("GP-200 connecting after a GP-50", () => {
  afterAll(async () => {
    await store().disconnect();
  });

  it("names the pedal by its port while it syncs, before the remembered model changes", async () => {
    useDevice.setState({ device: "gp50" });
    const seen: { status: string; device: string | null; attached: string | null }[] = [];
    const off = useDevice.subscribe((s) => {
      if (s.portName && !seen.length) seen.push({ status: s.status, device: s.device, attached: attachedDevice(s) });
    });
    await store().connect("mock", { mockDevice: "gp200" });
    off();
    expect(seen[0]).toEqual({ status: "connecting", device: "gp50", attached: "gp200" });
    expect([store().device, attachedDevice(store())]).toEqual(["gp200", "gp200"]);
  }, 30_000);
});
