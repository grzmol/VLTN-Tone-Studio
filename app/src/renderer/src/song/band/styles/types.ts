import type { Figure } from "../bass-figures";

// Style data: a meter, a step grid, drum grooves per energy level, fills and bass rhythms. Styles are plain data so they can be
// read, tested and tuned without running any generator. The rules that play them live in ../drums.ts and ../bass.ts.

/** Every style the engine knows. The list is the source of truth for parsing saved settings. */
export const STYLE_IDS = ["rock", "pop", "ballad", "funk", "shuffle", "country", "reggae", "metal", "six-eight", "half-time", "three-four"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

/**
 * The feels the humanising gives the generated parts: how the timing and the velocities sit against the beat. "Tight" plays on the
 * grid, "laid back" drags the snare and the hats, "pushed" plays the snare early. The settings add "style", the style's own default.
 */
export const HUMANISE_FEELS = ["tight", "natural", "laid-back", "pushed"] as const;
export type HumaniseFeel = (typeof HUMANISE_FEELS)[number];

/** Energy 1 is sparse, 5 is busy. */
export type Energy = 1 | 2 | 3 | 4 | 5;
export const ENERGIES: readonly Energy[] = [1, 2, 3, 4, 5];

export interface Meter {
  /** Beats in one bar, as the beat grid counts them. 6/8 is 2 (dotted-quarter beats). */
  beatsPerBar: number;
  /** Steps in one beat: 4 for sixteenths, 2 for eighths, 3 for triplets. */
  stepsPerBeat: 4 | 3 | 2;
}

/** How much a hit adds: "lean" embellishments and "busy" extra notes. */
export type Tier = "lean" | "busy";

/** One drum hit inside a bar. `step` counts from 0 at the bar's downbeat. */
export interface DrumHit {
  step: number;
  /** A General MIDI drum pitch (see ../note.ts). */
  pitch: number;
  /** 1 to 127. */
  velocity: number;
  /**
   * Which complexity level plays it. Untagged hits are the core of the groove and always play. A "lean" hit plays from complexity
   * 1/3 up, and a "busy" hit from 2/3 up. See playsAt below.
   */
  tier?: Tier;
  /** A ghost note: dropped when ghost notes are off. */
  ghost?: boolean;
}

/** One bar of drums. `steps` is `meter.beatsPerBar × meter.stepsPerBeat` for the style it belongs to. */
export interface DrumPattern {
  steps: number;
  hits: DrumHit[];
}

export interface DrumGroove extends DrumPattern {
  name: string;
}

/**
 * Bass rhythms. Each variation is the list of steps (in the style's step grid, one bar) where the bass plays a note. The note
 * choice (roots, fifths, octaves, walking) is decided in ../bass.ts.
 */
/**
 * The playing techniques a style turns on by default for its bass: slides into a note, dead notes between notes, and pickups into a
 * phrase's last bar. A section can change each one.
 */
export interface BassTechniques {
  slides: boolean;
  deadNotes: boolean;
  pickups: boolean;
}

export interface BassStyle {
  rhythms: Record<Energy, number[][]>;
  /** Walking lines move on every beat, so a style that walks is written with a step on each beat. */
  walking: boolean;
  /** The bass techniques this style plays unless a section says otherwise. */
  techniques: BassTechniques;
  /** Three or four figures for each energy level, one or two bars long (bass-figures.ts). A groove or melodic section plays one. */
  figures: Record<Energy, Figure[]>;
}

export interface Style {
  id: StyleId;
  name: string;
  meter: Meter;
  /**
   * The swing this style starts at when chosen. Triplet styles already carry their swing in the pattern, so the engine ignores it
   * for them.
   */
  swingDefault: number;
  /** The humanising feel this style starts at when the settings say "style" (see ../humanise.ts). */
  feelDefault: HumaniseFeel;
  /** 2 to 4 variations per energy level. Each variation is one bar. */
  grooves: Record<Energy, DrumGroove[]>;
  /**
   * Fills. A short fill is a whole-bar pattern whose hits all sit in the last beat; it replaces that beat. A half fill has its hits in the
   * second half (`step >= steps / 2`) and replaces the second half of the bar. A bar fill replaces the whole bar. The first
   * `LEGACY_FILLS` half and bar fills are the ones songs on drum engine 2 or earlier were made with; they stay as they were.
   */
  fills: { short: DrumPattern[]; half: DrumPattern[]; bar: DrumPattern[] };
  /** Hits that replace the last beat of a groove in the last bar of a phrase that does not end a pair of phrases: one small change. */
  turnarounds: DrumPattern[];
  bass: BassStyle;
}

/** How many half fills and bar fills a style had before the drum phrases (engine 3). Songs on engine 2 or earlier draw from these only. */
export const LEGACY_FILLS = 2;

/** A "lean" hit plays from this complexity up. */
export const LEAN_FROM = 1 / 3;
/** A "busy" hit plays from this complexity up. */
export const BUSY_FROM = 2 / 3;

/** Whether a hit plays at this complexity. Untagged hits are the core of the groove and always play. */
export function playsAt(hit: DrumHit, complexity: number): boolean {
  if (hit.tier === "busy") return complexity >= BUSY_FROM;
  if (hit.tier === "lean") return complexity >= LEAN_FROM;
  return true;
}
