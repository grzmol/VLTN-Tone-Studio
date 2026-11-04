// @vitest-environment node
import { describe, expect, it } from "vitest";
import { a2WeightCount, A2_DILATIONS, A2_KERNEL_SIZES, assertWav, checkNam, NamCheckError, prepareNam, selectA2 } from "./nam";
import { firstEmptySlot, gp5Models, linkDevice, linkedSlotOn, modelsVerdict, proposeSlotName, sanitizeSlotName, slotLinkOn, toneVerdict, verdictLabel } from "./tone3000";

const DIL = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const weights = [0.1, -0.2, 0.3, 0.02];

const v05 = {
  version: "0.5.4",
  architecture: "WaveNet",
  config: {
    layers: [
      { input_size: 1, condition_size: 1, head_size: 8, channels: 16, kernel_size: 3, dilations: DIL, activation: "Tanh", gated: false, head_bias: false },
      { input_size: 16, condition_size: 1, head_size: 1, channels: 8, kernel_size: 3, dilations: DIL, activation: "Tanh", gated: false, head_bias: true },
    ],
    head: null,
    head_scale: 0.02,
  },
  weights,
  sample_rate: 48000,
};

const layer07 = (input: number, channels: number, head: number, bias: boolean) => ({
  input_size: input,
  condition_size: 1,
  channels,
  bottleneck: channels,
  kernel_sizes: Array(10).fill(3),
  dilations: DIL,
  activation: Array(10).fill({ type: "Tanh" }),
  gating_mode: Array(10).fill("none"),
  secondary_activation: Array(10).fill(null),
  head: { out_channels: head, kernel_size: 1, bias },
  head1x1: { active: false },
  conv_pre_film: { active: false },
});
const v07 = {
  version: "0.7.0",
  architecture: "WaveNet",
  config: { layers: [layer07(1, 16, 8, false), layer07(16, 8, 1, true)], head: null, head_scale: 0.02 },
  weights,
  sample_rate: 48000,
  metadata: { name: "Gain 4", loudness: -20 },
};

/** A 0.7.0 WaveNet in the A2 shape (NAM core's is_a2_shape) with `channels` channels and the right weight count. */
const a2Net = (channels: number) => ({
  version: "0.7.0",
  architecture: "WaveNet",
  config: {
    layers: [
      {
        input_size: 1,
        condition_size: 1,
        head: { out_channels: 1, kernel_size: 16, bias: true },
        channels,
        bottleneck: channels,
        kernel_sizes: A2_KERNEL_SIZES,
        dilations: A2_DILATIONS,
        activation: A2_KERNEL_SIZES.map(() => ({ type: "LeakyReLU", negative_slope: 0.01 })),
        head1x1: { active: false, out_channels: 1, groups: 1 },
        layer1x1: { active: true, groups: 1 },
        groups_input: 1,
        groups_input_mixin: 1,
        conv_pre_film: { active: false, shift: true, groups: 1 },
        gating_mode: A2_KERNEL_SIZES.map(() => "none"),
        secondary_activation: A2_KERNEL_SIZES.map(() => null),
        slimmable: null,
      },
    ],
    head: null,
    head_scale: 0.01,
  },
  weights: [...Array<number>(a2WeightCount(channels) - 1).fill(0), 0.01],
  sample_rate: 48000,
});
const a2 = (subs: [number, number][] = [[0.5, 3], [1, 8]]) => ({
  version: "0.7.0",
  architecture: "SlimmableContainer",
  sample_rate: 48000,
  config: { submodels: subs.map(([max_value, channels]) => ({ max_value, model: a2Net(channels) })) },
  weights: [],
});

describe("prepareNam", () => {
  it("passes a 0.5.x A1 standard file through unchanged", () => {
    const text = JSON.stringify(v05);
    const out = prepareNam(text);
    expect(out.json).toBe(text);
    expect(out.check).toEqual({ version: "0.5.4", reshaped: false, arch: "A1", size: "standard" });
  });

  it("reshapes a 0.7.0 standard WaveNet into the 0.5.x layout with weights verbatim", () => {
    const out = prepareNam(JSON.stringify(v07));
    expect(out.check).toEqual({ version: "0.7.0", reshaped: true, arch: "A1", size: "standard" });
    const m = JSON.parse(out.json);
    expect(m.version).toBe("0.5.4");
    expect(m.config).toEqual(v05.config);
    expect(m.weights).toEqual(weights);
    expect(m.metadata).toEqual(v07.metadata);
    expect(m.sample_rate).toBe(48000);
  });

  it("accepts every A1 trainer size, like Valeton Suite", () => {
    for (const [size, a, b] of [["lite", 12, 6], ["feather", 8, 4], ["nano", 4, 2]] as const) {
      const m = structuredClone(v05);
      m.config.layers[0] = { ...m.config.layers[0], channels: a, head_size: b };
      m.config.layers[1] = { ...m.config.layers[1], channels: b, input_size: a };
      expect(prepareNam(JSON.stringify(m)).check).toMatchObject({ arch: "A1", size });
    }
  });

  it("passes an A2 container through unchanged and reports the full-size submodel", () => {
    const text = JSON.stringify(a2());
    expect(prepareNam(text)).toEqual({ json: text, check: { version: "0.7.0", reshaped: false, arch: "A2", size: "standard" } });
    expect(checkNam(a2([[1, 3]]))).toMatchObject({ arch: "A2", size: "nano" });
    expect(checkNam(a2Net(8))).toMatchObject({ arch: "A2", size: "standard" });
  });

  it("refuses custom A1 layouts, active features, unsupported rates and versions", () => {
    const custom = structuredClone(v05);
    custom.config.layers[0].channels = 10;
    expect(() => prepareNam(JSON.stringify(custom))).toThrow(/aren't an A1 size/);
    const film = structuredClone(v07);
    film.config.layers[0].conv_pre_film = { active: true };
    expect(() => prepareNam(JSON.stringify(film))).toThrow(/FiLM/);
    const gated = structuredClone(v07);
    gated.config.layers[1].gating_mode[0] = "gated";
    expect(() => prepareNam(JSON.stringify(gated))).toThrow(/gated/);
    expect(() => prepareNam(JSON.stringify({ ...v05, sample_rate: 22050 }))).toThrow(/44.1, 48 or 96 kHz/);
    expect(prepareNam(JSON.stringify({ ...v05, sample_rate: 44100 })).check.size).toBe("standard");
    expect(() => prepareNam(JSON.stringify({ ...v07, architecture: "LSTM" }))).toThrow(/architecture is LSTM/);
    expect(() => prepareNam(JSON.stringify({ ...a2(), version: "0.8.0" }))).toThrow(/aren't supported/);
    expect(() => prepareNam("not json")).toThrow(NamCheckError);
    expect(() => prepareNam("not json")).toThrow(/can't make a SnapTone/);
  });
});

describe("selectA2", () => {
  it("picks the last submodel, as NAM core's ContainerModel does without SetSlimmableSize", () => {
    const pick = selectA2(a2());
    expect(pick.channels).toBe(8);
    expect(pick.sampleRate).toBe(48000);
    expect(pick.model).toEqual(a2Net(8));
  });

  it("applies NAM core's container rules", () => {
    expect(() => selectA2(a2([]))).toThrow(/no submodels/);
    expect(() => selectA2(a2([[1, 8], [0.5, 3]]))).toThrow(/sorted/);
    expect(() => selectA2(a2([[0.5, 3], [0.9, 8]]))).toThrow(/below 1.0/);
    const rates = a2();
    rates.config.submodels[0].model.sample_rate = 44100;
    expect(() => selectA2(rates)).toThrow(/different sample rates/);
  });

  it("refuses a full-size submodel outside the A2 shape", () => {
    const wide = a2([[1, 16]]);
    expect(() => selectA2(wide)).toThrow(/16 channels/);
    const short = a2();
    short.config.submodels[1].model.weights.pop();
    expect(() => selectA2(short)).toThrow(/weights where A2/);
    const tanh = a2();
    tanh.config.submodels[1].model.config.layers[0].activation[3] = { type: "Tanh", negative_slope: 0.01 };
    expect(() => selectA2(tanh)).toThrow(/LeakyReLU/);
    const dil = a2();
    dil.config.submodels[1].model.config.layers[0].dilations = A2_DILATIONS.map((d) => d * 2);
    expect(() => selectA2(dil)).toThrow(/dilations/);
  });
});

describe("assertWav", () => {
  it("accepts RIFF/WAVE and rejects anything else", () => {
    const wav = new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ");
    expect(() => assertWav(wav)).not.toThrow();
    expect(() => assertWav(new TextEncoder().encode("ID3xxxxxxxxxxx"))).toThrow();
  });
});

describe("pedal verdicts", () => {
  const base = { format: "nam" as const, a1_models_count: 0, a2_models_count: 0, custom_models_count: 0, sizes: [] as ("standard" | "lite")[] };
  it("classifies list tones from counts and sizes", () => {
    expect(toneVerdict({ ...base, format: "ir" }).kind).toBe("ir");
    expect(toneVerdict({ ...base, a1_models_count: 2, sizes: ["standard"] }).kind).toBe("ready");
    expect(toneVerdict({ ...base, a1_models_count: 1, sizes: ["lite"] }).kind).toBe("ready");
    expect(toneVerdict({ ...base, a2_models_count: 3, sizes: ["standard"] }).kind).toBe("ready");
    expect(toneVerdict({ ...base, custom_models_count: 1 })).toEqual({ kind: "not-loadable", reason: "custom" });
  });
  it("doesn't throw on a search result without sizes", () => {
    expect(toneVerdict({ ...base, a1_models_count: 1, sizes: undefined })).toEqual({ kind: "not-loadable", reason: "custom" });
    expect(toneVerdict({ ...base, a1_models_count: 1, sizes: null })).toEqual({ kind: "not-loadable", reason: "custom" });
    expect(toneVerdict({ ...base, a2_models_count: 1, sizes: undefined }).kind).toBe("ready");
  });
  it("uses exact models in the sheet, and the local record for the format update", () => {
    expect(modelsVerdict("nam", [{ architecture_version: "2", size: "standard" }]).kind).toBe("ready");
    expect(modelsVerdict("nam", [{ architecture_version: "1", size: "nano" }]).kind).toBe("ready");
    expect(modelsVerdict("nam", [{ architecture_version: "custom", size: "custom" }, { architecture_version: "1", size: "custom" }])).toEqual({ kind: "not-loadable", reason: "custom" });
    const rec = { gp5: { verdict: "reshape" } } as Parameters<typeof modelsVerdict>[2];
    expect(modelsVerdict("nam", [{ architecture_version: "1", size: "standard" }], rec).kind).toBe("reshape");
  });
  it("prefers A2, then the largest A1, keeping TONE3000's order otherwise", () => {
    const models = [
      { id: 1, architecture_version: "1" as const, size: "lite" as const },
      { id: 2, architecture_version: "custom" as const, size: "custom" as const },
      { id: 3, architecture_version: "1" as const, size: "standard" as const },
      { id: 4, architecture_version: "2" as const, size: "standard" as const },
      { id: 5, architecture_version: "2" as const, size: "standard" as const },
    ];
    expect(gp5Models(models).map((m) => m.id)).toEqual([4, 5, 3, 1]);
  });
});

describe("slot helpers", () => {
  it("proposes and sanitizes 10-character pedal names", () => {
    expect(sanitizeSlotName("Plexi 1968 Lead!!")).toBe("Plexi 1968");
    const name = proposeSlotName("EVH 5150III 50W, red channel", "Gain 4");
    expect(name.length).toBeLessThanOrEqual(10);
    expect(name).toMatch(/^5150III/);
    expect(name.endsWith("4")).toBe(true);
  });
  it("finds the first empty user slot in the model's user range", () => {
    const slots = Array.from({ length: 80 }, (_, i) => ({ slot: i, name: i < 50 ? `Factory ${i}` : i < 58 ? `S${i}` : "Empty" }));
    expect(firstEmptySlot("snaptone", slots, "gp5")).toBe(58);
    expect(firstEmptySlot("snaptone", slots, null)).toBeNull();
    expect(firstEmptySlot("ir", [{ slot: 0, name: "A7X" }, { slot: 1, name: "User IR 2" }], "gp50")).toBe(1);
    // GP-200: all 10 SnapTone slots are user slots
    expect(firstEmptySlot("snaptone", [{ slot: 0, name: "AMP-1" }, { slot: 1, name: "" }], "gp200")).toBe(1);
    // GP-200 empty slots keep a name; the pedal's flag says they are empty
    const gp200 = [
      { slot: 0, name: "MY-AMP", kind: "user" as const },
      { slot: 1, name: "SnapTone 2", kind: "empty" as const },
    ];
    expect(firstEmptySlot("snaptone", gp200, "gp200")).toBe(1);
    // Contents the pedal didn't list ("User IR 1" is only the default label) are never proposed for overwriting
    const unlisted = [
      { slot: 0, name: "User IR 1", kind: "unknown" as const },
      { slot: 1, name: "User IR 2", kind: "unknown" as const },
    ];
    expect(firstEmptySlot("ir", unlisted, "gp200lt")).toBeNull();
    expect(firstEmptySlot("ir", [unlisted[0], { slot: 1, name: "User IR 2", kind: "empty" as const }], "gp200lt")).toBe(1);
  });
  it("scopes a slot link to the pedal model it was made on; old records are GP-5 links", () => {
    const old = { gp5: { verdict: "ready" as const, snaptoneSlot: 58, slotName: "5150-RED4" } };
    expect(linkDevice(old)).toBe("gp5");
    expect(slotLinkOn(old, "gp5")).toEqual({ kind: "snaptone", slot: 58, slotName: "5150-RED4", other: null });
    expect(slotLinkOn(old, "gp50")).toMatchObject({ slot: 58, other: "gp5" });
    expect(linkedSlotOn(old, "snaptone", "gp50")).toBeNull();
    expect(linkedSlotOn(old, "snaptone", null)).toBe(58);
    const ir = { gp5: { verdict: "ir" as const, irSlot: 4, slotName: "MESA", device: "gp50" as const } };
    expect(linkedSlotOn(ir, "ir", "gp50")).toBe(4);
    expect(linkedSlotOn(ir, "snaptone", "gp50")).toBeNull();
    expect(slotLinkOn(ir, "gp5")?.other).toBe("gp50");
    expect(slotLinkOn({ gp5: { verdict: "ready" } }, "gp5")).toBeNull();
  });
  it("names the pedal in verdict labels", () => {
    expect(verdictLabel({ kind: "ready" }, "GP-50")).toBe("Ready for GP-50");
    expect(verdictLabel({ kind: "not-loadable", reason: "format" }, "GP-5 / GP-50")).toBe("GP-5 / GP-50 can't load this format");
  });
});
