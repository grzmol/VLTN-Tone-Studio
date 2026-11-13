// The arrangement: which style, energy, fill and parts play in each section of a song, and the song-wide settings the user tunes.
// Pure data and rules. The settings travel in the song's options, so anything read back from a saved song goes through
// parseBandSettings, which keeps valid fields and falls back to the defaults for the rest.

import { sortedSections, type Section } from "../performance/sections";
import {
  autoBass,
  BASS_PART_CHOICES,
  DEFAULT_BASS_PARTS,
  OCTAVE_SHIFTS,
  partForBassMode,
  type BassLead,
  type BassPart,
  type BassPartChoice,
  type OctaveShift,
} from "./bass-parts";
import { DEFAULT_ENDING, isEnding, parseEnding, type EndingSettings } from "./ending";
import { parseBassOverrides, type BassOverride } from "./bass-overrides";
import { findStyle } from "./styles";
import { ENERGIES, HUMANISE_FEELS, STYLE_IDS, type Energy, type StyleId } from "./styles/types";

export const DRUM_KITS = ["standard"] as const;
export const BASS_SOUNDS = ["finger", "pick"] as const;
export const BASS_RANGES = ["low", "normal", "high"] as const;
export const BASS_MODES = ["roots", "fifths", "octaves", "melodic", "walking"] as const;
/** Where the generated bass's notes come from: the bass the song's own bassist played (when the song has a bass stem), or the chords. */
export const BASS_FROM = ["original", "chords"] as const;
/** Where follow-my-playing reads its accents: a stem the band plays, or the song's mix. "auto" takes the first stem that exists. */
export const FOLLOW_SOURCES = ["auto", "guitar", "piano", "other", "mix"] as const;
/** The choices of the humanise feel: "style" is the style's own default, the rest are fixed feels. */
export const HUMANISE_CHOICES = ["style", ...HUMANISE_FEELS] as const;

export type DrumKit = (typeof DRUM_KITS)[number];
export type BassSound = (typeof BASS_SOUNDS)[number];
export type BassRange = (typeof BASS_RANGES)[number];
export type BassMode = (typeof BASS_MODES)[number];
export type BassFrom = (typeof BASS_FROM)[number];
export type FollowSource = (typeof FOLLOW_SOURCES)[number];
export type HumaniseChoice = (typeof HUMANISE_CHOICES)[number];

/** How the generated drums and bass are humanised: the amount from 0 (exactly on the grid) to 1, and the feel. */
export interface HumaniseSettings {
  amount: number;
  feel: HumaniseChoice;
}

/** Where a part tone's capture or IR comes from: a TONE3000 download, or a file on this computer. */
export const PART_TONE_SOURCES = ["tone3000", "file"] as const;
export type PartToneSource = (typeof PART_TONE_SOURCES)[number];
/** The bass names of the part tone's types, kept so the bass code reads as it did (spec 83). */
export const BASS_TONE_SOURCES = PART_TONE_SOURCES;
export type BassToneSource = PartToneSource;

/** Input drive and output level of a part tone's block, in dB. */
export const BASS_TONE_INPUT_DB: readonly [number, number] = [-12, 12];
export const BASS_TONE_OUTPUT_DB: readonly [number, number] = [-24, 12];

/**
 * A capture or IR a part tone uses. A TONE3000 file is named by its tone and model, so it can be downloaded again; a file from
 * this computer is named by its absolute path.
 */
export interface PartToneFile {
  source: PartToneSource;
  /** The TONE3000 tone the file was downloaded from. */
  toneId?: number;
  /** The model of that tone to download. */
  modelId?: number;
  /** Absolute path of a local file. */
  path?: string;
  /** True for a TONE3000 capture that is an A1 model (an older capture), so the panel can say so. */
  older?: boolean;
  /** The name the Band panel shows. */
  name: string;
}
export type BassToneFile = PartToneFile;

/** The parts a performer can bring back rendered audio for. */
export type RenderedKind = "drums" | "bass";
export const RENDERED_KINDS: readonly RenderedKind[] = ["drums", "bass"];

/** A part that was rendered outside the app and brought back as audio (rendered.ts). The audio is the part's track in the song. */
export interface RenderedPart {
  /** The file name the performer used, shown in the panel. */
  name: string;
  /** When the file was brought in, ISO 8601. */
  importedAt: string;
}

/** The roles a block of a part tone chain can play. Pedals, outboard gear, a preamp and an amp are captures; a cab and a space are IRs. */
export const TONE_ROLES = ["pedal", "preamp", "amp", "cab", "space", "outboard"] as const;
export type ToneRole = (typeof TONE_ROLES)[number];
/** What a block's file is: a NAM capture (pedal, preamp, amp) or an impulse response (cab, space). */
export const TONE_BLOCK_TYPES = ["capture", "ir"] as const;
export type ToneBlockType = (typeof TONE_BLOCK_TYPES)[number];
export const TONE_BLOCK_TYPE: Record<ToneRole, ToneBlockType> = {
  pedal: "capture",
  preamp: "capture",
  amp: "capture",
  cab: "ir",
  space: "ir",
  outboard: "capture",
};
/** The generated parts that can have a tone chain. */
export type TonePart = "bass" | "drums";
/** The roles each part's chain offers, in the order the panel lists them. */
export const PART_ROLES: Record<TonePart, readonly ToneRole[]> = {
  bass: ["pedal", "preamp", "amp", "cab", "space"],
  drums: ["outboard", "preamp", "space"],
};
/** The most blocks a part tone chain holds. */
export const MAX_TONE_BLOCKS = 6;

/** One block of a part tone chain: a capture or an IR, with its drive and output level, its wet mix, and whether it is on. */
export interface ToneBlock {
  type: ToneBlockType;
  role: ToneRole;
  /** The chosen file. Null is an empty slot (a preset's): it plays nothing until a file is chosen. */
  file: PartToneFile | null;
  /** Input drive, in dB (BASS_TONE_INPUT_DB). */
  inputDb: number;
  /** Output level, in dB (BASS_TONE_OUTPUT_DB). */
  outputDb: number;
  /** How much of the block's output is mixed in, against its own input: 0 bypasses it, 1 is all wet. */
  mix: number;
  /** A block that is off is left out of the chain, as if it were not there. */
  on: boolean;
}

/**
 * A part's tone. "clean" is the generated sample as it is. "chain" plays it through its blocks in order, then mixes the result with the
 * dry sample by `dryWet` (0 dry, 1 all chain). `fast` renders captures at their Lite size where the file has one.
 */
export type PartTone = { kind: "clean" } | { kind: "chain"; blocks: ToneBlock[]; dryWet: number; fast: boolean };
export type BassTone = PartTone;

/** The key the overrides of a song without sections are kept under. Section ids are UUIDs, so this cannot clash with one. */
export const WHOLE_SONG_ID = "song";

/** The top of the swing range. Full swing (1) would put the off-beat at the very end of its step. */
export const SWING_MAX = 0.75;

export interface PartToggles {
  drums: boolean;
  bass: boolean;
}

/** What one section plays. Times are song seconds, and the plans cover the whole song with no gaps. */
export interface SectionPlan {
  /** The section this plan came from, or null when the song has no sections. */
  sectionId: string | null;
  /** The section's name, which the bass checks for a change into the next section. Empty for a song without sections. */
  name: string;
  start: number;
  end: number;
  style: StyleId;
  energy: Energy;
  /** How loud the generated drums and bass play in the section, 1 soft to 5 hard. Defaults to the energy. */
  loud: Energy;
  /** How busy the bass and drums play in the section, 1 sparse to 5 busy. Defaults to the energy. */
  busy: Energy;
  /** The bass part the section plays, resolved from the choice: never "auto". */
  bassPart: BassPart;
  /** The part the first bars of the section play before `bassPart`, when Auto gives one (an intro's pedal). */
  bassLead?: BassLead;
  /** True when the last two bars of the section push the loud level up by one (a pre-chorus building). */
  bassRamp: boolean;
  /** How many phrase variations the bass plays, 0 (none) to 3 (one in every phrase, up to four notes). */
  fills: Fills;
  /** Slides into downbeat notes after a rest (bass.ts). From the style unless the section says otherwise. */
  slides: boolean;
  /** Muted dead notes between notes at busy 3 and up. From the style unless the section says otherwise. */
  deadNotes: boolean;
  /** Pickups into a phrase's last bar. From the style unless the section says otherwise. */
  pickups: boolean;
  /** The first note of the section is long and hit harder. True for a chorus that follows a section of another kind. */
  hitTheOne: boolean;
  /** The octave the section's bass is moved by, within the range. */
  octave: OctaveShift;
  /** A fill on the section's last bar. */
  fill: boolean;
  play: PartToggles;
}

/** What a section can change. Anything not set falls back to the song's settings or to the section's own name and position. */
export type SectionOverride = Partial<Omit<SectionPlan, "name" | "bassPart" | "bassLead" | "bassRamp">> & { bassPart?: BassPartChoice };

/** The bass fills a section can have: 0 (none) to 3 (a variation in every phrase). */
export type Fills = 0 | 1 | 2 | 3;
export const FILLS: readonly Fills[] = [0, 1, 2, 3];

/**
 * The default fills for a section, from its name. An intro and an outro have none, a chorus has the most, and a verse, a pre-chorus, a
 * bridge and any other section have one. The first match wins, so a pre-chorus is not taken for a chorus.
 */
export function defaultFills(name: string): Fills {
  if (/intro|outro/i.test(name)) return 0;
  if (/pre[\s-]*chorus/i.test(name)) return 1;
  if (/chorus/i.test(name)) return 2;
  return 1;
}

export interface BandSettings {
  parts: PartToggles;
  style: StyleId;
  /** 0 sparse to 1 busy. */
  complexity: number;
  /** 0 straight to 0.75 heavy. Applies to straight grids only. */
  swing: number;
  ghostNotes: boolean;
  crashOnSections: boolean;
  /** How the song ends (ending.ts, spec 136). A song saved before this existed ends with a hit. */
  ending: EndingSettings;
  kit: DrumKit;
  bassSound: BassSound;
  bassRange: BassRange;
  bassMode: BassMode;
  /** The notes the generated bass plays under each chord: the song's original bass where it has one, or the chords' own bass (spec 86). */
  bassFrom: BassFrom;
  /** Bass notes the performer set by hand, over stretches of the song. They win over the original bass and the chords (bass-overrides.ts). */
  bassOverrides: BassOverride[];
  /** The bass part a section plays when it is on Auto and Auto has no rule of its own. A song saved before this existed takes it from bassMode. */
  defaultBassPart: BassPart;
  lockToKick: boolean;
  /** Generated parts take their accents and stops from the playing of the follow source (feel.ts). */
  followPlaying: boolean;
  followSource: FollowSource;
  /** Generated drum hits move onto the original drummer's hits when the song has a drums stem (drummer-timing.ts, spec 107). */
  followDrummer: boolean;
  /** Humanising of the generated drums and bass (humanise.ts). */
  humanise: HumaniseSettings;
  /** How long each bass note rings, from 0 (tight) to 1 (ring). Scales the lengths the bass part gives (bass.ts). */
  bassFeel: number;
  /** The bass tone the generated bass is rendered through (part-tone.ts). Only Generate uses it. */
  bassTone: PartTone;
  /** The tone the generated drums are rendered through (part-tone.ts, spec 104). Only Generate uses it. */
  drumTone: PartTone;
  /** Parts brought back as rendered audio (spec 84). A kind is here while its track is the rendered audio, not a generated part. */
  rendered: Partial<Record<RenderedKind, RenderedPart>>;
  /** The time of each generated part's first note at the last Generate, so a rendered file can be lined up with it. */
  firstNote: Partial<Record<RenderedKind, number>>;
  /** Each generation uses this seed, so a song regenerates the same way. "Try another" picks a new one. */
  seed: number;
  /** Per-section changes, keyed by section id. Style, energy, loud, busy, bass part, octave, fill and play can be overridden. */
  sections: Record<string, SectionOverride>;
}

export const DEFAULT_BAND_SETTINGS: BandSettings = {
  parts: { drums: true, bass: true },
  style: "rock",
  complexity: 0.5,
  swing: 0,
  ghostNotes: true,
  crashOnSections: true,
  ending: { ...DEFAULT_ENDING },
  kit: "standard",
  bassSound: "finger",
  bassRange: "normal",
  bassMode: "roots",
  bassFrom: "original",
  bassOverrides: [],
  defaultBassPart: "pulse",
  bassFeel: 0.5,
  lockToKick: true,
  followPlaying: true,
  followSource: "auto",
  followDrummer: true,
  humanise: { amount: 0.5, feel: "style" },
  bassTone: { kind: "clean" },
  drumTone: { kind: "clean" },
  rendered: {},
  firstNote: {},
  seed: 1,
  sections: {},
};

/** Default energy for a section, from its name. The first match wins, so "pre-chorus" is checked before "chorus". */
const ENERGY_BY_NAME: [RegExp, Energy][] = [
  [/pre[\s-]*chorus/i, 3],
  [/chorus/i, 4],
  [/intro/i, 2],
  [/verse/i, 2],
  [/bridge/i, 3],
  [/solo/i, 4],
  [/outro/i, 2],
];

export function energyForName(name: string): Energy {
  const rule = ENERGY_BY_NAME.find(([pattern]) => pattern.test(name));
  return rule ? rule[1] : 3;
}

/** A chorus is a chorus, not a pre-chorus. A fill leads into a chorus, so only a chorus counts as a target. */
export function isChorusName(name: string): boolean {
  return /chorus/i.test(name) && !/pre[\s-]*chorus/i.test(name);
}

/** The bass a section plays in a song: the choice's part, or Auto's from the name. The chorus rule is set by the song's first chorus. */
function chorusIsGroove(sections: readonly Section[], settings: BandSettings): boolean {
  const chorus = sortedSections(sections).find((section) => isChorusName(section.name));
  if (!chorus) return false;
  const override = settings.sections[chorus.id] ?? {};
  if (override.bassPart !== undefined && override.bassPart !== "auto") return override.bassPart === "groove";
  const energy = override.energy ?? energyForName(chorus.name);
  return autoBass(chorus.name, override.busy ?? energy, false, settings.defaultBassPart).part === "groove";
}

/** The fields of a plan that do not depend on its times: what the section plays, resolved from its name and overrides. */
function playFields(name: string, override: SectionOverride, settings: BandSettings, chorusGroove: boolean) {
  const energy = override.energy ?? energyForName(name);
  const technique = findStyle(override.style ?? settings.style)?.bass.techniques ?? { slides: false, deadNotes: false, pickups: true };
  const busy = override.busy ?? energy;
  const choice = override.bassPart ?? "auto";
  const bass =
    choice === "auto"
      ? autoBass(name, busy, chorusGroove, settings.defaultBassPart)
      : { part: choice, lead: undefined, rampLoud: false, octave: 0 as OctaveShift };
  return {
    name,
    style: override.style ?? settings.style,
    energy,
    loud: override.loud ?? energy,
    busy,
    bassPart: bass.part,
    bassLead: bass.lead,
    bassRamp: bass.rampLoud,
    octave: override.octave ?? bass.octave,
    fills: override.fills ?? defaultFills(name),
    slides: override.slides ?? technique.slides,
    deadNotes: override.deadNotes ?? technique.deadNotes,
    pickups: override.pickups ?? technique.pickups,
    play: override.play ? { ...override.play } : { ...settings.parts },
  };
}

/**
 * What the song's own band does in a stretch of the song, from the song analysis's sections: where the original drums or bass stop,
 * and how loud the stretch is against the rest of the song in decibels.
 */
export interface SectionBandHint {
  start: number;
  end: number;
  drumsOff?: boolean;
  bassOff?: boolean;
  levelDb?: number;
}

/** A section this many decibels louder than the song's middle section plays one energy level up; this much quieter, one level down. */
export const HINT_LOUDER_DB = 2;
export const HINT_QUIETER_DB = -3;

/** The hint covering the middle of a plan, if any. */
function hintAt(hints: readonly SectionBandHint[], start: number, end: number): SectionBandHint | undefined {
  const middle = (start + end) / 2;
  return hints.find((hint) => hint.start <= middle && middle < hint.end);
}

/**
 * A section's override with the song's own band as defaults underneath it: no bass where the original bass stops, no drums where the
 * original drums stop, and one energy level up or down for a louder or quieter section. Whatever the performer set wins.
 */
function withHint(override: SectionOverride, hint: SectionBandHint | undefined, settings: BandSettings, name: string): SectionOverride {
  if (!hint) return override;
  const fromHint: SectionOverride = {};
  if (hint.bassOff) fromHint.bassPart = "rest";
  if (hint.drumsOff) fromHint.play = { drums: false, bass: settings.parts.bass };
  if (hint.levelDb !== undefined && override.energy === undefined) {
    const step = hint.levelDb >= HINT_LOUDER_DB ? 1 : hint.levelDb <= HINT_QUIETER_DB ? -1 : 0;
    if (step !== 0) fromHint.energy = Math.min(5, Math.max(1, energyForName(name) + step)) as Energy;
  }
  return { ...fromHint, ...override };
}

/**
 * Splits the song into one plan per section, in time order. The first plan starts at 0 and the last one runs to the song's end, and
 * each gap between sections goes to the section before it. A song without sections gets one plan for the whole song.
 */
export function planSections(sections: readonly Section[], songEnd: number, settings: BandSettings, hints: readonly SectionBandHint[] = []): SectionPlan[] {
  const chorusGroove = chorusIsGroove(sections, settings);
  if (sections.length === 0) {
    // A song without sections is one plan, and its overrides are kept under WHOLE_SONG_ID like a section's are under its id.
    const override = withHint(settings.sections[WHOLE_SONG_ID] ?? {}, hintAt(hints, 0, songEnd), settings, "");
    return [
      {
        sectionId: null,
        start: 0,
        end: songEnd,
        fill: override.fill ?? true,
        hitTheOne: override.hitTheOne ?? false,
        ...playFields("", override, settings, chorusGroove),
      },
    ];
  }

  const ordered = sortedSections(sections);
  return ordered.map((section, i) => {
    const next = ordered[i + 1];
    const previous = ordered[i - 1];
    const end = next ? next.start : Math.max(songEnd, section.end);
    const override = withHint(settings.sections[section.id] ?? {}, hintAt(hints, i === 0 ? 0 : section.start, end), settings, section.name);
    // A chorus after a section that is not a chorus hits the one by default.
    const followsOther = previous !== undefined && !isChorusName(previous.name);
    return {
      sectionId: section.id,
      start: i === 0 ? 0 : section.start,
      end,
      fill: override.fill ?? (next ? isChorusName(next.name) : true),
      hitTheOne: override.hitTheOne ?? (isChorusName(section.name) && followsOther),
      ...playFields(section.name, override, settings, chorusGroove),
    };
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const isInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const isUnit = (value: unknown): value is number => isInRange(value, 0, 1);
const isSwing = (value: unknown): value is number => isInRange(value, 0, SWING_MAX);
const isSeed = (value: unknown): value is number => isInRange(value, 0, 0xffffffff) && Number.isInteger(value);
const isEnergy = (value: unknown): value is Energy => ENERGIES.includes(value as Energy);
const isOctave = (value: unknown): value is OctaveShift => OCTAVE_SHIFTS.includes(value as OctaveShift);
const isFills = (value: unknown): value is Fills => FILLS.includes(value as Fills);
const isBassPartChoice = (value: unknown): value is BassPartChoice => BASS_PART_CHOICES.includes(value as BassPartChoice);
const isStyleId = (value: unknown): value is StyleId => STYLE_IDS.includes(value as StyleId);
const isOneOf =
  <T extends string>(options: readonly T[]) =>
  (value: unknown): value is T =>
    options.includes(value as T);
const isDrumKit = isOneOf(DRUM_KITS);
const isBassSound = isOneOf(BASS_SOUNDS);
const isBassRange = isOneOf(BASS_RANGES);
const isBassMode = isOneOf(BASS_MODES);
const isBassFrom = isOneOf(BASS_FROM);
const isFollowSource = isOneOf(FOLLOW_SOURCES);
const isHumaniseChoice = isOneOf(HUMANISE_CHOICES);
const isHumanise = (value: unknown): value is HumaniseSettings => isRecord(value) && isUnit(value.amount) && isHumaniseChoice(value.feel);
const isPartToggles = (value: unknown): value is PartToggles => isRecord(value) && isBool(value.drums) && isBool(value.bass);
const optional = <T>(value: unknown, check: (candidate: unknown) => candidate is T): boolean => value === undefined || check(value);

/** A section override where every field present is valid. */
function isSectionOverride(value: unknown): value is SectionOverride {
  return (
    isRecord(value) &&
    optional(value.style, isStyleId) &&
    optional(value.energy, isEnergy) &&
    optional(value.loud, isEnergy) &&
    optional(value.busy, isEnergy) &&
    optional(value.octave, isOctave) &&
    optional(value.fills, isFills) &&
    optional(value.hitTheOne, isBool) &&
    optional(value.slides, isBool) &&
    optional(value.deadNotes, isBool) &&
    optional(value.pickups, isBool) &&
    optional(value.bassPart, isBassPartChoice) &&
    optional(value.fill, isBool) &&
    optional(value.play, isPartToggles)
  );
}

const MAX_PATH = 4096;
const isRenderedKind = (value: unknown): value is RenderedKind => RENDERED_KINDS.includes(value as RenderedKind);
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isIsoDate = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;

/** A rendered part entry, if it is complete. */
function parseRenderedPart(value: unknown): RenderedPart | null {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim() === "" || value.name.length > MAX_NAME) return null;
  if (!isIsoDate(value.importedAt)) return null;
  return { name: value.name, importedAt: value.importedAt };
}

/** The rendered entries, keeping each complete one and dropping the rest. */
function parseRendered(value: unknown): Partial<Record<RenderedKind, RenderedPart>> {
  const out: Partial<Record<RenderedKind, RenderedPart>> = {};
  if (!isRecord(value)) return out;
  for (const kind of RENDERED_KINDS) {
    const part = parseRenderedPart(value[kind]);
    if (part) out[kind] = part;
  }
  return out;
}

/** The first-note times, keeping each valid one. */
function parseFirstNote(value: unknown): Partial<Record<RenderedKind, number>> {
  const out: Partial<Record<RenderedKind, number>> = {};
  if (!isRecord(value)) return out;
  for (const kind of RENDERED_KINDS) if (isTime(value[kind])) out[kind] = value[kind];
  return out;
}

/** True when every entry of the rendered and first-note records is valid. */
const isRendered = (value: unknown): boolean =>
  isRecord(value) && Object.keys(value).every((key) => isRenderedKind(key) && parseRenderedPart(value[key]) !== null);
const isFirstNote = (value: unknown): boolean => isRecord(value) && Object.keys(value).every((key) => isRenderedKind(key) && isTime(value[key]));
const MAX_NAME = 200;
const isPositiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isInDbRange = (value: unknown, [min, max]: readonly [number, number]): value is number => isInRange(value, min, max);

/** A capture or IR file, if every field it needs is valid. A TONE3000 file needs its tone and model; a local file needs its path. */
function parsePartToneFile(value: unknown): PartToneFile | null {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim() === "" || value.name.length > MAX_NAME) return null;
  if (value.source === "tone3000") {
    if (!isPositiveId(value.toneId) || !isPositiveId(value.modelId)) return null;
    const older = value.older === true ? { older: true } : {};
    return { source: "tone3000", toneId: value.toneId, modelId: value.modelId, name: value.name, ...older };
  }
  if (value.source === "file") {
    if (typeof value.path !== "string" || value.path === "" || value.path.length > MAX_PATH) return null;
    return { source: "file", path: value.path, name: value.name };
  }
  return null;
}

/** A chain block, if every field it needs is valid. The file's kind must match the role (a cab is an IR, an amp a capture). */
function parseToneBlock(value: unknown, part: TonePart): ToneBlock | null {
  if (!isRecord(value) || !PART_ROLES[part].includes(value.role as ToneRole)) return null;
  const role = value.role as ToneRole;
  const file = value.file === null ? null : parsePartToneFile(value.file);
  if ((value.file !== null && !file) || value.type !== TONE_BLOCK_TYPE[role]) return null;
  return {
    type: TONE_BLOCK_TYPE[role],
    role,
    file,
    inputDb: isInDbRange(value.inputDb, BASS_TONE_INPUT_DB) ? value.inputDb : 0,
    outputDb: isInDbRange(value.outputDb, BASS_TONE_OUTPUT_DB) ? value.outputDb : 0,
    mix: isUnit(value.mix) ? value.mix : 1,
    on: isBool(value.on) ? value.on : true,
  };
}

/** True when every field of a chain block is present and valid. */
function isToneBlock(value: unknown, part: TonePart): boolean {
  if (!isRecord(value) || !PART_ROLES[part].includes(value.role as ToneRole)) return false;
  return (
    value.type === TONE_BLOCK_TYPE[value.role as ToneRole] &&
    (value.file === null || parsePartToneFile(value.file) !== null) &&
    isInDbRange(value.inputDb, BASS_TONE_INPUT_DB) &&
    isInDbRange(value.outputDb, BASS_TONE_OUTPUT_DB) &&
    isUnit(value.mix) &&
    isBool(value.on)
  );
}

/** True when the value is a complete, valid tone for the part. A chain holds at most MAX_TONE_BLOCKS blocks, each one valid. */
function isPartTone(value: unknown, part: TonePart): value is PartTone {
  if (!isRecord(value)) return false;
  if (value.kind === "clean") return true;
  return (
    value.kind === "chain" &&
    Array.isArray(value.blocks) &&
    value.blocks.length <= MAX_TONE_BLOCKS &&
    value.blocks.every((block) => isToneBlock(block, part)) &&
    isUnit(value.dryWet) &&
    isBool(value.fast)
  );
}

/**
 * Reads a saved tone for a part. For the bass, a spec 83 "nam" tone (one capture, an optional cab IR, a drive, an output and a blend) becomes a chain of an amp
 * and a cab. A chain keeps its valid blocks, in order, up to MAX_TONE_BLOCKS; an invalid block is dropped. Anything else gives the clean
 * bass.
 */
export function parsePartTone(value: unknown, part: TonePart): PartTone {
  if (!isRecord(value)) return { kind: "clean" };
  if (value.kind === "nam" && part === "bass") {
    const capture = parsePartToneFile(value.capture);
    if (!capture) return { kind: "clean" };
    const amp: ToneBlock = {
      type: "capture",
      role: "amp",
      file: capture,
      inputDb: isInDbRange(value.inputDb, BASS_TONE_INPUT_DB) ? value.inputDb : 0,
      outputDb: isInDbRange(value.outputDb, BASS_TONE_OUTPUT_DB) ? value.outputDb : 0,
      mix: 1,
      on: true,
    };
    const blocks = [amp];
    const cab = parsePartToneFile(value.ir);
    if (cab) blocks.push({ type: "ir", role: "cab", file: cab, inputDb: 0, outputDb: 0, mix: 1, on: true });
    return { kind: "chain", blocks, dryWet: isUnit(value.blend) ? value.blend : 1, fast: false };
  }
  if (value.kind !== "chain") return { kind: "clean" };
  const blocks = Array.isArray(value.blocks)
    ? value.blocks
        .map((block) => parseToneBlock(block, part))
        .filter((block): block is ToneBlock => block !== null)
        .slice(0, MAX_TONE_BLOCKS)
    : [];
  return { kind: "chain", blocks, dryWet: isUnit(value.dryWet) ? value.dryWet : 1, fast: isBool(value.fast) ? value.fast : false };
}

/** Reads a saved bass tone (see parsePartTone). */
export const parseBassTone = (value: unknown): PartTone => parsePartTone(value, "bass");
/** Reads a saved drum tone. Songs saved before spec 104 have none and read as clean drums. */
export const parseDrumTone = (value: unknown): PartTone => parsePartTone(value, "drums");

/** True when the value is a complete, valid set of band settings. Use parseBandSettings for saved data that may be partial or old. */
export function isBandSettings(value: unknown): value is BandSettings {
  return (
    isRecord(value) &&
    isPartToggles(value.parts) &&
    isStyleId(value.style) &&
    isUnit(value.complexity) &&
    isSwing(value.swing) &&
    isBool(value.ghostNotes) &&
    isBool(value.crashOnSections) &&
    isEnding(value.ending) &&
    isDrumKit(value.kit) &&
    isBassSound(value.bassSound) &&
    isBassRange(value.bassRange) &&
    isBassMode(value.bassMode) &&
    isBassFrom(value.bassFrom) &&
    Array.isArray(value.bassOverrides) &&
    DEFAULT_BASS_PARTS.includes(value.defaultBassPart as BassPart) &&
    isBool(value.lockToKick) &&
    isBool(value.followPlaying) &&
    isFollowSource(value.followSource) &&
    isBool(value.followDrummer) &&
    isHumanise(value.humanise) &&
    isUnit(value.bassFeel) &&
    isPartTone(value.bassTone, "bass") &&
    isPartTone(value.drumTone, "drums") &&
    isRendered(value.rendered) &&
    isFirstNote(value.firstNote) &&
    isSeed(value.seed) &&
    isRecord(value.sections) &&
    Object.values(value.sections).every(isSectionOverride)
  );
}

/** Keeps each valid field of the humanise settings and falls back to the default for the rest. */
function parseHumanise(value: unknown): HumaniseSettings {
  const source: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    amount: isUnit(source.amount) ? source.amount : DEFAULT_BAND_SETTINGS.humanise.amount,
    feel: isHumaniseChoice(source.feel) ? source.feel : DEFAULT_BAND_SETTINGS.humanise.feel,
  };
}

/** Keeps each valid field of a section override and drops the rest. */
function parseSectionOverride(value: Record<string, unknown>): SectionOverride {
  const override: SectionOverride = {};
  if (isStyleId(value.style)) override.style = value.style;
  if (isEnergy(value.energy)) override.energy = value.energy;
  if (isEnergy(value.loud)) override.loud = value.loud;
  if (isEnergy(value.busy)) override.busy = value.busy;
  if (isOctave(value.octave)) override.octave = value.octave;
  if (isFills(value.fills)) override.fills = value.fills;
  if (isBool(value.hitTheOne)) override.hitTheOne = value.hitTheOne;
  if (isBool(value.slides)) override.slides = value.slides;
  if (isBool(value.deadNotes)) override.deadNotes = value.deadNotes;
  if (isBool(value.pickups)) override.pickups = value.pickups;
  if (isBassPartChoice(value.bassPart)) override.bassPart = value.bassPart;
  if (isBool(value.fill)) override.fill = value.fill;
  if (isPartToggles(value.play)) override.play = { drums: value.play.drums, bass: value.play.bass };
  return override;
}

/**
 * Reads band settings from saved song options. Garbage (not an object) gives the defaults. Each field that is missing or invalid
 * falls back to its default, and each valid field is kept, so an older song with fewer fields still loads.
 */
export function parseBandSettings(value: unknown): BandSettings {
  const source: Record<string, unknown> = isRecord(value) ? value : {};
  const defaults = DEFAULT_BAND_SETTINGS;

  const sections: Record<string, SectionOverride> = {};
  if (isRecord(source.sections)) {
    for (const [id, entry] of Object.entries(source.sections)) {
      // "__proto__" is skipped so a saved key cannot change the object's prototype.
      if (id === "" || id === "__proto__" || !isRecord(entry)) continue;
      const override = parseSectionOverride(entry);
      if (Object.keys(override).length > 0) sections[id] = override;
    }
  }

  return {
    parts: isPartToggles(source.parts) ? { drums: source.parts.drums, bass: source.parts.bass } : { ...defaults.parts },
    style: isStyleId(source.style) ? source.style : defaults.style,
    complexity: isUnit(source.complexity) ? source.complexity : defaults.complexity,
    swing: isSwing(source.swing) ? source.swing : defaults.swing,
    ghostNotes: isBool(source.ghostNotes) ? source.ghostNotes : defaults.ghostNotes,
    crashOnSections: isBool(source.crashOnSections) ? source.crashOnSections : defaults.crashOnSections,
    ending: parseEnding(source.ending),
    kit: isDrumKit(source.kit) ? source.kit : defaults.kit,
    bassSound: isBassSound(source.bassSound) ? source.bassSound : defaults.bassSound,
    bassRange: isBassRange(source.bassRange) ? source.bassRange : defaults.bassRange,
    bassMode: isBassMode(source.bassMode) ? source.bassMode : defaults.bassMode,
    bassFrom: isBassFrom(source.bassFrom) ? source.bassFrom : defaults.bassFrom,
    bassOverrides: parseBassOverrides(source.bassOverrides),
    defaultBassPart: DEFAULT_BASS_PARTS.includes(source.defaultBassPart as BassPart)
      ? (source.defaultBassPart as BassPart)
      : isBassMode(source.bassMode)
        ? partForBassMode(source.bassMode)
        : defaults.defaultBassPart,
    bassFeel: isUnit(source.bassFeel) ? source.bassFeel : defaults.bassFeel,
    lockToKick: isBool(source.lockToKick) ? source.lockToKick : defaults.lockToKick,
    followPlaying: isBool(source.followPlaying) ? source.followPlaying : defaults.followPlaying,
    followSource: isFollowSource(source.followSource) ? source.followSource : defaults.followSource,
    followDrummer: isBool(source.followDrummer) ? source.followDrummer : defaults.followDrummer,
    humanise: parseHumanise(source.humanise),
    bassTone: parseBassTone(source.bassTone),
    drumTone: parseDrumTone(source.drumTone),
    rendered: parseRendered(source.rendered),
    firstNote: parseFirstNote(source.firstNote),
    seed: isSeed(source.seed) ? source.seed : defaults.seed,
    sections,
  };
}
