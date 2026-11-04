// Pure TONE3000 → pedal helpers shared by main and renderer (no I/O).
import { profileFor, type DeviceKey } from "./devices";
import type { T3kGear, T3kModel, T3kTone, ToneRecord } from "./host/tones";

export type Verdict =
  | { kind: "ready" }
  | { kind: "reshape" }
  | { kind: "not-loadable"; reason: "custom" | "format" }
  | { kind: "ir" };

/** A1 sizes Tone Studio renders (the NAM trainer presets); "custom" A1 layouts aren't among them. */
const A1_SIZES = ["standard", "lite", "feather", "nano"];

/**
 * Models Tone Studio turns into SnapTones (GP-5 and GP-50) the way Valeton Suite 2.1.0 does: NAM A1 at the trainer sizes and
 * NAM A2 (Suite renders the A2 container's full-size submodel). Custom architectures aren't rendered here.
 */
export const isGp5Model = (m: Pick<T3kModel, "architecture_version" | "size">) =>
  m.architecture_version === "2" || (m.architecture_version === "1" && A1_SIZES.includes(m.size));

/** Preference for the default model: A2, then A1 from the largest size down. */
const gp5Rank = (m: Pick<T3kModel, "architecture_version" | "size">) => (m.architecture_version === "2" ? 0 : 1 + A1_SIZES.indexOf(m.size));

/**
 * The tone's SnapTone-ready models, best first. A tone that has both an A2 and an A1 of a capture defaults to the A2: both
 * reach the pedal through the same SnapTone conversion (Suite renders either and clones the result), A2 is
 * TONE3000's more accurate architecture, and Tone Studio renders it bit-for-bit like Suite. Ties keep TONE3000's order.
 */
export function gp5Models<M extends Pick<T3kModel, "architecture_version" | "size">>(models: M[]): M[] {
  return models.filter(isGp5Model).sort((a, b) => gp5Rank(a) - gp5Rank(b));
}

/**
 * Verdict from list data only (cards). Exact per-model answers need `models()`; whether a file needs the
 * 0.7 → 0.5.x update is only known after download, so "reshape" comes from the local record.
 */
export function toneVerdict(tone: Pick<T3kTone, "format" | "a1_models_count" | "a2_models_count" | "custom_models_count" | "sizes">, record?: ToneRecord | null): Verdict {
  if (tone.format === "ir") return { kind: "ir" };
  if (tone.format !== "nam") return { kind: "not-loadable", reason: "format" };
  if (record?.gp5.verdict === "reshape") return { kind: "reshape" };
  if (tone.a2_models_count > 0) return { kind: "ready" };
  if (tone.a1_models_count > 0 && tone.sizes?.some((s) => A1_SIZES.includes(s))) return { kind: "ready" };
  return { kind: "not-loadable", reason: "custom" };
}

/** Verdict from the full model list (sheet). */
export function modelsVerdict(format: T3kTone["format"], models: Pick<T3kModel, "architecture_version" | "size">[], record?: ToneRecord | null): Verdict {
  if (format === "ir") return { kind: "ir" };
  if (format !== "nam") return { kind: "not-loadable", reason: "format" };
  if (models.some(isGp5Model)) return record?.gp5.verdict === "reshape" ? { kind: "reshape" } : { kind: "ready" };
  return { kind: "not-loadable", reason: "custom" };
}

/** `pedal`: "GP-5", "GP-50", or "GP-5 / GP-50" when no pedal has been connected yet (SnapTones and IRs suit both). */
export function verdictLabel(v: Verdict, pedal: string): string {
  switch (v.kind) {
    case "ready":
      return `Ready for ${pedal}`;
    case "reshape":
      return `Ready for ${pedal} after a format update`;
    case "ir":
      return "Goes to a User IR slot";
    case "not-loadable":
      return v.reason === "format" ? `${pedal} can't load this format` : "Tone Studio can't convert this (custom layout)";
  }
}

/** Pedal model a record's slot link is on. Links made before GP-50 support carry no model; only the GP-5 existed then. */
export const linkDevice = (record: Pick<ToneRecord, "gp5">): DeviceKey => record.gp5.device ?? "gp5";

/**
 * The record's slot link as seen from `device` (the connected or last connected pedal; null before the first
 * connection, which accepts any link). `other` is the model the link is on when it is not `device`: slot numbers
 * then refer to that pedal, not this one.
 */
export function slotLinkOn(
  record: Pick<ToneRecord, "gp5"> | null | undefined,
  device: DeviceKey | null,
): { kind: "snaptone" | "ir"; slot: number; slotName?: string; other: DeviceKey | null } | null {
  if (!record) return null;
  const { snaptoneSlot, irSlot, slotName } = record.gp5;
  const link = snaptoneSlot !== undefined ? { kind: "snaptone" as const, slot: snaptoneSlot } : irSlot !== undefined ? { kind: "ir" as const, slot: irSlot } : null;
  if (!link) return null;
  const on = linkDevice(record);
  return { ...link, slotName, other: device === null || on === device ? null : on };
}

/** The linked slot of `kind` when it is on `device`'s pedal, else null (see slotLinkOn). */
export function linkedSlotOn(record: Pick<ToneRecord, "gp5"> | null | undefined, kind: "snaptone" | "ir", device: DeviceKey | null): number | null {
  const link = slotLinkOn(record, device);
  return link && link.kind === kind && link.other === null ? link.slot : null;
}

const GEAR_LABEL: Record<T3kGear, string> = {
  amp: "Amp",
  "amp-cab": "Amp + cab",
  pedal: "Pedal",
  outboard: "Outboard",
  cab: "Cab",
  space: "Space",
  experimental: "Experimental",
};
export const gearLabel = (g: string) => GEAR_LABEL[g as T3kGear] ?? g;

/**
 * The capture's gear includes the cab (TONE3000 "amp-cab"; NAM metadata "amp_cab", "amp_pedal_cab"): a cab IR baked
 * into its SnapTone would put a second cab in the chain, so none is offered.
 */
export const gearIncludesCab = (gear: string | null | undefined): boolean => gear === "amp-cab" || gear === "amp_cab" || gear === "amp_pedal_cab";

const LICENSE_LABEL: Record<string, string> = {
  t3k: "TONE3000 license",
  "cc-by": "CC BY, credit the creator",
  "cc-by-sa": "CC BY-SA",
  "cc-by-nc": "CC BY-NC, non-commercial",
  "cc-by-nc-sa": "CC BY-NC-SA",
  "cc-by-nd": "CC BY-ND",
  "cc-by-nc-nd": "CC BY-NC-ND",
  cco: "CC0, public domain",
};
export const licenseLabel = (l: string) => LICENSE_LABEL[l] ?? l;

export const ARCH_LABEL = (m: Pick<T3kModel, "architecture_version" | "size">) =>
  m.architecture_version === "2" ? "A2" : m.architecture_version === "custom" ? "Custom" : m.architecture_version === "1" ? `A1 ${m.size}` : m.size;

/**
 * Pedal name proposal: at most 10 characters, letters/digits/dash, upper case (like the factory list).
 * "EVH 5150III 50W, red channel" + model "Gain 4" → "5150III-G4"-style names are left to the user;
 * we take significant words of the title and fit them.
 */
export function proposeSlotName(title: string, modelName?: string): string {
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, " ")
      .replace(/_/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const words = clean(title).map((w) => w.toUpperCase());
  const tail = modelName ? (clean(modelName).find((w) => /\d/.test(w)) ?? "").toUpperCase() : "";
  let base = words.find((w) => /\d/.test(w) && w.length >= 3) ?? words[0] ?? "TONE";
  const rest = words.filter((w) => w !== base);
  if (rest.length && base.length + 1 + rest[0].length <= 10 - (tail ? tail.length : 0)) base = `${base}-${rest[0]}`;
  const name = tail ? `${base.slice(0, 9 - tail.length)}${tail}` : base;
  return sanitizeSlotName(name);
}

/** Keep names the pedal and file systems both accept: ASCII letters, digits, space, dash; ≤ 10 chars. */
export function sanitizeSlotName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 -]/g, "")
    .trim()
    .slice(0, 10)
    .trim();
}

/** First empty user SnapTone slot (GP-5: 50–79) or User IR slot (0–19) of `device`; null when none or unknown. */
export function firstEmptySlot(kind: "snaptone" | "ir", slots: SlotEntry[] | null, device: DeviceKey | null): number | null {
  if (!slots || !device) return null;
  const p = profileFor(device);
  const [first, last] = kind === "snaptone" ? p.snapTone.userRange : p.userIr.userRange;
  return slots.find((s) => s.slot >= first && s.slot <= last && isEmptySlot(s))?.slot ?? null;
}

/** Pedal slot tables mark empty slots by name: "Empty" (SnapTone) or "User IR n" (IR). */
export const isEmptySlotName = (name: string) => name === "Empty" || name === "" || /^User IR \d+$/.test(name);

/**
 * A SnapTone or User IR slot as the pedal lists it; `kind` is what the pedal reports for it. "unknown": the pedal
 * didn't list its contents (a GP-200LT that never answers 0x1009); the name is only the default label ("User IR 3").
 */
export interface SlotEntry {
  slot: number;
  name: string;
  kind?: "user" | "factory" | "empty" | "unknown";
}

/**
 * The slot holds no capture or IR: the pedal reports it empty (GP-200 family empty slots keep a name, "SnapTone 3"), or
 * its name says so. A slot of unknown contents is never empty: it may hold the user's file.
 */
export const isEmptySlot = (s: Pick<SlotEntry, "name" | "kind">) => s.kind !== "unknown" && (s.kind === "empty" || isEmptySlotName(s.name));
