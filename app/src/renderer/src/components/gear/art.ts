// Shading helpers for the gear drawings. The drawings are the one place
// with hand-tuned colours: block hues mirror the --block-* tokens because the shading math needs hex values
// (art.test.ts keeps the two in step).
import type { BlockCode } from "@/state/device-types";

export const FONT = "'Open Sans Variable', 'Open Sans', system-ui, sans-serif";

export const BLOCK_HEX: Record<BlockCode, string> = {
  NR: "#8e8e93",
  PRE: "#facc15",
  DST: "#ff7a1a",
  NS: "#ec4899",
  AMP: "#ef3b36",
  CAB: "#c2865a",
  EQ: "#a3e635",
  MOD: "#4f7cff",
  DLY: "#2dd4bf",
  RVB: "#a855f7",
  // GP-200 family blocks
  WAH: "#22c55e",
  VOL: "#e2e8f0",
};

/** Amp voicing colours by catalog amp type. */
export const VOICE: Record<string, string> = {
  Clean: "#e9e2cf",
  Drive: "#e2b85f",
  "Hi Gain": "#ef3b36",
  Bass: "#5aa0ff",
  Acoustic: "#d8a46b",
};
export const voiceFor = (type?: string) => (type && VOICE[type]) || VOICE["Hi Gain"];
/** The amp type when it names a voicing (GP-5 family catalog); GP-200 amps carry only their block's category. */
export const voicingOf = (type?: string) => (type && Object.hasOwn(VOICE, type) ? type : undefined);

export const hash = (s: string) => {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
const rgb = (c: string) => {
  const x = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
const hex = (a: number[]) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export const shade = (c: string, f: number) => hex(rgb(c).map((v) => (f < 0 ? v * (1 + f) : v + (255 - v) * f)));
export const lum = (c: string) => {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
/** Font size that fits `t` into `maxW` viewBox units. */
export const fit = (t: string, maxW: number, base: number, caps = false) => Math.min(base, maxW / (Math.max(1, String(t).length) * (caps ? 0.68 : 0.58)));
export const clamp01 = (v: number, min: number, max: number) => Math.max(0, Math.min(1, (v - min) / (max - min || 1)));

export type Finish = "matte" | "noir" | "frost";
export interface FinishInfo {
  kind: Finish;
  body: string;
  accent: string;
}

const WORDS: Record<string, string | null> = {
  green: "#2f9e64",
  yellow: "#e9bd2c",
  black: null,
  red: "#c93a33",
  blue: "#3a6fd8",
  white: null,
  silver: null,
  orange: "#ec7a24",
  purple: "#7a55d6",
  pink: "#d95596",
};

/** Finish from the model name, then the block colour family, then a hash. */
export function finishFor(name: string, base: string, h: number, want?: Finish, color?: string): FinishInfo {
  const pick: Finish = want ?? (["matte", "matte", "matte", "noir", "frost"] as const)[(h >>> 9) % 5];
  const word = Object.keys(WORDS).find((w) => new RegExp(`\\b${w}\\b`, "i").test(name));
  if (word === "black") return { kind: "noir", body: "#1a1a1d", accent: base };
  if (word === "white" || word === "silver") return { kind: "frost", body: "#dcdde1", accent: base };
  const hue = color || (word && WORDS[word]) || base;
  if (pick === "noir") return { kind: "noir", body: "#1a1a1d", accent: hue };
  if (pick === "frost") return { kind: "frost", body: "#dcdde1", accent: hue };
  return { kind: "matte", body: shade(hue, [0, -0.12, 0.08][(h >>> 3) % 3]), accent: lum(hue) > 0.62 ? "#1c1c1e" : "#ffffff" };
}

/** How an amp is dressed: covering, grille cloth, faceplate and knobs. Chosen by `ampStyle` from the model. */
export type ClothKind = "basket" | "diamond" | "sparkle" | "mesh" | "grid";
export type PlateKind = "silver" | "gold" | "black" | "cream" | "blue" | "chrome" | "white";
/** Front layout of a head: a generic one, or after the Marshall, Orange, Mesa or chrome-fronted amps */
export type HeadTemplate = "classic" | "marshall" | "orange" | "mesa" | "chrome" | "peavey" | "diezel";
export interface AmpFinish {
  tolex: string;
  /** "tweed": lacquered cloth with dark stripes instead of leatherette */
  tolexKind: "tolex" | "tweed";
  /** Contrasting piping round the front edge */
  piping: string | null;
  cloth: string;
  clothKind: ClothKind;
  plate: PlateKind;
  /** Printing on the faceplate */
  ink: string;
  /** Knobs: black bakelite (true) or cream/chrome (false) */
  darkKnobs: boolean;
  /** Colour of the insert in a dark knob's cap */
  knobInsert: string | null;
  /** Control plate above the grille ("top") or below it */
  layout: "top" | "bottom";
  handle: "strap" | "chrome" | "none";
  /** Model badge: left, centre or right of the grille */
  badge: "left" | "center" | "right";
  template: HeadTemplate;
}

const BASE: AmpFinish = { tolex: "#151517", tolexKind: "tolex", piping: null, cloth: "#121214", clothKind: "basket", plate: "black", ink: "#f1f1f3", darkKnobs: true, knobInsert: null, layout: "bottom", handle: "strap", badge: "left", template: "classic" };

/** Starting point by voicing (the catalog's amp type). */
const BY_TYPE: Record<string, Partial<AmpFinish>> = {
  Clean: { tolex: "#cdc2a2", cloth: "#4a4f58", clothKind: "sparkle", plate: "silver", ink: "#1b1b1d", darkKnobs: false },
  Drive: { tolex: "#1d1c1b", cloth: "#3b2e18", plate: "gold", ink: "#1c1508", knobInsert: "#d7b25a" },
  "Hi Gain": {},
  Bass: { tolex: "#1c1e23", cloth: "#0f1013", clothKind: "grid", plate: "silver", ink: "#16171b", handle: "chrome" },
  Acoustic: { tolex: "#5c3d24", cloth: "#2e2218", plate: "cream", ink: "#2b1e11" },
};

const GOLD = "#d7b25a";

/** Looks of real amps, recognised in "model name + the gear it models". */
const RULES: [RegExp, Partial<AmpFinish>][] = [
  [/tweed|5e3|5f6|bassman|baseman|\blux\b/i, { tolex: "#caa862", tolexKind: "tweed", cloth: "#6e5233", plate: "cream", ink: "#2a1d10", darkKnobs: false, layout: "top", handle: "chrome", clothKind: "basket" }],
  [/twin|blackface|reverb|roland|jc-?120|jazz/i, { tolex: "#111113", cloth: "#9aa1ab", clothKind: "sparkle", plate: "chrome", ink: "#151517", darkKnobs: false, layout: "top", piping: "#cfd3d9", handle: "strap", badge: "center" }],
  [/vox|ac-?30|ac-?100/i, { tolex: "#b9a47c", cloth: "#2b2216", clothKind: "diamond", plate: "chrome", ink: "#141414", darkKnobs: true, knobInsert: "#d9dce1", layout: "top", handle: "chrome", badge: "center" }],
  [/marshel+|marshall|jcm|jtm|jmp|plexi|brit/i, { tolex: "#111112", cloth: "#1c1812", clothKind: "basket", plate: "gold", ink: "#1b1407", knobInsert: GOLD, layout: "top", piping: "#e6d9a8", handle: "strap", badge: "right", template: "marshall" }],
  [/mesa|boogie|rector|rectifier|messe|lone star|superstar/i, { tolex: "#121214", cloth: "#16171a", clothKind: "mesh", plate: "chrome", ink: "#141416", darkKnobs: false, knobInsert: null, handle: "none", badge: "center", template: "mesa" }],
  [/orange|tangerine|rockerverb/i, { tolex: "#dc7418", cloth: "#3a281a", clothKind: "basket", plate: "white", ink: "#141414", darkKnobs: true, knobInsert: null, layout: "top", handle: "none", badge: "center", template: "orange" }],
  [/diezel|dizzle|vh4/i, { tolex: "#0d0d0f", cloth: "#17181b", clothKind: "mesh", plate: "black", ink: "#dfe8f6", knobInsert: "#cfd5de", handle: "chrome", badge: "center", template: "diezel" }],
  [/engl|engle|powerball|savage|powerengle/i, { tolex: "#0f0f10", cloth: "#18181b", clothKind: "mesh", plate: "black", ink: "#e9ecef", knobInsert: "#c0392b", handle: "chrome", badge: "right", template: "chrome" }],
  [/peavey|5150|eddie|evh/i, { tolex: "#0e0e0f", cloth: "#1a1a1d", clothKind: "mesh", plate: "black", ink: "#f4f4f4", knobInsert: "#f4f4f4", handle: "none", badge: "left", template: "peavey" }],
  [/soldano|soloist|slo/i, { tolex: "#17171a", cloth: "#2a2e36", clothKind: "basket", plate: "silver", ink: "#14161a", handle: "strap", badge: "center", template: "marshall" }],
  [/bogner|boger|xtc/i, { tolex: "#0f1722", cloth: "#2a2118", clothKind: "basket", plate: "chrome", ink: "#10151c", handle: "strap", badge: "right", template: "chrome" }],
  [/friedman|fryman|be-?100/i, { tolex: "#121212", cloth: "#1d1d20", clothKind: "mesh", plate: "black", ink: "#f4f4f4", knobInsert: "#e8e8e8", piping: "#f4f4f4", handle: "chrome", badge: "center", template: "mesa" }],
  [/matchless|emperor|chieftain/i, { tolex: "#3a2a22", cloth: "#7c6a4a", clothKind: "basket", plate: "chrome", ink: "#17120e", darkKnobs: true, knobInsert: "#d9dce1", handle: "chrome", badge: "center" }],
  [/supro|superb/i, { tolex: "#1c3a55", cloth: "#cfc6a6", clothKind: "basket", plate: "cream", ink: "#17212b", handle: "strap", layout: "top", badge: "left" }],
  [/ampeg|svt|ampage/i, { tolex: "#15161a", cloth: "#2a2c31", clothKind: "grid", plate: "silver", ink: "#13141a", knobInsert: "#d9dce1", handle: "chrome", badge: "center" }],
];

/** Boutique looks for models nothing recognises: picked by a hash of the name, so a model always looks the same. */
const BOUTIQUE: Partial<AmpFinish>[] = [
  { tolex: "#1b2638", cloth: "#8a7a52", clothKind: "basket", plate: "chrome", ink: "#10151f", layout: "top", handle: "chrome", badge: "center", template: "classic" },
  { tolex: "#4a1c1d", cloth: "#1e1713", clothKind: "diamond", plate: "gold", ink: "#1b1007", knobInsert: GOLD, handle: "strap", badge: "left", template: "marshall" },
  { tolex: "#1c3427", cloth: "#9ba39a", clothKind: "sparkle", plate: "cream", ink: "#14231b", darkKnobs: false, layout: "top", handle: "strap", badge: "right", template: "classic" },
  { tolex: "#101012", cloth: "#17181c", clothKind: "mesh", plate: "blue", ink: "#f1f4f9", knobInsert: "#cfd5de", handle: "chrome", badge: "center", template: "chrome" },
  { tolex: "#d5cba9", cloth: "#3b2f20", clothKind: "basket", plate: "black", ink: "#f3ecd6", darkKnobs: false, handle: "strap", badge: "left", template: "classic" },
  { tolex: "#33363d", cloth: "#1a1b1f", clothKind: "grid", plate: "chrome", ink: "#131418", layout: "top", handle: "chrome", badge: "right", template: "mesa" },
  { tolex: "#6b2a1a", cloth: "#d2c49a", clothKind: "diamond", plate: "silver", ink: "#1d0f0a", darkKnobs: false, handle: "strap", badge: "center", template: "classic" },
  { tolex: "#14161a", cloth: "#2e3138", clothKind: "mesh", plate: "gold", ink: "#17120a", knobInsert: GOLD, layout: "top", handle: "chrome", badge: "left", template: "chrome" },
];

const strHash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

/** The look of an amp: by voicing, then by the real amp its name or origin recognises, else a boutique look picked from the name. */
export function ampStyle(name: string, origin = "", type?: string): AmpFinish {
  const typed = { ...BASE, ...(type && Object.hasOwn(BY_TYPE, type) ? BY_TYPE[type] : {}) };
  const rule = RULES.find(([re]) => re.test(`${name} ${origin}`));
  if (rule) return { ...typed, ...rule[1] };
  if (type === "Acoustic" || type === "Bass") return typed;
  return { ...typed, ...BOUTIQUE[strHash(name) % BOUTIQUE.length] };
}

/** Look of the default voicing only (kept for drawings that have no model to recognise). */
export const ampFinish = (type?: string): AmpFinish => ampStyle("", "", type);
