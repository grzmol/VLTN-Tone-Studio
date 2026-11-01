// Bass generation: turns the beat grid, the chords and the section plans into timed bass notes. Pure: no audio and no store.
// Each section plays one bass part (bass-parts.ts). A part sets the rhythm of each bar and the role of each step. The groove, melodic
// and walking parts take their rhythm from the style's templates, a quarter-note walk, or the kick when the bass locks to it. Ring,
// pulse and pedal take their rhythm from bass-parts.ts. Each step takes the chord sounding on its beat. Octaves are picked to stay in
// range and to move as little as possible from the note before.
//
// Two steps are always planned together. An approach note is placed a semitone (or a whole tone) from the next bass note, and the
// next bass note is then picked from that approach. Both picks land on the same octave, because the approach is within a tone of the
// target and no other octave of the same pitch class is that close.

import type { BandSettings, BassMode, SectionPlan } from "./arrangement";
import { OCTAVE_SHIFTS, pedalSteps, pulseSteps, ringSteps, type BarStep, type BassPart, type OctaveShift } from "./bass-parts";
import type { BeatGrid } from "./beat-grid";
import { bassRhythmFromAccents, hitSteps, isAccented, type Feel } from "./feel";
import type { ChordQuality, ChordSeventh, ChordAtBeat, ParsedChord } from "./harmony";
import type { NoteEvent } from "./note";
import { createRandom, type Random } from "./random";
import { findStyle } from "./styles";
import type { Energy, Style } from "./styles/types";
import { barBeats, barEnd, barStarts, clampVelocity, planIndexAt, stepAt } from "./timing";

/** Lowest and highest MIDI note of each range, and where the line starts (around A1 to A2). */
export const BASS_NOTE_RANGES: Record<"low" | "normal" | "high", { low: number; high: number; centre: number }> = {
  low: { low: 28, high: 40, centre: 34 },
  normal: { low: 28, high: 55, centre: 40 },
  high: { low: 33, high: 60, centre: 46 },
};

/** A kick within this many seconds of a step locks the step to it. */
const LOCK_WINDOW = 0.03;
/** A note stops this far short of the next bass note. */
const NOTE_GAP = 0.03;
/** The shortest a bass note may be, in seconds. */
const MIN_DURATION = 0.05;
/** A downbeat takes the lowest octave within this many semitones of the note before, so the line stays low on the beat. */
const MAX_LEAP = 7;
/** A walking note is a chord tone within this many semitones of the note before, when one exists. */
const WALK_LEAP = 5;
/** Note length as a share of the step to the next note: groove and melodic by loud level, pulse by loud level, walking fixed. */
const GROOVE_SHARE: readonly [number, number] = [0.7, 0.95];
const PULSE_SHARE: readonly [number, number] = [0.4, 0.9];
const WALKING_SHARE = 0.9;
/** The bass feel scales every length: 0 (tight) gives 0.6, 1 (ring) gives 1.4, and 0.5 gives 1. */
const FEEL_TIGHT = 0.6;
const FEEL_RING = 1.4;
/** Below this complexity an approach note is a whole tone away instead of a semitone. */
const CHROMATIC_FROM = 2 / 3;
/** A variation lasts this many bars, picked at random each time one ends. */
const VARIATION_BARS: readonly [4, 8] = [4, 8];
/** The base velocity of a bass note at each loud level of its section, from soft (1) to hard (5). */
export const LOUD_VELOCITY: Readonly<Record<Energy, number>> = { 1: 45, 2: 60, 3: 75, 4: 92, 5: 110 };
/** A downbeat is played this much harder than the rest of its loud level. */
const DOWNBEAT_ACCENT = 8;
/** A note locked to the kick is played this much harder. */
const KICK_ACCENT = 5;
/** An approach note is played this much softer, so it leads in without taking the line. */
const APPROACH_DIP = -10;
const VELOCITY_JITTER = 4;

/** Intervals above the root, in semitones. A missing third or seventh is null. */
const THIRD: Record<ChordQuality, number | null> = { major: 4, minor: 3, dim: 3, aug: 4, sus2: 2, sus4: 5, power: null };
const SEVENTH: Record<ChordSeventh, number | null> = { none: null, dom7: 10, maj7: 11, min7: 10, dim7: 9, "half-dim": 10 };

/** The variation a plan is playing, and how many bars it has left. */
interface Segment {
  plan: number;
  rhythm: number;
  barsLeft: number;
}

/** One step that can sound: its time and the chord under it, before a note is picked. */
interface Slot {
  time: number;
  /** Absolute beat index of the step. */
  beat: number;
  /** Null for a rest. */
  chord: ParsedChord | null;
  style: Style;
  /** Index of the section plan the step belongs to. */
  plan: number;
  /** The part the bar plays. */
  part: BassPart;
  /** The pitch method: groove keeps the song's bass mode, the other parts have their own. */
  method: BassMode;
  /** The bar walks: a quarter-note line through the chord's tones. */
  walking: boolean;
  /** The loud level of the bar, which sets the base velocity and the length. */
  loud: Energy;
  /** The section's octave shift, applied when every note of the section fits the range. */
  octave: OctaveShift;
  /** Position of the step in its bar's rhythm. */
  index: number;
  /** The last step of its bar. */
  last: boolean;
  /** The first step of the bar, or the middle one. */
  strong: boolean;
  /** The first step of the bar: the downbeat. */
  downbeat: boolean;
  /** The step is one the kick locks the bass to, so the bass lands with the kick. */
  locked: boolean;
  /** The chord changed since the step before. This step plays the new bass note in every mode. */
  forced: boolean;
  /** An off-beat step that takes the fifth in roots-fifths. The off-beat steps alternate fifth and root. */
  fifth: boolean;
  /** The part's role for this step: a root, or the fifth (a passing note in a ring bar). */
  role: "root" | "fifth";
  /** The song's last bar: one held bass note on its downbeat. */
  ending: boolean;
  /** Song time the bar ends. */
  barEnd: number;
  /** Bass pitch class of the chord on the next bar's downbeat. Walking lines head toward it. Null past the end of the grid or on a rest. */
  nextBarBass: number | null;
}

interface Picked {
  pitch: number;
  /** An approach note, which plays a little softer. */
  approach: boolean;
}

type Range = (typeof BASS_NOTE_RANGES)[keyof typeof BASS_NOTE_RANGES];

const pitchClass = (note: number): number => ((note % 12) + 12) % 12;

/** Semitones from the root to the fifth. A diminished chord has a flat fifth, an augmented one a sharp fifth. */
function fifthInterval(quality: ChordQuality): number {
  if (quality === "dim") return 6;
  if (quality === "aug") return 8;
  return 7;
}

/** The chord's tones as pitch classes: root, third, fifth and seventh where the chord has them. */
function chordTones(chord: ParsedChord): number[] {
  const intervals = [0, THIRD[chord.quality], fifthInterval(chord.quality), SEVENTH[chord.seventh]];
  return intervals.filter((interval): interval is number => interval !== null).map((interval) => pitchClass(chord.root + interval));
}

/**
 * The lowest octave of a pitch class that the range allows and that is closest to `from`. On a strong step the lowest octave within
 * MAX_LEAP of `from` wins instead, so a downbeat sits low. Ties go to the lower note.
 */
function nearestOctave(pc: number, from: number, range: Range, strong: boolean): number {
  const candidates: number[] = [];
  for (let note = range.low; note <= range.high; note++) if (pitchClass(note) === pc) candidates.push(note);
  if (candidates.length === 0) return from;
  if (strong) {
    const lowest = candidates.find((note) => Math.abs(note - from) <= MAX_LEAP);
    if (lowest !== undefined) return lowest;
  }
  return candidates.reduce((best, note) => (Math.abs(note - from) < Math.abs(best - from) ? note : best));
}

/** A note a `semitones` step below or above `target`, whichever is closer to `from`. Null when neither is in range. */
function approachNote(target: number, from: number, range: Range, semitones: number): number | null {
  const options = [target - semitones, target + semitones].filter((note) => note >= range.low && note <= range.high);
  if (options.length === 0) return null;
  return options.reduce((best, note) => (Math.abs(note - from) < Math.abs(best - from) ? note : best));
}

/** A chord tone in range that walks toward `target`: near `from` where it can be, and never the note just played. */
function walkingTone(chord: ParsedChord, from: number, target: number, range: Range): number {
  const tones = chordTones(chord);
  const inRange: number[] = [];
  for (let note = range.low; note <= range.high; note++) if (tones.includes(pitchClass(note))) inRange.push(note);
  const pools = [inRange.filter((note) => note !== from && Math.abs(note - from) <= WALK_LEAP), inRange.filter((note) => note !== from), inRange];
  const pool = pools.find((candidates) => candidates.length > 0) ?? [from];
  return pool.reduce((best, note) => (Math.abs(note - target) < Math.abs(best - target) ? note : best));
}

/** The next bass note is a different note from this one, so an approach note into it is worth playing. */
function approachApplies(slot: Slot, chord: ParsedChord, next: Slot | undefined): next is Slot & { chord: ParsedChord } {
  return next?.chord !== null && next?.chord !== undefined && next.chord.bass !== chord.bass && (slot.last || next.forced);
}

/** The note for a step that is not an approach. A fifth role plays the fifth; otherwise the pitch method decides. */
function plainPitch(slot: Slot, chord: ParsedChord, previous: number, method: BassMode, range: Range): number {
  if (slot.role === "fifth") return nearestOctave(pitchClass(chord.bass + fifthInterval(chord.quality)), previous, range, false);
  if (method === "roots") return nearestOctave(chord.bass, previous, range, slot.strong);
  if (method === "octaves") {
    const base = nearestOctave(chord.bass, previous, range, slot.strong);
    const upper = base + 12;
    return slot.index % 2 === 1 && !slot.forced && upper <= range.high ? upper : base;
  }
  // Fifths and melodic: the bass note on a strong or forced step, otherwise the fifth or the root in turn.
  if (slot.strong || slot.forced) return nearestOctave(chord.bass, previous, range, slot.strong);
  const fifth = pitchClass(chord.bass + fifthInterval(chord.quality));
  return nearestOctave(slot.fifth ? fifth : chord.bass, previous, range, false);
}

/** The note for a walking step. Beat one is the bass note, the last beat is a chromatic approach, and the beats between are chord tones. */
function walkingPitch(slot: Slot, chord: ParsedChord, next: Slot | undefined, previous: number, range: Range): Picked {
  if (slot.index === 0 || slot.forced) return { pitch: nearestOctave(chord.bass, previous, range, slot.strong), approach: false };
  if (slot.last && next?.chord) {
    const target = nearestOctave(next.chord.bass, previous, range, false);
    const approach = approachNote(target, previous, range, 1);
    if (approach !== null) return { pitch: approach, approach: true };
  }
  const target = nearestOctave(slot.nextBarBass ?? chord.bass, previous, range, false);
  return { pitch: walkingTone(chord, previous, target, range), approach: false };
}

/** The note for one step, and whether it is an approach. Rests are not passed in. */
function pitchOf(slot: Slot, chord: ParsedChord, next: Slot | undefined, previous: number, range: Range, settings: BandSettings): Picked {
  if (slot.ending) return { pitch: nearestOctave(chord.bass, previous, range, true), approach: false };
  if (slot.method === "walking" && slot.walking) return walkingPitch(slot, chord, next, previous, range);
  if (slot.method === "melodic" && approachApplies(slot, chord, next)) {
    const target = nearestOctave(next.chord.bass, previous, range, false);
    const approach = approachNote(target, previous, range, settings.complexity < CHROMATIC_FROM ? 2 : 1);
    if (approach !== null) return { pitch: approach, approach: true };
  }
  return { pitch: plainPitch(slot, chord, previous, slot.method, range), approach: false };
}

/** The pitch method each part uses. Groove keeps the song's bass mode, so a song on groove sounds as it always did. */
function methodOf(part: BassPart, mode: BassMode): BassMode {
  if (part === "groove") return mode;
  if (part === "melodic") return "melodic";
  if (part === "walking") return "walking";
  return "roots";
}

/** The steps a part plays in one bar, when the part has its own rhythm. Groove, melodic and walking use the style's rhythm instead. */
function ownSteps(part: BassPart, busy: Energy, steps: number, stepsPerBeat: number, bar: number): BarStep[] | null {
  if (part === "ring") return ringSteps(busy, steps, bar);
  if (part === "pulse") return pulseSteps(busy, steps, stepsPerBeat);
  if (part === "pedal") return pedalSteps();
  return null;
}

/**
 * How long a note lasts, in seconds. Ring lasts to the next note. Pulse, groove and melodic last a share of the step to the next note,
 * rising with the loud level, and walking a fixed share. Pedal lasts to the bar end. The bass feel scales the result, and the note never
 * runs past the next note less a gap, or past its bar.
 */
function noteLength(slot: Slot, nextTime: number, feel: number): number {
  if (slot.ending) return slot.barEnd - slot.time;
  const gap = nextTime - slot.time;
  const bar = slot.barEnd - slot.time;
  const level = (slot.loud - 1) / 4;
  const share = (range: readonly [number, number]): number => range[0] + (range[1] - range[0]) * level;
  let length: number;
  if (slot.part === "ring") length = gap;
  else if (slot.part === "pedal") length = bar;
  else if (slot.part === "pulse") length = gap * share(PULSE_SHARE);
  else if (slot.walking) length = gap * WALKING_SHARE;
  else length = gap * share(GROOVE_SHARE);
  length *= FEEL_TIGHT + (FEEL_RING - FEEL_TIGHT) * feel;
  return Math.max(MIN_DURATION, Math.min(length, gap - NOTE_GAP, bar));
}

/** The steps nearest each kick within the window. A step is matched once, however many kicks land on it. */
function kickSteps(kicks: readonly NoteEvent[], points: readonly { time: number }[]): Set<number> {
  const matched = new Set<number>();
  for (const kick of kicks) {
    let nearest = -1;
    let nearestGap = Infinity;
    points.forEach((point, step) => {
      const gap = Math.abs(point.time - kick.time);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = step;
      }
    });
    if (nearestGap <= LOCK_WINDOW) matched.add(nearest);
  }
  return matched;
}

/** One step per beat of the bar: "quarter notes", the walking rhythm. */
function quarterSteps(steps: number, perBar: number): number[] {
  return Array.from({ length: perBar }, (_, beat) => Math.round((beat * steps) / perBar));
}

/**
 * The steps that can sound, in time order, for every bar with bass on. A bar belongs to the plan covering its first beat. The pickup is
 * silent, the last bar of the song is one held note on its downbeat, and a rest part plays nothing. With `feel`, the rhythm follows the
 * accents unless the bass locks to the kick, a stop is silent, and a hit beat always gets a note.
 */
function buildSlots(
  grid: BeatGrid,
  harmony: readonly ChordAtBeat[],
  plans: readonly SectionPlan[],
  settings: BandSettings,
  kick: readonly NoteEvent[],
  random: Random,
  feel: Feel | undefined,
): Slot[] {
  const beats = grid.beats;
  const perBar = barBeats(grid);
  const starts = barStarts(grid);
  const planOf = starts.map((beat) => planIndexAt(plans, beats[beat]));
  const barsInPlan = new Map<number, number>();
  for (const index of planOf) if (index >= 0) barsInPlan.set(index, (barsInPlan.get(index) ?? 0) + 1);
  const slots: Slot[] = [];
  const chordAt = (beat: number): ParsedChord | null => harmony[beat]?.chord ?? null;
  const nameAt = (beat: number): string | null => chordAt(beat)?.name ?? null;

  let segment: Segment | null = null;
  let previousBeat = -1;
  let currentPlan = -2;
  let barInPlan = 0;
  let pedalChord: ParsedChord | null = null;

  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    const planIndex = planOf[k];
    if (planIndex !== currentPlan) {
      currentPlan = planIndex;
      barInPlan = 0;
      // A pedal holds the chord the section starts on, whatever the chords do after it.
      const first = planIndex >= 0 ? beats.findIndex((time) => time >= plans[planIndex].start - 1e-9) : -1;
      pedalChord = first >= 0 ? chordAt(first) : null;
    } else {
      barInPlan += 1;
    }
    const plan = planIndex >= 0 ? plans[planIndex] : undefined;
    const style = plan && plan.play.bass ? findStyle(plan.style) : undefined;
    if (!plan || !style || plan.bassPart === "rest") {
      segment = null;
      continue;
    }

    const end = barEnd(beats, start, perBar);
    const nextBarBass = chordAt(start + perBar)?.bass ?? null;
    if (k === starts.length - 1) {
      if (!feel?.stops.has(start)) {
        slots.push({
          time: beats[start],
          beat: start,
          chord: plan.bassPart === "pedal" ? pedalChord : chordAt(start),
          style,
          plan: planIndex,
          part: plan.bassPart,
          method: methodOf(plan.bassPart, settings.bassMode),
          walking: false,
          loud: plan.loud,
          octave: plan.octave,
          index: 0,
          last: true,
          strong: true,
          downbeat: true,
          locked: false,
          forced: false,
          fifth: false,
          role: "root",
          ending: true,
          barEnd: end,
          nextBarBass,
        });
      }
      previousBeat = start;
      continue;
    }

    // A lead is the first bars of a section that play another part. It needs a section of at least four bars.
    const planBars = barsInPlan.get(planIndex) ?? 0;
    const lead = plan.bassLead && planBars >= 4 && barInPlan < plan.bassLead.bars ? plan.bassLead.part : undefined;
    const part: BassPart = lead ?? plan.bassPart;
    const loud = (plan.bassRamp && barInPlan >= planBars - 2 ? Math.min(5, plan.loud + 1) : plan.loud) as Energy;
    const method = methodOf(part, settings.bassMode);
    const grooveLike = part === "groove" || part === "melodic" || part === "walking";

    const variations = style.bass.rhythms[plan.busy];
    if (!segment || segment.plan !== planIndex || segment.barsLeft === 0) {
      segment = { plan: planIndex, rhythm: random.int(variations.length), barsLeft: random.pick(VARIATION_BARS) };
    }
    segment.barsLeft -= 1;

    // Steps are drawn the same way in every mode, so the variation a bar gets does not depend on the mode or on the kick.
    const steps = style.meter.beatsPerBar * style.meter.stepsPerBeat;
    const points = Array.from({ length: steps }, (_, step) => stepAt(beats, style, start, step, steps, perBar, settings.swing));
    const walking = part === "walking" || (part === "groove" && settings.bassMode === "walking" && style.bass.walking);
    const own = ownSteps(part, plan.busy, steps, style.meter.stepsPerBeat, barInPlan);
    const roles = new Map<number, "root" | "fifth">();
    let rhythm: number[];
    if (own) {
      rhythm = own.map((entry) => entry.step);
      for (const entry of own) roles.set(entry.step, entry.role);
    } else {
      rhythm = walking ? quarterSteps(steps, perBar) : variations[segment.rhythm];
    }
    let locked = new Set<number>();
    if (grooveLike) {
      const kicks = settings.lockToKick ? kick.filter((note) => note.time >= beats[start] - LOCK_WINDOW && note.time < end - LOCK_WINDOW) : [];
      const accent = feel ? feel.profiles[planIndex] : undefined;
      if (kicks.length > 0) {
        locked = kickSteps(kicks, points);
        rhythm = [...new Set([0, ...locked])].sort((a, b) => a - b);
      } else if (isAccented(accent) && !walking) rhythm = bassRhythmFromAccents(accent.weights, style.meter.stepsPerBeat, perBar);
    }
    // A chord that changes in the middle of a bar is struck there, for every part but the pedal and the walk.
    if (part !== "pedal" && !walking) {
      for (let step = 1; step < steps; step++) {
        if (points[step].beat < beats.length && nameAt(points[step].beat) !== nameAt(points[step - 1].beat)) rhythm.push(step);
      }
    }
    if (feel) rhythm = [...rhythm, ...hitSteps(feel, start, perBar, steps)];

    const silent = (step: number): boolean => feel?.stops.has(points[step].beat) ?? false;
    const stepList = [...new Set(rhythm)].filter((step) => step >= 0 && step < steps && !silent(step)).sort((a, b) => a - b);
    let offBeat = 0;
    stepList.forEach((step, index) => {
      const point = points[step];
      if (point.beat >= beats.length) return;
      const strong = step === 0 || 2 * step === steps;
      const pedal = part === "pedal";
      const forced = !pedal && previousBeat >= 0 && nameAt(previousBeat) !== nameAt(point.beat);
      if (!strong && !forced) offBeat += 1;
      slots.push({
        time: point.time,
        beat: point.beat,
        chord: pedal ? pedalChord : chordAt(point.beat),
        style,
        plan: planIndex,
        part,
        method,
        walking,
        loud,
        octave: plan.octave,
        index,
        last: index === stepList.length - 1,
        strong,
        downbeat: step === 0,
        locked: locked.has(step),
        forced,
        fifth: !strong && !forced && offBeat % 2 === 1,
        role: roles.get(step) ?? "root",
        ending: false,
        barEnd: end,
        nextBarBass,
      });
      previousBeat = point.beat;
    });
  }

  return slots;
}

/**
 * Bass notes for the whole song, sorted by time. Rests come from null chords. Each note's octave is picked from the note before it,
 * starting from the middle of the range. Velocities are jittered from the seed. A section's octave shift is applied to all its notes,
 * or to none of them when any would leave the range.
 */
export function generateBass(
  grid: BeatGrid,
  harmony: readonly ChordAtBeat[],
  plans: readonly SectionPlan[],
  settings: BandSettings,
  kick: readonly NoteEvent[],
  seed: number,
  feel?: Feel,
): NoteEvent[] {
  if (grid.beats.length === 0 || plans.length === 0) return [];

  const random = createRandom(seed);
  const slots = buildSlots(grid, harmony, plans, settings, kick, random, feel);
  const range = BASS_NOTE_RANGES[settings.bassRange];
  let previous = range.centre;
  const picked: { slot: Slot; pitch: number; velocity: number; duration: number; time: number }[] = [];

  slots.forEach((slot, i) => {
    if (!slot.chord) return;
    const next = slots[i + 1];
    const { pitch, approach } = pitchOf(slot, slot.chord, next, previous, range, settings);
    const accent = (slot.downbeat ? DOWNBEAT_ACCENT : 0) + (slot.locked ? KICK_ACCENT : 0) + (approach ? APPROACH_DIP : 0);
    const jitter = random.int(2 * VELOCITY_JITTER + 1) - VELOCITY_JITTER;
    const nextTime = next ? next.time : slot.barEnd;
    picked.push({
      slot,
      pitch,
      velocity: clampVelocity(LOUD_VELOCITY[slot.loud] + accent + jitter),
      duration: noteLength(slot, nextTime, settings.bassFeel),
      time: slot.time,
    });
    previous = pitch;
  });

  // An octave shift is all or nothing per section: if any of its notes would leave the range, the section keeps its own octave.
  const shifts = new Map<number, number>();
  for (const octave of OCTAVE_SHIFTS) {
    if (octave === 0) continue;
    for (const planIndex of new Set(picked.map((entry) => entry.slot.plan))) {
      if (plans[planIndex]?.octave !== octave) continue;
      const own = picked.filter((entry) => entry.slot.plan === planIndex);
      if (own.every((entry) => entry.pitch + 12 * octave >= range.low && entry.pitch + 12 * octave <= range.high)) shifts.set(planIndex, 12 * octave);
    }
  }

  return picked
    .map((entry) => ({ time: entry.time, pitch: entry.pitch + (shifts.get(entry.slot.plan) ?? 0), velocity: entry.velocity, duration: entry.duration }))
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
