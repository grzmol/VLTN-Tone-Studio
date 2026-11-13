// Humanising (spec 50, B2): moves the generated drum and bass notes off the grid and shapes their velocities, so the parts feel played
// rather than programmed. Rule-based and pure: no audio and no store. It runs after generation, on the notes the generators return, and
// it never adds or removes a note. Every random draw comes from a seeded stream, so the same seed gives the same notes.

import type { HumaniseSettings, SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { CLOSED_HAT, KICK, OPEN_HAT, PEDAL_HAT, RIDE, SIDE_STICK, SNARE, type NoteEvent } from "./note";
import { createRandom, type Random } from "./random";
import { findStyle } from "./styles";
import type { HumaniseFeel } from "./styles/types";
import { beatInBar, beatSpan, clampVelocity, planIndexAt } from "./timing";

/** The parts humanising is applied to. Pitched parts are not humanised here. */
export type HumanisePart = "drums" | "bass";

/** The feel used for a note no plan covers. It is the middle of the range, so it is the least surprising. */
export const DEFAULT_FEEL: HumaniseFeel = "natural";

/** Salts that give each part its own stream of the seed. They differ from the generators' stream, which is the plain seed. */
export const DRUM_STREAM = 0x243f6a88;
export const BASS_STREAM = 0x85a308d3;

/** The most a timing offset may move a note, in ms, either way. */
export const MAX_SHIFT_MS = 20;

/** A note within this fraction of a beat of the beat is on the beat. It is also the window for a run of eighth hats. */
export const ON_BEAT_WINDOW = 0.1;

/** Velocity added at full amount on the bar's downbeat, on the backbeat (snare on beats 2 and 4) and taken off an off-beat hat. */
export const DOWNBEAT_ACCENT = 6;
export const BACKBEAT_ACCENT = 4;
export const OFFBEAT_HAT_ACCENT = -8;

/** In a run of eighth hats, the on-beat hat gets this much more velocity and the off-beat hat this much less, at full amount. */
export const HAT_RUN_ALTERNATION = 3;

/** The random velocity spread at full amount: a drum note moves up to this far either way, and a bass note up to its own spread. */
export const DRUM_VELOCITY_SPREAD = 6;
export const BASS_VELOCITY_SPREAD = 4;

/** A ghost note is a note under this velocity. Humanising keeps a ghost under it. */
export const GHOST_BELOW = 50;

/** The shortest a bass note may be after a later shift takes time off its end, in seconds. */
export const MIN_BASS_DURATION = 0.03;

/**
 * The timing groups. Each drum voice sits in one, and the bass has its own. The hats include the ride. The toms group holds the toms and
 * the crash, and any other drum pitch.
 */
export type TimingGroup = "kick" | "snare" | "hats" | "toms" | "bass";

/** Each group's timing shift at each feel, in ms at full amount. Positive is later than the grid. */
export const FEEL_SHIFT_MS: Record<TimingGroup, Record<HumaniseFeel, number>> = {
  kick: { tight: 0, natural: -2, "laid-back": -2, pushed: -2 },
  snare: { tight: 0, natural: 2, "laid-back": 8, pushed: -6 },
  hats: { tight: 0, natural: 0, "laid-back": 0, pushed: 0 },
  toms: { tight: 0, natural: 0, "laid-back": 0, pushed: 0 },
  bass: { tight: 0, natural: 0, "laid-back": 6, pushed: -4 },
};

/**
 * Each group's random timing spread (one standard deviation) at each feel, in ms at full amount. The spread is what makes a part sound
 * loose rather than only late or early. A feel with no spread for a group is the plain shift.
 */
export const FEEL_SPREAD_MS: Record<TimingGroup, Record<HumaniseFeel, number>> = {
  kick: { tight: 0, natural: 0, "laid-back": 0, pushed: 0 },
  snare: { tight: 0, natural: 0, "laid-back": 0, pushed: 0 },
  hats: { tight: 2, natural: 4, "laid-back": 6, pushed: 4 },
  toms: { tight: 3, natural: 3, "laid-back": 3, pushed: 3 },
  bass: { tight: 1, natural: 3, "laid-back": 3, pushed: 3 },
};

/** The General MIDI hats the velocity rules treat as hats. The ride takes the hats' timing but not their accents. */
const HAT_PITCHES: readonly number[] = [CLOSED_HAT, PEDAL_HAT, OPEN_HAT];

/** The timing group of a drum pitch. */
function groupOf(pitch: number): TimingGroup {
  if (pitch === KICK) return "kick";
  if (pitch === SNARE || pitch === SIDE_STICK) return "snare";
  if (pitch === CLOSED_HAT || pitch === PEDAL_HAT || pitch === OPEN_HAT || pitch === RIDE) return "hats";
  return "toms";
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** A normal draw with mean 0 and deviation 1, by Box-Muller from two uniform draws. */
function gaussian(random: Random): number {
  // The first draw is kept above zero, so its logarithm is finite.
  const u = Math.max(random.next(), Number.MIN_VALUE);
  const v = random.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Index of the last beat at or before `time`, or -1 when none is. The beats are in time order. */
function beatAtOrBefore(beats: readonly number[], time: number): number {
  let low = 0;
  let high = beats.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (beats[middle] <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Where a note sits in the bar: whether it is on a beat, and which beat of the bar (0 is the downbeat). */
function placeOf(grid: BeatGrid, time: number): { onBeat: boolean; position: number } {
  const beats = grid.beats;
  const beat = beatAtOrBefore(beats, time);
  if (beat < 0) return { onBeat: false, position: 0 };
  const span = beatSpan(beats, beat);
  const fraction = span > 0 ? (time - beats[beat]) / span : 0;
  const onBeat = fraction < ON_BEAT_WINDOW || fraction > 1 - ON_BEAT_WINDOW;
  const nearest = fraction > 0.5 ? beat + 1 : beat;
  return { onBeat, position: beatInBar(grid, nearest) };
}

/** The length of the beat a time falls in, in seconds. */
function beatLengthAt(grid: BeatGrid, time: number): number {
  return beatSpan(grid.beats, Math.max(0, beatAtOrBefore(grid.beats, time)));
}

/**
 * The indices of the hats that are in a run of eighths: a hat whose neighbour before or after it is an eighth note away. Runs are found
 * on the notes' own times, before any shift.
 */
function hatRuns(grid: BeatGrid, notes: readonly NoteEvent[]): Set<number> {
  const hats = notes
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => HAT_PITCHES.includes(note.pitch))
    .sort((a, b) => a.note.time - b.note.time);
  const eighthApart = (earlier: NoteEvent, later: NoteEvent): boolean => {
    const span = beatLengthAt(grid, earlier.time);
    return Math.abs(later.time - earlier.time - span / 2) <= ON_BEAT_WINDOW * span;
  };
  const runs = new Set<number>();
  hats.forEach((hat, k) => {
    const before = hats[k - 1];
    const after = hats[k + 1];
    if ((before && eighthApart(before.note, hat.note)) || (after && eighthApart(hat.note, after.note))) runs.add(hat.index);
  });
  return runs;
}

/**
 * The beat accent of a drum note, at full amount: the downbeat, the backbeat, and the hat dynamics (off-beat hats are softer, and in a
 * run of eighths the on-beat hat is louder than the off-beat one).
 */
function accentOf(note: NoteEvent, grid: BeatGrid, inRun: boolean): number {
  const place = placeOf(grid, note.time);
  let accent = 0;
  if (place.onBeat && place.position === 0) accent += DOWNBEAT_ACCENT;
  if (note.pitch === SNARE && place.onBeat && place.position % 2 === 1) accent += BACKBEAT_ACCENT;
  if (HAT_PITCHES.includes(note.pitch)) {
    if (!place.onBeat) accent += OFFBEAT_HAT_ACCENT;
    if (inRun) accent += place.onBeat ? HAT_RUN_ALTERNATION : -HAT_RUN_ALTERNATION;
  }
  return accent;
}

/** The feel a note plays with. "style" takes the feel of the style whose plan covers the note's time. */
function feelAt(plans: readonly SectionPlan[], settings: HumaniseSettings, time: number): HumaniseFeel {
  if (settings.feel !== "style") return settings.feel;
  const index = planIndexAt(plans, time);
  const style = index >= 0 ? findStyle(plans[index].style) : undefined;
  return style?.feelDefault ?? DEFAULT_FEEL;
}

/**
 * Humanises one part's notes and returns them in time order. At amount 0 the notes come back unchanged, the same objects in the same
 * order. Otherwise each note moves by its group's feel shift plus a seeded spread, and its velocity takes the beat accents and a random
 * spread. The bass only moves and takes a smaller velocity spread, and a bass note shifted later keeps its end where it was.
 *
 * `plans` give each note's style, which sets its feel when the setting says "style". `seed` is the request's seed; the humanising draws
 * from its own stream of it, so a change of amount keeps the same notes and changes only how far they move.
 */
export function humanise(
  notes: readonly NoteEvent[],
  part: HumanisePart,
  grid: BeatGrid,
  plans: readonly SectionPlan[],
  settings: HumaniseSettings,
  seed: number,
): NoteEvent[] {
  const amount = clamp(settings.amount, 0, 1);
  if (amount <= 0) return [...notes];

  const random = createRandom(seed ^ (part === "bass" ? BASS_STREAM : DRUM_STREAM));
  const runs = part === "drums" ? hatRuns(grid, notes) : new Set<number>();
  const spread = part === "bass" ? BASS_VELOCITY_SPREAD : DRUM_VELOCITY_SPREAD;

  const out = notes.map((note, index): NoteEvent => {
    const feel = feelAt(plans, settings, note.time);
    const group: TimingGroup = part === "bass" ? "bass" : groupOf(note.pitch);
    // Every note draws the same numbers whatever the amount, so the amount only scales how far each one moves.
    const offsetMs = clamp(amount * (FEEL_SHIFT_MS[group][feel] + FEEL_SPREAD_MS[group][feel] * gaussian(random)), -MAX_SHIFT_MS, MAX_SHIFT_MS);
    const jitter = 2 * random.next() - 1;
    const accent = part === "drums" ? accentOf(note, grid, runs.has(index)) : 0;

    // A dead note keeps its own velocity and length: only its timing moves, so it stays just before the note it belongs to.
    if (note.dead) return { ...note, time: Math.max(0, note.time + offsetMs / 1000) };

    let velocity = note.velocity + amount * (accent + spread * jitter);
    // A ghost stays a ghost: its humanised velocity stays under GHOST_BELOW.
    if (note.velocity < GHOST_BELOW) velocity = Math.min(velocity, GHOST_BELOW - 1);

    const shift = offsetMs / 1000;
    const duration = part === "bass" && shift > 0 ? Math.min(note.duration, Math.max(MIN_BASS_DURATION, note.duration - shift)) : note.duration;
    return { ...note, time: Math.max(0, note.time + shift), velocity: clampVelocity(velocity), duration };
  });

  // Array sort is stable, so notes that now share a time keep the order they came in.
  return out.sort((a, b) => a.time - b.time);
}
