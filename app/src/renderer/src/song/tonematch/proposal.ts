// From a guitar analysis to a preset proposal for the target pedal (GP-5, GP-50 or a GP-200 model): models from that
// pedal's catalog (the GP-200 family's: the catalog in use, built in or imported), key params, a reason and a
// confidence per block. Pure (no device access); apply.ts plays it on the pedal.
//
// Assumed param scales (Valeton doesn't document them; these are starting points to fine-tune by ear):
//  - amp tone stack and presence: 50 = flat, 4 steps per dB; Guitar EQ bands: ±50 = ±12.5 dB (4 steps per dB).
//  - delay feedback = feedback × 100; delay and reverb Mix = 100 · w / (1 + w) for a wet level w relative to dry.
//  - reverb Decay: RT60 0.3 s → 0, 5 s → 100, linear.
// Models are picked by name. Both families carry the same amp, drive, EQ, delay and reverb names; cabinets differ, so a
// choice lists the GP-5 family's cab first and the GP-200's after it. An imported GP-200 list names the amp's own
// cabinet (Auto CAB Match), which wins. The GP-200 cab numbering (Bellman 1, FOXY 2, UK GRN 1/2) is a best guess.
import { profileFor, type DeviceKey } from "@shared/devices";
import type { Gp200ModelInfo } from "@/gp200/app/catalog-adapter";
import { pedalName } from "@/state/device-model";
import type { BlockCode, ModelInfo } from "@/state/device-types";
import { clampParamValue, defaultParamsFor, modelsFor } from "@/state/preset-codec";
import type { GuitarAnalysis, ToneEstimate } from "./analyse";
import type { GainClass } from "./gain";

export interface ProposedSetting {
  name: string;
  value: number;
  unit?: string;
}

export interface ProposedBlock {
  /** Preset block index (the profile's `blocks` order: GP-5 family 0 NR … 9 NS, GP-200 family 0 PRE … 10 VOL) */
  index: number;
  code: BlockCode;
  enabled: boolean;
  /** Model to load; null keeps the block's current model and params (only on/off changes) */
  fxid: number | null;
  /** Display title of the model (when fxid is set) */
  title: string | null;
  /** Every param slot of the block (when fxid is set) */
  params: number[] | null;
  /** The params worth showing, in catalog order */
  settings: ProposedSetting[];
  why: string;
  /** How sure the analysis behind this block is; null for fixed choices (blocks switched off for a clean audition) */
  confidence: number | null;
}

export interface Proposal {
  /** Pedal model whose catalog the blocks come from; only that pedal can play it */
  device: DeviceKey;
  blocks: ProposedBlock[];
  /** Weighted overall confidence */
  confidence: number;
  summary: string;
}

/** Below this confidence a detected delay or reverb isn't put in the preset. */
export const EFFECT_MIN_CONFIDENCE = 0.35;
export const STEPS_PER_DB = 4;
/** The Guitar EQ's five bands, in refine-offline.ts EQ_CENTERS_HZ order. */
export const EQ_BAND_NAMES = ["125Hz", "400Hz", "800Hz", "1.6kHz", "4kHz"] as const;
const GAIN_LABEL: Record<GainClass, string> = { clean: "Clean", crunch: "Crunch", high: "High gain" };

const fmtDb = (db: number) => `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
const clampStep = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

/** The first of `names` the `device`'s catalog has in block `code` (by name or title, any case). */
function model(device: DeviceKey, code: BlockCode, names: readonly string[]): ModelInfo {
  const pool = modelsFor(device, profileFor(device).blocks.indexOf(code));
  for (const name of names) {
    const q = name.toLowerCase();
    const hit = pool.find((m) => m.name.toLowerCase() === q || m.title.toLowerCase() === q);
    if (hit) return hit;
  }
  throw new Error(`The ${pedalName(device)} effect list has no ${code} model "${names.join('" or "')}"`);
}

/** A block loading `m` with `values` (by param name; unknown names are skipped) on top of the model defaults. */
function withModel(device: DeviceKey, code: BlockCode, m: ModelInfo, values: Record<string, number>, why: string, confidence: number): ProposedBlock {
  const index = profileFor(device).blocks.indexOf(code);
  const params = defaultParamsFor(device, index, m.fxid);
  const settings: ProposedSetting[] = [];
  for (const p of m.params) {
    if (values[p.name] !== undefined) params[p.index] = clampParamValue(p, values[p.name]);
    if (!p.toggle || values[p.name] !== undefined) settings.push({ name: p.name, value: params[p.index], ...(p.unit ? { unit: p.unit } : {}) });
  }
  return { index, code, enabled: true, fxid: m.fxid, title: m.title, params, settings, why, confidence };
}

const keepModel = (device: DeviceKey, code: BlockCode, enabled: boolean, why: string, confidence: number | null): ProposedBlock => ({
  index: profileFor(device).blocks.indexOf(code),
  code,
  enabled,
  fxid: null,
  title: null,
  params: null,
  settings: [],
  why,
  confidence,
});

interface AmpChoice {
  amp: string;
  /** The matching cabinet: the GP-5 family's name, then the GP-200's */
  cab: readonly string[];
  character: string;
}

/** Amp and matching cab for the gain class and the tone's character. */
export function chooseAmp(gainClass: GainClass, score: number, tone: ToneEstimate): AmpChoice {
  const top = tone.trebleDb + tone.presenceDb;
  const bright = top > 3;
  const dark = top < -3;
  if (gainClass === "clean") {
    if (bright) return { amp: "Dark Twin", cab: ["Dark Twin 2x12", "Dark Twin"], character: "bright, sparkly clean" };
    if (dark) return { amp: "Bellman 59N", cab: ["Bellman 2x12", "Bellman 1"], character: "warm, round clean" };
    if (tone.midDb > 2) return { amp: "Foxy 30N", cab: ["Foxy 2x12", "FOXY 2"], character: "mid-forward, chimey clean" };
    return { amp: "J-120 CL", cab: ["J-120 2x12", "J-120"], character: "neutral clean" };
  }
  if (gainClass === "crunch") {
    if (bright) return { amp: "Foxy 30TB", cab: ["Foxy 2x12", "FOXY 2"], character: "bright, chimey crunch" };
    if (dark) return { amp: "Bellman 59B", cab: ["Bellman 2x12", "Bellman 1"], character: "warm, loose crunch" };
    if (score < 0.48) return { amp: "UK 45", cab: ["UK GRN 2x12", "UK GRN 1"], character: "light edge-of-breakup crunch" };
    return { amp: "UK 800", cab: ["UK GRN 4x12", "UK GRN 2"], character: "classic British crunch" };
  }
  if (tone.midDb < -1.5) return { amp: "Mess DualM", cab: ["Mess 4x12", "Mess"], character: "scooped modern high gain" };
  if (tone.midDb > 1.5) return { amp: "EV 51", cab: ["EV 4x12", "EV"], character: "mid-forward modern high gain" };
  if (dark) return { amp: "Bog RedV", cab: ["Bog 4x12", "Bog"], character: "thick, dark high gain" };
  return { amp: "Solo100 LD", cab: ["Solo 4x12", "Solo"], character: "smooth high-gain lead" };
}

/** Amp gain knob within the class range: clean 15–40, crunch 40–65, high gain 60–85. */
export function ampGain(gainClass: GainClass, score: number): number {
  if (gainClass === "clean") return clampStep(15 + (score / 0.4) * 25, 15, 40);
  if (gainClass === "crunch") return clampStep(40 + ((score - 0.4) / 0.25) * 25, 40, 65);
  return clampStep(60 + ((score - 0.65) / 0.35) * 25, 60, 85);
}

/** Half of a deviation as tone-stack steps around 50 (the EQ takes the other half). */
const knob = (db: number) => clampStep(50 + (db / 2) * STEPS_PER_DB, 25, 75);
const eqBand = (db: number) => clampStep((db / 2) * STEPS_PER_DB, -20, 20);

function ampBlock(device: DeviceKey, a: GuitarAnalysis, choice: AmpChoice, m: ModelInfo): ProposedBlock {
  const { gain, tone } = a;
  const values: Record<string, number> = {
    Gain: ampGain(gain.gainClass, gain.score),
    Bass: knob(tone.bassDb),
    Middle: knob(tone.midDb),
    Treble: knob(tone.trebleDb),
    PRES: knob(tone.presenceDb),
    Presence: knob(tone.presenceDb),
    Tone: knob(tone.trebleDb),
    "Tone Cut": clampStep(50 - (tone.trebleDb / 2) * STEPS_PER_DB, 25, 75),
  };
  if (choice.amp === "Dark Twin") values.Bright = 1;
  const why =
    `${GAIN_LABEL[gain.gainClass]} (saturation score ${gain.score.toFixed(2)}): upper harmonics ${fmtDb(gain.hfRatioDb)} against the body, ` +
    `${gain.crestDb.toFixed(1)} dB of pick dynamics. The tone is ${choice.character}, so this amp; its tone stack takes half of the ` +
    `spectrum's difference from a typical guitar (bass ${fmtDb(tone.bassDb)}, mids ${fmtDb(tone.midDb)}, treble ${fmtDb(tone.trebleDb)}).`;
  return withModel(device, "AMP", m, values, why, gain.confidence);
}

/** The amp's own cabinet when the catalog names one (an imported GP-200 list), else the choice's. */
function cabModel(device: DeviceKey, amp: ModelInfo, choice: AmpChoice): ModelInfo {
  const matched = (amp as Partial<Gp200ModelInfo>).cabFxid;
  const cabs = modelsFor(device, profileFor(device).blocks.indexOf("CAB"));
  return (matched !== undefined ? cabs.find((c) => c.fxid === matched) : undefined) ?? model(device, "CAB", choice.cab);
}

function eqBlock(device: DeviceKey, tone: ToneEstimate): ProposedBlock {
  const values = { "125Hz": eqBand(tone.bassDb), "400Hz": eqBand(tone.lowMidDb), "800Hz": eqBand(tone.midDb), "1.6kHz": eqBand(tone.trebleDb), "4kHz": eqBand(tone.presenceDb) };
  const strongest = Math.max(...Object.values(values).map(Math.abs));
  const block = withModel(
    device,
    "EQ",
    model(device, "EQ", ["Guitar EQ 1"]),
    values,
    strongest >= 6
      ? "Shapes the other half of the spectrum's difference from a typical guitar, in five bands (at most ±5 dB). The IR match below measures it properly."
      : "The spectrum is close to a typical guitar, so the EQ stays off.",
    tone.confidence,
  );
  return { ...block, enabled: strongest >= 6 };
}

/**
 * The proposal with its Guitar EQ set from an offline refinement (refine-offline.ts): `eqDb` are the five bands'
 * gains in dB (125 Hz, 400 Hz, 800 Hz, 1.6 kHz, 4 kHz). The EQ is on when a band moves by 1.5 dB or more.
 */
export function withRefinedEq(proposal: Proposal, eqDb: readonly number[], capture: string): Proposal {
  const { device } = proposal;
  const names = EQ_BAND_NAMES;
  const values = Object.fromEntries(names.map((n, i) => [n, clampStep((eqDb[i] ?? 0) * STEPS_PER_DB, -50, 50)]));
  const old = proposal.blocks.find((b) => b.code === "EQ");
  const strongest = Math.max(...Object.values(values).map(Math.abs));
  const block = withModel(
    device,
    "EQ",
    model(device, "EQ", ["Guitar EQ 1"]),
    values,
    `Set from the offline refinement of ${capture}: the five bands that bring its sound closest to the song's guitar (${eqDb.map((g) => fmtDb(g)).join(", ")}).`,
    old?.confidence ?? 0.5,
  );
  return { ...proposal, blocks: proposal.blocks.map((b) => (b.code === "EQ" ? { ...block, enabled: strongest >= 6 } : b)) };
}

/**
 * `proposal` with the amp's Gain and the Guitar EQ set to what was found by recording the pedal (pedal-refine.ts):
 * `takes` rounds, the distance from the song's guitar going from `from` to `to` steps. The rest stays as it was.
 */
export function withTunedOnPedal(proposal: Proposal, knobs: { gain: number; eqDb: readonly number[] }, takes: number, from: number, to: number): Proposal {
  const why = `Tuned on the pedal: ${takes} ${takes === 1 ? "take" : "takes"} of you playing, the distance from the song's guitar going from ${from.toFixed(1)} to ${to.toFixed(1)} steps.`;
  const eq = withRefinedEq(proposal, knobs.eqDb, "")
    .blocks.find((b) => b.code === "EQ");
  const ampIndex = profileFor(proposal.device).blocks.indexOf("AMP");
  return {
    ...proposal,
    blocks: proposal.blocks.map((b) => {
      if (b.code === "EQ" && eq) return { ...eq, enabled: true, why };
      if (b.code !== "AMP" || b.fxid === null || !b.params) return b;
      const gain = modelsFor(proposal.device, ampIndex).find((m) => m.fxid === b.fxid)?.params.find((p) => p.name === "Gain");
      if (!gain) return b;
      const value = clampParamValue(gain, knobs.gain);
      const params = [...b.params];
      params[gain.index] = value;
      return { ...b, params, settings: b.settings.map((s) => (s.name === "Gain" ? { ...s, value } : s)), why: `${b.why} Gain from the takes on the pedal.` };
    }),
  };
}

function delayBlock(device: DeviceKey, a: GuitarAnalysis): ProposedBlock {
  const d = a.delay;
  if (!d.detected || d.confidence < EFFECT_MIN_CONFIDENCE)
    return keepModel(device, "DLY", false, d.detected ? "A possible echo was found, but too uncertain to add (it may be the rhythm of the part)." : "No clear echo in the guitar.", d.confidence);
  const slap = d.timeMs <= 160 && d.feedback < 0.25;
  const name = slap ? "Slapback" : d.dark || d.timeMs > 1000 ? (d.dark && d.timeMs <= 1000 ? "Tape" : "Analog") : "Pure";
  const fb = Math.round(d.feedback * 100);
  const values = { Mix: clampStep((100 * d.level) / (1 + d.level), 5, 60), Time: Math.round(d.timeMs), "F.Back": fb, Feedback: fb };
  const why =
    `Repeats every ${Math.round(d.timeMs)} ms, each about ${Math.round(d.feedback * 100)} % of the one before, the first ${(-20 * Math.log10(d.level + 1e-6)).toFixed(1)} dB under the guitar` +
    (slap ? " (a single short slap)." : d.dark ? "; the repeats lose their highs, like an analog or tape delay." : ".");
  return withModel(device, "DLY", model(device, "DLY", [name]), values, why, d.confidence);
}

function reverbBlock(device: DeviceKey, a: GuitarAnalysis): ProposedBlock {
  const r = a.reverb;
  if (!r.detected || r.confidence < EFFECT_MIN_CONFIDENCE)
    return keepModel(
      device,
      "RVB",
      false,
      r.tails + r.dryOffsets === 0 ? "No note endings to measure a reverb on." : `Notes stop without a clear tail (${r.dryOffsets} dry endings, ${r.tails} with a tail).`,
      r.confidence,
    );
  const name = r.rt60 < 0.7 ? "Room" : r.rt60 < 1.8 ? "Plate" : "Hall";
  const w = 10 ** (r.levelDb / 20);
  const values = { Mix: clampStep((100 * w) / (1 + w), 5, 50), Decay: clampStep(((r.rt60 - 0.3) / 4.7) * 100, 5, 95) };
  const why = `Note endings leave a tail that fades in about ${r.rt60.toFixed(1)} s (RT60), starting ${Math.abs(r.levelDb).toFixed(1)} dB under the note; measured on ${r.tails} endings.`;
  return withModel(device, "RVB", model(device, "RVB", [name]), values, why, r.confidence);
}

/**
 * Build the proposal for `device` (the pedal it will play on). Blocks the analysis doesn't cover (PRE, WAH, MOD, NS) are
 * switched off to keep the audition clean; the GP-200's VOL block (a volume pedal) is left as it is. Blocks come in the
 * model's block order.
 */
export function proposePreset(a: GuitarAnalysis, device: DeviceKey): Proposal {
  const { gain } = a;
  const choice = chooseAmp(gain.gainClass, gain.score, a.tone);
  const boost = gain.gainClass === "high" && gain.score >= 0.8;
  const ampModel = model(device, "AMP", [choice.amp]);
  const amp = ampBlock(device, a, choice, ampModel);
  const cab = withModel(device, "CAB", cabModel(device, ampModel, choice), {}, `The cabinet usually paired with this amp. Record your own match below to replace it with an IR.`, gain.confidence * 0.8);
  const byCode: Partial<Record<BlockCode, ProposedBlock>> = {
    NR: keepModel(device, "NR", gain.gainClass === "high", gain.gainClass === "high" ? "A gate keeps high gain quiet between notes." : "Not needed at this gain.", gain.confidence),
    PRE: keepModel(device, "PRE", false, "Off for the audition.", null),
    WAH: keepModel(device, "WAH", false, "Off for the audition.", null),
    DST: boost
      ? withModel(
          device,
          "DST",
          model(device, "DST", ["Green OD"]),
          { Gain: 10, Tone: 60, VOL: 75, Volume: 75 },
          "Very saturated: a low-gain overdrive in front of the amp tightens the low end, the usual way to get there.",
          gain.confidence * 0.8,
        )
      : keepModel(device, "DST", false, "The amp gives enough drive on its own.", gain.confidence),
    AMP: amp,
    CAB: cab,
    EQ: eqBlock(device, a.tone),
    MOD: keepModel(device, "MOD", false, "Modulation isn't analysed; off for the audition.", null),
    DLY: delayBlock(device, a),
    RVB: reverbBlock(device, a),
    NS: keepModel(device, "NS", false, "No SnapTone in the chain, so the amp model is heard alone.", null),
  };
  const blocks = profileFor(device).blocks.flatMap((code) => byCode[code as BlockCode] ?? []);
  const confidence = 0.4 * gain.confidence + 0.2 * a.tone.confidence + 0.2 * a.delay.confidence + 0.2 * a.reverb.confidence;
  const fx = [byCode.DLY?.enabled ? (byCode.DLY.title ?? "") + " delay" : null, byCode.RVB?.enabled ? (byCode.RVB.title ?? "") + " reverb" : null].filter(Boolean);
  const summary = `${GAIN_LABEL[gain.gainClass]}: ${amp.title} into ${cab.title}${fx.length ? `, ${fx.join(" and ")}` : ", no time effects"}.`;
  return { device, blocks, confidence, summary };
}
