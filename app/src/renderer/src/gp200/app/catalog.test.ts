import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalogFromXml, defaultValue, modelByFxid, optionValues, tempoSyncBinding } from "@/gp200/lib/catalog.mjs";
import { BUILT_IN_CATALOG } from "@/gp200/lib/catalog-data.mjs";
import { BLOCKS, PARAM_COUNT } from "@/gp200/lib/protocol.mjs";
import { host } from "@/host";
import { GP200_BLOCK_TYPES, gp200ModelByFxid, gp200ModelsForBlock } from "./catalog-adapter";
import { NOT_FOUND, useGp200Catalog } from "./catalog-store";

// Synthetic file in the editor's format (written for this test; not Valeton data): an fxid in two blocks, a tempo-sync
// pair, a TrueID menu, a menu with a gap in its TrueIDs, a text default, a MinISOff knob and an amp with a CAB code.
const XML = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  "<GP-200>",
  '  <Catalog Name = "PRE">',
  '    <Alg Name="Test Boost" Module="PRE" Code="26" Index="1">',
  '      <Knob  Name = "Gain"  idx = "0" ID = "0" default = "20" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
  "    </Alg>",
  '    <Alg Name="Test Trem" Module="PRE" Code="16777231" Index="0">',
  '      <Knob  Name = "Rate"  idx = "0" ID = "1" Suffix = "Hz" default = "0.50" Dmin = "0.10" Dmax = "10.00" Type = "1" step = "0.1" valueType = "1" bind="1" />',
  '      <Switch Name = "Sync" default = "0" idx = "1" ID = "6" Type = "3" SubType="Power" bind="0">',
  '        <Menu Name = "OFF" ID= "0" />',
  '        <Menu Name = "ON" ID= "1" />',
  "      </Switch>",
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "DST">',
  '    <Alg Name="Test Boost" Module="DST" Code="26" Index="0">',
  '      <Knob  Name = "Gain"  idx = "0" ID = "0" default = "35" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
  "    </Alg>",
  '    <Alg Name="Mode OD" Module="DST" Code="50331681" Index="1">',
  '      <Combox Name = "Mode" default = "0" idx = "1" ID = "3" Type = "2">',
  '        <Menu Name = "Clean" ID= "0" TrueID = "1"/>',
  '        <Menu Name = "OD" ID= "1" TrueID = "2" />',
  "      </Combox>",
  '      <Combox Name = "Voice" default = "1" idx = "0" ID = "4" Type = "2">',
  '        <Menu Name = "Dark" ID= "0" TrueID = "1"/>',
  '        <Menu Name = "Bright" ID= "1" TrueID = "3" />',
  "      </Combox>",
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "AMP">',
  '    <Alg Name="Test Amp" Module="AMP" Code="117440513" Index="0" CABCode="167772162">',
  '      <Knob  Name = "Detune"  idx = "0" ID = "0" Suffix = "cents" default = "-25 Cents" Dmin = "-50" Dmax = "50" Type = "1" step = "1.0" />',
  '      <Knob  Name = "Low Cut"  idx = "1" ID = "5" Suffix = "Hz" MinISOff = "1" default = "19" Dmin = "19" Dmax = "2000" Type = "1" step = "1.0" />',
  "    </Alg>",
  "  </Catalog>",
  "</GP-200>",
].join("\r\n");

const SOURCE = "/home/me/.wine/drive_c/Program Files/Valeton/GP-200/Resource/GP-200/File/algorithm.xml";
const initial = useGp200Catalog.getState();
// The browser host keeps the catalog in localStorage (Node's own global shadows jsdom's here).
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

beforeEach(() => {
  stored.clear();
  useGp200Catalog.setState(initial, true);
});
afterEach(() => vi.restoreAllMocks());

describe("GP-200 catalog adapters", () => {
  const catalog = buildCatalogFromXml(XML);

  it("models: name, title, block, category, cab match; list order per block", () => {
    const amp = gp200ModelByFxid(catalog, 117440513, "AMP");
    expect(amp).toMatchObject({ fxid: 117440513, block: "AMP", name: "Test Amp", title: "Test Amp", type: GP200_BLOCK_TYPES.AMP, cabFxid: 167772162 });
    expect(gp200ModelsForBlock(catalog, "PRE").map((m) => m.name)).toEqual(["Test Trem", "Test Boost"]);
    expect(gp200ModelsForBlock(catalog, 2).map((m) => m.name)).toEqual(["Test Boost", "Mode OD"]);
    expect(gp200ModelByFxid(catalog, 26, 0)?.params[0].default).toBe(20);
    expect(gp200ModelByFxid(catalog, 26, "DST")?.params[0].default).toBe(35);
    expect(gp200ModelByFxid(catalog, 26, "AMP")).toBeUndefined();
    expect(gp200ModelByFxid(catalog, 117440513, 3)).toBe(amp);
  });

  it("params: index = XML ID, ranges, units, steps, OFF at minimum", () => {
    const [detune, lowCut] = gp200ModelByFxid(catalog, 117440513, "AMP")!.params;
    expect(detune).toEqual({ name: "Detune", index: 0, kind: "Knob", min: -50, max: 50, step: 1, default: -25, unit: "cents" });
    expect(lowCut).toMatchObject({ index: 5, min: 19, max: 2000, unit: "Hz", offAtMin: true });
  });

  it("params: tempo-sync switch, menus with TrueIDs (labels[value - min], values when there are gaps)", () => {
    const [rate, sync] = gp200ModelByFxid(catalog, 16777231, "PRE")!.params;
    expect(rate).toMatchObject({ index: 1, min: 0.1, max: 10, step: 0.1, unit: "Hz" });
    expect(rate.syncs).toBeUndefined();
    expect(sync).toEqual({ name: "Sync", index: 6, kind: "Switch", min: 0, max: 1, step: 1, default: 0, labels: ["OFF", "ON"], toggle: true, syncs: 1 });
    const [voice, mode] = gp200ModelByFxid(catalog, 50331681, "DST")!.params;
    expect(mode).toEqual({ name: "Mode", index: 3, kind: "Combox", min: 1, max: 2, step: 1, default: 1, labels: ["Clean", "OD"] });
    expect(voice).toEqual({ name: "Voice", index: 4, kind: "Combox", min: 1, max: 3, step: 1, default: 3, labels: ["Dark", "2", "Bright"], values: [1, 3] });
  });
});

describe("built-in GP-200 catalog", () => {
  it("has models for every block, and every control fits the pedal's params with a default it can hold", () => {
    for (const block of BLOCKS) expect(gp200ModelsForBlock(BUILT_IN_CATALOG, block).length, block).toBeGreaterThan(0);
    for (const m of BUILT_IN_CATALOG.modules.flatMap((x) => x.algs)) {
      expect(new Set(m.knobs.map((k) => k.id)).size, m.name).toBe(m.knobs.length);
      for (const k of m.knobs) {
        expect(k.id >= 0 && k.id < PARAM_COUNT, `${m.name} ${k.name}`).toBe(true);
        if (k.options) expect(optionValues(k), `${m.name} ${k.name}`).toContain(defaultValue(k));
        else expect(k.default >= k.min! && k.default <= k.max!, `${m.name} ${k.name}`).toBe(true);
      }
    }
  });

  it("pairs tempo-sync switches with their knobs and lists the shared drives in PRE and DST", () => {
    const delay = modelByFxid(BUILT_IN_CATALOG, 184549376, "DLY")!;
    const time = delay.knobs.find((k) => k.name === "Time")!;
    expect(tempoSyncBinding(delay, time)).toMatchObject({ target: time, sync: { name: "Sync", subType: "Power" } });
    for (const block of ["PRE", "DST"]) expect(modelByFxid(BUILT_IN_CATALOG, 50331650, block)?.name, block).toBe("Yellow OD");
  });

  it("uses the pedal's param index where it differs from the control's position", () => {
    const ids = (fxid: number, block: string) => Object.fromEntries(modelByFxid(BUILT_IN_CATALOG, fxid, block)!.knobs.map((k) => [k.name, k.id]));
    // Ping Pong: param 1 is Feedback and param 2 the Time (the synced note division when Sync is on), as presets read off a GP-200 show
    expect(ids(0xb000004, "DLY")).toMatchObject({ Mix: 0, Time: 2, Feedback: 1, Sync: 3, Trail: 4 });
    expect(ids(0xb000003, "DLY")).toMatchObject({ "Time A": 2, "Feedback A": 1, "Time B": 5, "Feedback B": 4 });
    expect(ids(0x3000044, "DST")).toMatchObject({ "Hi-mid": 6, Treble: 8, Attack: 9 });
    expect(ids(0x700005a, "AMP")).toMatchObject({ Presence: 6 });
    // The sync pairs still resolve to the Time knob
    for (const fxid of [0xb000004, 0xb000009]) {
      const m = modelByFxid(BUILT_IN_CATALOG, fxid, "DLY")!;
      const sync = m.knobs.find((k) => k.name === "Sync")!;
      expect(tempoSyncBinding(m, sync)?.target, m.name).toMatchObject({ name: "Time", id: 2 });
    }
  });

  it("lists Hammy under WAH and Auto Swell under NR", () => {
    expect(modelByFxid(BUILT_IN_CATALOG, 0x1000049, "WAH")?.name).toBe("Hammy");
    expect(modelByFxid(BUILT_IN_CATALOG, 0x400002d, "NR")?.name).toBe("Auto Swell");
  });
});

describe("useGp200Catalog", () => {
  it("starts with the built-in list; import builds, keeps and reports it; load() reads it back", async () => {
    await useGp200Catalog.getState().load();
    expect(useGp200Catalog.getState()).toMatchObject({ catalog: BUILT_IN_CATALOG, source: null, savedAt: null, loaded: true, loading: false, error: null });

    await useGp200Catalog.getState().importXml(XML, SOURCE);
    const s = useGp200Catalog.getState();
    expect(s.source).toBe(SOURCE);
    expect(s.catalog.meta.source).toBe("algorithm.xml");
    expect(s.counts).toEqual({ uniqueModels: 4, controls: 8, perBlock: { PRE: 2, DST: 2, AMP: 1 } });
    expect(typeof s.savedAt).toBe("string");

    useGp200Catalog.setState(initial, true);
    await useGp200Catalog.getState().load();
    const again = useGp200Catalog.getState();
    expect(again.counts).toEqual(s.counts);
    expect(again.source).toBe(SOURCE);
    expect(gp200ModelByFxid(again.catalog, 117440513, "AMP")?.name).toBe("Test Amp");
  });

  it("a file that is no catalog fails plainly and keeps the list in use", async () => {
    await expect(useGp200Catalog.getState().importXml("<Other><Thing/></Other>", "other.xml")).rejects.toThrow();
    expect(useGp200Catalog.getState()).toMatchObject({ catalog: BUILT_IN_CATALOG, loading: false, error: expect.stringMatching(/no GP-200 effect catalogs/) });
    await useGp200Catalog.getState().importXml(XML, SOURCE);
    await expect(useGp200Catalog.getState().importXml("<GP-200>", "broken.xml")).rejects.toThrow();
    expect(useGp200Catalog.getState()).toMatchObject({ source: SOURCE });
    expect(useGp200Catalog.getState().error).not.toBeNull();
  });

  it("find automatically: imports the editor's file, or says nothing was found", async () => {
    const find = vi.spyOn(host.gp200Catalog, "findXml").mockResolvedValueOnce(null);
    expect(await useGp200Catalog.getState().findAutomatically()).toBe(false);
    expect(useGp200Catalog.getState()).toMatchObject({ catalog: BUILT_IN_CATALOG, error: NOT_FOUND });
    find.mockResolvedValueOnce({ path: SOURCE, text: XML });
    expect(await useGp200Catalog.getState().findAutomatically()).toBe(true);
    expect(useGp200Catalog.getState()).toMatchObject({ source: SOURCE, error: null });
  });

  it("choose file: a cancelled picker changes nothing", async () => {
    const choose = vi.spyOn(host.gp200Catalog, "chooseXml").mockResolvedValueOnce(null);
    expect(await useGp200Catalog.getState().chooseFile()).toBe(false);
    expect(useGp200Catalog.getState()).toMatchObject({ catalog: BUILT_IN_CATALOG, error: null });
    choose.mockResolvedValueOnce({ path: "algorithm.xml", text: XML });
    expect(await useGp200Catalog.getState().chooseFile()).toBe(true);
    expect(useGp200Catalog.getState()).toMatchObject({ source: "algorithm.xml" });
  });

  it("remove forgets the import and goes back to the built-in list, also after a restart", async () => {
    await useGp200Catalog.getState().importXml(XML, SOURCE);
    await useGp200Catalog.getState().remove();
    expect(useGp200Catalog.getState()).toMatchObject({ catalog: BUILT_IN_CATALOG, source: null, savedAt: null });
    useGp200Catalog.setState(initial, true);
    await useGp200Catalog.getState().load();
    expect(useGp200Catalog.getState().catalog).toBe(BUILT_IN_CATALOG);
  });

  it("a damaged kept copy says so and the built-in list stays", async () => {
    localStorage.setItem("gp200.catalog", JSON.stringify({ catalog: { modules: [] }, source: "x", savedAt: "y" }));
    await useGp200Catalog.getState().load();
    expect(useGp200Catalog.getState()).toMatchObject({ catalog: BUILT_IN_CATALOG, loaded: true, error: expect.stringMatching(/damaged/) });
  });
});
