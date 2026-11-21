import { afterEach, describe, expect, it } from "vitest";
import { findModel } from "@/gp5/lib/catalog.mjs";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { buildCatalogFromXml, modelByFxid, modelsForBlock } from "@/gp200/lib/catalog.mjs";
import { BUILT_IN_CATALOG } from "@/gp200/lib/catalog-data.mjs";
import { ampGain, chooseAmp, proposePreset, withRefinedEq, withTunedOnPedal } from "./proposal";
import { analysisFixture } from "./test-signals";

const fxid = (name: string, block: string) => findModel(name, block, "gp5")?.fxid;
const neutral = { bassDb: 0, lowMidDb: 0, midDb: 0, trebleDb: 0, presenceDb: 0, confidence: 0.6 };

describe("proposePreset", () => {
  it("builds a scooped high-gain preset with the measured delay and reverb", () => {
    const p = proposePreset(analysisFixture(), "gp5");
    const by = Object.fromEntries(p.blocks.map((b) => [b.code, b]));
    expect(p.device).toBe("gp5");
    expect(p.blocks.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(by.AMP.fxid).toBe(fxid("Mess DualM", "AMP"));
    expect(by.CAB.fxid).toBe(fxid("Mess 4x12", "CAB"));
    expect(by.AMP.settings.find((s) => s.name === "Gain")?.value).toBe(ampGain("high", 0.75));
    expect(by.AMP.settings.find((s) => s.name === "Middle")?.value).toBe(44); // 50 + (−3 / 2)·4
    expect(by.DLY).toMatchObject({ enabled: true, fxid: fxid("Pure", "DLY") });
    expect(by.DLY.settings).toEqual(expect.arrayContaining([{ name: "Time", value: 375, unit: "ms" }, { name: "F.Back", value: 40 }, { name: "Mix", value: 33 }]));
    expect(by.RVB).toMatchObject({ enabled: true, fxid: fxid("Plate", "RVB") });
    expect(by.NR).toMatchObject({ enabled: true, fxid: null });
    for (const code of ["PRE", "MOD", "NS", "DST"]) expect(by[code]).toMatchObject({ enabled: false, fxid: null });
    expect(p.summary).toContain("High gain");
    expect(p.confidence).toBeGreaterThan(0.5);
  });

  it("leaves uncertain or missing time effects off", () => {
    const p = proposePreset(
      analysisFixture({
        delay: { detected: true, timeMs: 250, feedback: 0.9, level: 0.9, dark: false, confidence: 0.2 },
        reverb: { detected: false, rt60: 0, levelDb: -60, tails: 0, dryOffsets: 12, confidence: 0.8 },
      }),
      "gp5",
    );
    expect(p.blocks[7]).toMatchObject({ code: "DLY", enabled: false, fxid: null });
    expect(p.blocks[8]).toMatchObject({ code: "RVB", enabled: false, fxid: null });
    expect(p.summary).toContain("no time effects");
  });

  it("uses a slapback for a short single repeat and a boost for extreme gain", () => {
    const p = proposePreset(
      analysisFixture({
        gain: { gainClass: "high", score: 0.9, confidence: 0.8, flatness: 0.05, hfRatioDb: -16, crestDb: 0.8 },
        delay: { detected: true, timeMs: 110, feedback: 0.05, level: 0.6, dark: false, confidence: 0.8 },
      }),
      "gp5",
    );
    expect(p.blocks[7].fxid).toBe(fxid("Slapback", "DLY"));
    expect(p.blocks[2]).toMatchObject({ code: "DST", enabled: true, fxid: fxid("Green OD", "DST") });
  });

  it.each(["gp5", "gp50"] as const)("keeps every param inside the %s catalog's range", (device) => {
    const p = proposePreset(analysisFixture({ tone: { bassDb: 30, lowMidDb: -30, midDb: 30, trebleDb: -30, presenceDb: 30, confidence: 0.6 } }), device);
    expect(p.device).toBe(device);
    for (const b of p.blocks.filter((x) => x.fxid !== null)) {
      const params = findModel(b.title!, b.code, device)?.params;
      expect(params, `${b.code} ${b.title}`).toBeDefined();
      for (const param of params ?? []) {
        expect(b.params![param.index]).toBeGreaterThanOrEqual(param.min);
        expect(b.params![param.index]).toBeLessThanOrEqual(param.max);
      }
    }
  });
});

describe("proposePreset on the GP-200 family", () => {
  const gp200Fxid = (name: string, block: string) => modelsForBlock(BUILT_IN_CATALOG, block).find((m) => m.name === name)?.code;
  afterEach(() => useGp200Catalog.setState({ catalog: BUILT_IN_CATALOG }));

  it.each(["gp200", "gp200lt", "gp200jr"] as const)("builds a %s preset from the built-in list, VOL left alone", (device) => {
    const p = proposePreset(analysisFixture(), device);
    const by = Object.fromEntries(p.blocks.map((b) => [b.code, b]));
    expect(p.device).toBe(device);
    expect(p.blocks.map((b) => b.code)).toEqual(["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB"]);
    expect(p.blocks.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(by.AMP).toMatchObject({ fxid: gp200Fxid("Mess DualM", "AMP"), enabled: true });
    expect(by.AMP.params).toHaveLength(15);
    expect(by.AMP.settings.find((s) => s.name === "Presence")?.value).toBe(50 + (analysisFixture().tone.presenceDb / 2) * 4);
    expect(by.CAB.fxid).toBe(gp200Fxid("Mess", "CAB"));
    expect(by.DLY).toMatchObject({ enabled: true, fxid: gp200Fxid("Pure", "DLY") });
    expect(by.DLY.settings).toEqual(expect.arrayContaining([{ name: "Time", value: 375 }, { name: "Feedback", value: 40 }]));
    for (const code of ["PRE", "WAH", "MOD", "DST"]) expect(by[code]).toMatchObject({ enabled: false, fxid: null });
  });

  it("keeps every param inside the GP-200 list's ranges", () => {
    const p = proposePreset(analysisFixture({ tone: { bassDb: 30, lowMidDb: -30, midDb: 30, trebleDb: -30, presenceDb: 30, confidence: 0.6 } }), "gp200");
    for (const b of p.blocks.filter((x) => x.fxid !== null)) {
      for (const k of modelByFxid(BUILT_IN_CATALOG, b.fxid!, b.code)!.knobs.filter((x) => x.min !== undefined)) {
        expect(b.params![k.id], `${b.code} ${k.name}`).toBeGreaterThanOrEqual(k.min!);
        expect(b.params![k.id], `${b.code} ${k.name}`).toBeLessThanOrEqual(k.max!);
      }
    }
  });

  it("takes the amp's own cabinet from an imported list (Auto CAB Match), and fails plainly when a model is missing", () => {
    const xml = (cabCode: string) =>
      [
        "<GP-200>",
        ...["PRE", "WAH", "DST", "NR", "MOD"].map((b, i) => `<Catalog Name = "${b}"><Alg Name="X${b}" Module="${b}" Code="${900 + i}" Index="0" /></Catalog>`),
        `<Catalog Name = "AMP"><Alg Name="Mess DualM" Module="AMP" Code="117440600" Index="0" ${cabCode} /></Catalog>`,
        '<Catalog Name = "CAB"><Alg Name="Mess" Module="CAB" Code="167772200" Index="0" /><Alg Name="Big Box" Module="CAB" Code="167772201" Index="1" /></Catalog>',
        '<Catalog Name = "EQ"><Alg Name="Guitar EQ 1" Module="EQ" Code="16777269" Index="0" /></Catalog>',
        '<Catalog Name = "DLY"><Alg Name="Pure" Module="DLY" Code="184549376" Index="0" /></Catalog>',
        '<Catalog Name = "RVB"><Alg Name="Plate" Module="RVB" Code="201326595" Index="0" /></Catalog>',
        "</GP-200>",
      ].join("\n");
    useGp200Catalog.setState({ catalog: buildCatalogFromXml(xml('CABCode="167772201"')) });
    expect(proposePreset(analysisFixture(), "gp200").blocks.find((b) => b.code === "CAB")?.title).toBe("Big Box");
    useGp200Catalog.setState({ catalog: buildCatalogFromXml(xml("").replace("Mess DualM", "Other Amp")) });
    expect(() => proposePreset(analysisFixture(), "gp200")).toThrow(/no AMP model "Mess DualM"/);
  });
});

describe("chooseAmp", () => {
  it("picks by gain class and tone character", () => {
    expect(chooseAmp("clean", 0.1, { ...neutral, trebleDb: 3, presenceDb: 2 }).amp).toBe("Dark Twin");
    expect(chooseAmp("clean", 0.1, neutral).amp).toBe("J-120 CL");
    expect(chooseAmp("crunch", 0.55, neutral).amp).toBe("UK 800");
    expect(chooseAmp("crunch", 0.42, neutral).amp).toBe("UK 45");
    expect(chooseAmp("high", 0.7, { ...neutral, midDb: 2 }).amp).toBe("EV 51");
    expect(chooseAmp("high", 0.7, neutral).amp).toBe("Solo100 LD");
  });

  it("maps the score into each class's gain range", () => {
    expect(ampGain("clean", 0)).toBe(15);
    expect(ampGain("crunch", 0.65)).toBe(65);
    expect(ampGain("high", 1)).toBe(85);
  });
});

describe("withTunedOnPedal", () => {
  const base = proposePreset(analysisFixture(), "gp5");
  const by = (p: ReturnType<typeof proposePreset>, code: string) => p.blocks.find((b) => b.code === code)!;

  it("puts the amp's Gain and the five EQ bands found on the pedal into the proposal, and says how", () => {
    const p = withTunedOnPedal(base, { gain: 63, eqDb: [-3, -4, 0, 1.5, 3] }, 4, 4.5, 0.9);
    expect(by(p, "AMP").settings.find((s) => s.name === "Gain")?.value).toBe(63);
    const gain = findModel("Mess DualM", "AMP", "gp5")!.params.find((x: { name: string }) => x.name === "Gain")!;
    expect(by(p, "AMP").params![gain.index]).toBe(63);
    const eq = by(p, "EQ");
    expect(eq.enabled).toBe(true);
    expect(["125Hz", "400Hz", "800Hz", "1.6kHz", "4kHz"].map((n) => eq.settings.find((s) => s.name === n)?.value)).toEqual([-12, -16, 0, 6, 12]);
    expect(eq.why).toContain("4 takes");
    expect(eq.why).toContain("4.5 to 0.9");
  });

  it("keeps every other block and the amp's other knobs as they were", () => {
    const p = withTunedOnPedal(base, { gain: 20, eqDb: [0, 0, 0, 0, 0] }, 1, 3, 2);
    expect(p.blocks.filter((b) => b.code !== "AMP" && b.code !== "EQ")).toEqual(base.blocks.filter((b) => b.code !== "AMP" && b.code !== "EQ"));
    const was = by(base, "AMP").params!;
    const now = by(p, "AMP").params!;
    expect(now.filter((_, i) => i !== was.findIndex((v, j) => v !== now[j]))).toEqual(was.filter((_, i) => i !== was.findIndex((v, j) => v !== now[j])));
  });
});

describe("withRefinedEq", () => {
  const base = proposePreset(analysisFixture({ tone: { ...neutral, confidence: 0.6 } }), "gp5");
  const eq = (p: ReturnType<typeof proposePreset>) => p.blocks.find((b) => b.code === "EQ")!;

  it("sets the five Guitar EQ bands from the refined gains (4 steps per dB) and turns the EQ on", () => {
    expect(eq(base).enabled).toBe(false);
    const p = withRefinedEq(base, [3, -2.5, 0, 6, -12], "Some Capture");
    const b = eq(p);
    expect(b.enabled).toBe(true);
    const band = (n: string) => b.settings.find((s) => s.name === n)?.value;
    expect(["125Hz", "400Hz", "800Hz", "1.6kHz", "4kHz"].map(band)).toEqual([12, -10, 0, 24, -48]);
    expect(b.why).toContain("Some Capture");
  });

  it("leaves the EQ off when no band moves by 1.5 dB, and every other block as it was", () => {
    const p = withRefinedEq(base, [0.5, -1, 0, 1, 0.2], "x");
    expect(eq(p).enabled).toBe(false);
    expect(p.blocks.filter((b) => b.code !== "EQ")).toEqual(base.blocks.filter((b) => b.code !== "EQ"));
  });
});
