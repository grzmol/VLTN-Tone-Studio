// Bass parts (spec 85, stage 2): what a section's bass plays in each bar. Pure. A part sets the rhythm of the bar and the role of each
// step (root or fifth). The note choice, the voice leading, the range and the kick lock stay in bass.ts. Auto picks a part from the
// section's name and its place in the song. The bar-level rules (the first bars of an intro, the last bars of a pre-chorus) are
// applied by bass.ts, because they count bars within the section.

import type { BassMode } from "./arrangement";
import type { Energy } from "./styles/types";

/** The choices a section can make for its bass. "auto" is resolved to one of the parts by planSections. */
export const BASS_PART_CHOICES = ["auto", "ring", "pulse", "groove", "melodic", "walking", "pedal", "rest"] as const;
export type BassPartChoice = (typeof BASS_PART_CHOICES)[number];
/** A bass part once it is resolved: every choice but "auto". */
export type BassPart = Exclude<BassPartChoice, "auto">;
export const OCTAVE_SHIFTS = [-1, 0, 1] as const;
export type OctaveShift = (typeof OCTAVE_SHIFTS)[number];

/** The first bars of a section that play another part before its own, for example an intro that holds a pedal to start. */
export interface BassLead {
  part: BassPart;
  bars: number;
}

/** What Auto picks for a section: its part, the lead it starts with, whether its last bars push the loud level, and its octave. */
export interface AutoBass {
  part: BassPart;
  lead?: BassLead;
  rampLoud: boolean;
  octave: OctaveShift;
}

/** An intro holds its pedal for this many bars, then rings. */
export const INTRO_PEDAL_BARS = 2;

/** A step of a bar that a part plays, and what it plays there. A root is the chord's bass note; a fifth is its fifth. */
export interface BarStep {
  step: number;
  role: "root" | "fifth";
}

/** The parts a song can choose as its default. Auto is not one of them, and a rest is not a part a song falls back to. */
export const DEFAULT_BASS_PARTS: readonly BassPart[] = ["ring", "pulse", "groove", "melodic", "walking", "pedal"];

/** The part the song's default bass mode stands for, used for a song saved before the default part was chosen. */
export function partForBassMode(mode: BassMode): BassPart {
  if (mode === "roots") return "pulse";
  if (mode === "melodic") return "melodic";
  if (mode === "walking") return "walking";
  return "groove";
}

/**
 * The part Auto picks for a section, from its name (case-insensitive), its busy level, whether the song's chorus is a groove, and the
 * fallback for a name it does not know. A pre-chorus is checked before a chorus, so it is not taken for one.
 */
export function autoBass(name: string, busy: Energy, chorusGroove: boolean, fallback: BassPart): AutoBass {
  const plain = (part: BassPart, octave: OctaveShift = 0): AutoBass => ({ part, rampLoud: false, octave });
  if (/pre[\s-]*chorus/i.test(name)) return { part: "pulse", rampLoud: true, octave: 0 };
  if (/chorus/i.test(name)) return plain(busy >= 4 ? "melodic" : "groove");
  if (/intro/i.test(name)) return { part: "ring", lead: { part: "pedal", bars: INTRO_PEDAL_BARS }, rampLoud: false, octave: 0 };
  if (/verse/i.test(name)) return plain(busy <= 2 ? "ring" : "pulse");
  if (/bridge/i.test(name)) return plain(chorusGroove ? "ring" : "melodic", 1);
  if (/solo/i.test(name)) return plain("groove");
  if (/outro/i.test(name)) return plain("ring");
  return plain(fallback);
}

/** A ring bar: one note at busy 1 and 2, two half notes from busy 3. From busy 4 every second bar also gets a passing fifth. */
export function ringSteps(busy: Energy, steps: number, bar: number): BarStep[] {
  if (busy <= 2) return [{ step: 0, role: "root" }];
  const notes: BarStep[] = [
    { step: 0, role: "root" },
    { step: Math.round(steps / 2), role: "root" },
  ];
  if (busy >= 4 && bar % 2 === 1) notes.push({ step: Math.round((steps * 3) / 8), role: "fifth" });
  return notes;
}

/** A pulse bar on the root: quarter notes at busy 1 and 2, eighth notes from busy 3. `steps` is the style's steps in one bar. */
export function pulseSteps(busy: Energy, steps: number, stepsPerBeat: number): BarStep[] {
  const interval = busy <= 2 ? stepsPerBeat : Math.max(1, Math.round(stepsPerBeat / 2));
  const notes: BarStep[] = [];
  for (let step = 0; step < steps; step += interval) notes.push({ step, role: "root" });
  return notes;
}

/** A pedal bar: the held note, struck on the downbeat only. */
export function pedalSteps(): BarStep[] {
  return [{ step: 0, role: "root" }];
}
