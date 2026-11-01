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
import { findStyle } from "./styles";
import { ENERGIES, HUMANISE_FEELS, STYLE_IDS, type Energy, type StyleId } from "./styles/types";

export const DRUM_KITS = ["standard"] as const;
export const BASS_SOUNDS = ["finger", "pick"] as const;
export const BASS_RANGES = ["low", "normal", "high"] as const;
export const BASS_MODES = ["roots", "fifths", "octaves", "melodic", "walking"] as const;
/** Where follow-my-playing reads its accents: a stem the band plays, or the song's mix. "auto" takes the first stem that exists. */
export const FOLLOW_SOURCES = ["auto", "guitar", "piano", "other", "mix"] as const;
/** The choices of the humanise feel: "style" is the style's own default, the rest are fixed feels. */
export const HUMANISE_CHOICES = ["style", ...HUMANISE_FEELS] as const;

export type DrumKit = (typeof DRUM_KITS)[number];
export type BassSound = (typeof BASS_SOUNDS)[number];
export type BassRange = (typeof BASS_RANGES)[number];
export type BassMode = (typeof BASS_MODES)[number];
export type FollowSource = (typeof FOLLOW_SOURCES)[number];
export type HumaniseChoice = (typeof HUMANISE_CHOICES)[number];

/** How the generated drums and bass are humanised: the amount from 0 (exactly on the grid) to 1, and the feel. */
export interface HumaniseSettings {
  amount: number;
  feel: HumaniseChoice;
}

/** Where a bass tone's capture or cab IR comes from: a TONE3000 download, or a file on this computer. */
export const BASS_TONE_SOURCES = ["tone3000", "file"] as const;
export type BassToneSource = (typeof BASS_TONE_SOURCES)[number];

/** Input drive and output level of the bass tone, in dB. */
export const BASS_TONE_INPUT_DB: readonly [number, number] = [-12, 12];
export const BASS_TONE_OUTPUT_DB: readonly [number, number] = [-24, 12];

/**
 * A capture or cab IR the bass tone uses. A TONE3000 file is named by its tone and model, so it can be downloaded again; a file from
 * this computer is named by its absolute path.
 */
export interface BassToneFile {
  source: BassToneSource;
  /** The TONE3000 tone the file was downloaded from. */
  toneId?: number;
  /** The model of that tone to download. */
  modelId?: number;
  /** Absolute path of a local file. */
  path?: string;
  /** The name the Band panel shows. */
  name: string;
}

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

/**
 * The bass tone. "clean" is the generated DI sample as it is. "nam" plays it through a capture, then a cab IR, and mixes the result with the
 * dry sample by `blend` (0 dry, 1 all amp).
 */
export type BassTone = { kind: "clean" } | { kind: "nam"; capture: BassToneFile; ir: BassToneFile | null; inputDb: number; outputDb: number; blend: number };

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
  kit: DrumKit;
  bassSound: BassSound;
  bassRange: BassRange;
  bassMode: BassMode;
  /** The bass part a section plays when it is on Auto and Auto has no rule of its own. A song saved before this existed takes it from bassMode. */
  defaultBassPart: BassPart;
  lockToKick: boolean;
  /** Generated parts take their accents and stops from the playing of the follow source (feel.ts). */
  followPlaying: boolean;
  followSource: FollowSource;
  /** Humanising of the generated drums and bass (humanise.ts). */
  humanise: HumaniseSettings;
  /** How long each bass note rings, from 0 (tight) to 1 (ring). Scales the lengths the bass part gives (bass.ts). */
  bassFeel: number;
  /** The bass tone the generated bass is rendered through (bass-tone.ts). Only Generate uses it. */
  bassTone: BassTone;
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
  kit: "standard",
  bassSound: "finger",
  bassRange: "normal",
  bassMode: "roots",
  defaultBassPart: "pulse",
  bassFeel: 0.5,
  lockToKick: true,
  followPlaying: true,
  followSource: "auto",
  humanise: { amount: 0.5, feel: "style" },
  bassTone: { kind: "clean" },
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
 * Splits the song into one plan per section, in time order. The first plan starts at 0 and the last one runs to the song's end, and
 * each gap between sections goes to the section before it. A song without sections gets one plan for the whole song.
 */
export function planSections(sections: readonly Section[], songEnd: number, settings: BandSettings): SectionPlan[] {
  const chorusGroove = chorusIsGroove(sections, settings);
  if (sections.length === 0) {
    // A song without sections is one plan, and its overrides are kept under WHOLE_SONG_ID like a section's are under its id.
    const override = settings.sections[WHOLE_SONG_ID] ?? {};
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
    const override = settings.sections[section.id] ?? {};
    // A chorus after a section that is not a chorus hits the one by default.
    const followsOther = previous !== undefined && !isChorusName(previous.name);
    return {
      sectionId: section.id,
      start: i === 0 ? 0 : section.start,
      end: next ? next.start : Math.max(songEnd, section.end),
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
function parseBassToneFile(value: unknown): BassToneFile | null {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim() === "" || value.name.length > MAX_NAME) return null;
  if (value.source === "tone3000") {
    if (!isPositiveId(value.toneId) || !isPositiveId(value.modelId)) return null;
    return { source: "tone3000", toneId: value.toneId, modelId: value.modelId, name: value.name };
  }
  if (value.source === "file") {
    if (typeof value.path !== "string" || value.path === "" || value.path.length > MAX_PATH) return null;
    return { source: "file", path: value.path, name: value.name };
  }
  return null;
}

/** True when the value is a complete, valid bass tone. A missing cab IR means none; a cab IR that is there but invalid fails the check. */
function isBassTone(value: unknown): value is BassTone {
  if (!isRecord(value)) return false;
  if (value.kind === "clean") return true;
  return (
    value.kind === "nam" &&
    parseBassToneFile(value.capture) !== null &&
    (value.ir === undefined || value.ir === null || parseBassToneFile(value.ir) !== null) &&
    isInDbRange(value.inputDb, BASS_TONE_INPUT_DB) &&
    isInDbRange(value.outputDb, BASS_TONE_OUTPUT_DB) &&
    isUnit(value.blend)
  );
}

/**
 * Reads a saved bass tone. Anything that is not a valid capture gives the clean bass. A cab IR that is invalid is dropped, and the gains
 * and blend fall back to their defaults one at a time.
 */
export function parseBassTone(value: unknown): BassTone {
  if (!isRecord(value) || value.kind !== "nam") return { kind: "clean" };
  const capture = parseBassToneFile(value.capture);
  if (!capture) return { kind: "clean" };
  return {
    kind: "nam",
    capture,
    ir: parseBassToneFile(value.ir),
    inputDb: isInDbRange(value.inputDb, BASS_TONE_INPUT_DB) ? value.inputDb : 0,
    outputDb: isInDbRange(value.outputDb, BASS_TONE_OUTPUT_DB) ? value.outputDb : 0,
    blend: isUnit(value.blend) ? value.blend : 1,
  };
}

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
    isDrumKit(value.kit) &&
    isBassSound(value.bassSound) &&
    isBassRange(value.bassRange) &&
    isBassMode(value.bassMode) &&
    DEFAULT_BASS_PARTS.includes(value.defaultBassPart as BassPart) &&
    isBool(value.lockToKick) &&
    isBool(value.followPlaying) &&
    isFollowSource(value.followSource) &&
    isHumanise(value.humanise) &&
    isUnit(value.bassFeel) &&
    isBassTone(value.bassTone) &&
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
    kit: isDrumKit(source.kit) ? source.kit : defaults.kit,
    bassSound: isBassSound(source.bassSound) ? source.bassSound : defaults.bassSound,
    bassRange: isBassRange(source.bassRange) ? source.bassRange : defaults.bassRange,
    bassMode: isBassMode(source.bassMode) ? source.bassMode : defaults.bassMode,
    defaultBassPart: DEFAULT_BASS_PARTS.includes(source.defaultBassPart as BassPart)
      ? (source.defaultBassPart as BassPart)
      : isBassMode(source.bassMode)
        ? partForBassMode(source.bassMode)
        : defaults.defaultBassPart,
    bassFeel: isUnit(source.bassFeel) ? source.bassFeel : defaults.bassFeel,
    lockToKick: isBool(source.lockToKick) ? source.lockToKick : defaults.lockToKick,
    followPlaying: isBool(source.followPlaying) ? source.followPlaying : defaults.followPlaying,
    followSource: isFollowSource(source.followSource) ? source.followSource : defaults.followSource,
    humanise: parseHumanise(source.humanise),
    bassTone: parseBassTone(source.bassTone),
    rendered: parseRendered(source.rendered),
    firstNote: parseFirstNote(source.firstNote),
    seed: isSeed(source.seed) ? source.seed : defaults.seed,
    sections,
  };
}
