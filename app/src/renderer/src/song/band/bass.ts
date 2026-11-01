// Bass generation: turns the beat grid, the chords and the section plans into timed bass notes. Pure: no audio and no store.
// The rhythm comes from the style's bass templates, from a quarter-note walk, or from the kick when the bass locks to it. Each step
// takes the chord sounding on its beat. Octaves are picked to stay in range and to move as little as possible from the note before.
//
// Two steps are always planned together. An approach note is placed a semitone (or a whole tone) from the next bass note, and the
// next bass note is then picked from that approach. Both picks land on the same octave, because the approach is within a tone of the
// target and no other octave of the same pitch class is that close.

import type { BandSettings, BassRange, SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { bassRhythmFromAccents, hitSteps, isAccented, type Feel } from "./feel";
import type { ChordQuality, ChordSeventh, ChordAtBeat, ParsedChord } from "./harmony";
import type { NoteEvent } from "./note";
import { createRandom, type Random } from "./random";
import { findStyle } from "./styles";
import type { Energy, Style } from "./styles/types";
import { barBeats, barEnd, barStarts, beatSpan, clampVelocity, planIndexAt, stepAt } from "./timing";

/** Lowest and highest MIDI note of each range, and where the line starts (around A1 to A2). */
export const BASS_NOTE_RANGES: Record<BassRange, { low: number; high: number; centre: number }> = {
  low: { low: 28, high: 40, centre: 34 },
  normal: { low: 28, high: 55, centre: 40 },
  high: { low: 33, high: 60, centre: 46 },
};

/** A kick within this many seconds of a step locks the step to it. */
const LOCK_WINDOW = 0.03;
/** A note stops this far short of the next bass note. */
const LEGATO_GAP = 0.03;
/** The shortest a bass note may be, in seconds. */
const MIN_DURATION = 0.05;
/** A downbeat takes the lowest octave within this many semitones of the note before, so the line stays low on the beat. */
const MAX_LEAP = 7;
/** A walking note is a chord tone within this many semitones of the note before, when one exists. */
const WALK_LEAP = 5;
/** From energy 4 up a note lasts at most one beat. Below it a note lasts at most 1.5 beats. */
const SHORT_NOTE_BEATS = 1;
const LONG_NOTE_BEATS = 1.5;
/** At energy 1 a note lasts to the next note, up to this many beats. */
const SPARSE_MAX_BEATS = 2;
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
  energy: Energy;
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
  /** The section's loud level, which sets the note's base velocity. */
  loud: Energy;
  /** The chord changed since the step before. This step plays the new bass note in every mode. */
  forced: boolean;
  /** An off-beat step that takes the fifth in roots-fifths. The off-beat steps alternate fifth and root. */
  fifth: boolean;
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

type Range = (typeof BASS_NOTE_RANGES)[BassRange];

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

/** The note for a step that is not an approach. Roots-fifths, melodic and octaves share these rules. */
function plainPitch(slot: Slot, chord: ParsedChord, previous: number, mode: BandSettings["bassMode"], range: Range): number {
  if (mode === "roots") return nearestOctave(chord.bass, previous, range, slot.strong);
  if (mode === "octaves") {
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
function pitchOf(slot: Slot, chord: ParsedChord, next: Slot | undefined, previous: number, settings: BandSettings, range: Range): Picked {
  if (slot.ending) return { pitch: nearestOctave(chord.bass, previous, range, true), approach: false };
  if (settings.bassMode === "walking" && slot.style.bass.walking) return walkingPitch(slot, chord, next, previous, range);
  if (settings.bassMode === "melodic" && approachApplies(slot, chord, next)) {
    const target = nearestOctave(next.chord.bass, previous, range, false);
    const approach = approachNote(target, previous, range, settings.complexity < CHROMATIC_FROM ? 2 : 1);
    if (approach !== null) return { pitch: approach, approach: true };
  }
  return { pitch: plainPitch(slot, chord, previous, settings.bassMode, range), approach: false };
}

/** How long a note lasts, in seconds. It runs to the next note, minus a short gap, and never past its bar. */
function noteLength(slot: Slot, nextTime: number, beatLength: number, energy: Energy): number {
  if (slot.ending) return slot.barEnd - slot.time;
  const gap = nextTime - slot.time;
  const length =
    energy === 1 ? Math.min(gap, SPARSE_MAX_BEATS * beatLength) : Math.min(gap - LEGATO_GAP, (energy >= 4 ? SHORT_NOTE_BEATS : LONG_NOTE_BEATS) * beatLength);
  return Math.max(MIN_DURATION, Math.min(length, slot.barEnd - slot.time));
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
 * silent, and the last bar of the song is one held note on its downbeat. With `feel`, the rhythm follows the accents unless the bass
 * locks to the kick, a stop is silent, and a hit beat always gets a note.
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
  const slots: Slot[] = [];
  const chordAt = (beat: number): ParsedChord | null => harmony[beat]?.chord ?? null;
  const nameAt = (beat: number): string | null => chordAt(beat)?.name ?? null;

  let segment: Segment | null = null;
  let previousBeat = -1;

  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    const planIndex = planIndexAt(plans, beats[start]);
    const plan = planIndex >= 0 ? plans[planIndex] : undefined;
    const style = plan && plan.play.bass ? findStyle(plan.style) : undefined;
    if (!plan || !style) {
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
          chord: chordAt(start),
          style,
          energy: plan.energy,
          index: 0,
          last: true,
          strong: true,
          downbeat: true,
          locked: false,
          loud: plan.loud,
          forced: false,
          fifth: false,
          ending: true,
          barEnd: end,
          nextBarBass,
        });
      }
      previousBeat = start;
      continue;
    }

    const variations = style.bass.rhythms[plan.energy];
    if (!segment || segment.plan !== planIndex || segment.barsLeft === 0) {
      segment = { plan: planIndex, rhythm: random.int(variations.length), barsLeft: random.pick(VARIATION_BARS) };
    }
    segment.barsLeft -= 1;

    // Steps are drawn the same way in every mode, so the variation a bar gets does not depend on the mode or on the kick.
    const steps = style.meter.beatsPerBar * style.meter.stepsPerBeat;
    const points = Array.from({ length: steps }, (_, step) => stepAt(beats, style, start, step, steps, perBar, settings.swing));
    const walking = settings.bassMode === "walking" && style.bass.walking;
    let rhythm = walking ? quarterSteps(steps, perBar) : variations[segment.rhythm];
    const kicks = settings.lockToKick ? kick.filter((note) => note.time >= beats[start] - LOCK_WINDOW && note.time < end - LOCK_WINDOW) : [];
    const accent = feel ? feel.profiles[planIndex] : undefined;
    const locked = kicks.length > 0 ? kickSteps(kicks, points) : new Set<number>();
    if (kicks.length > 0) rhythm = [...new Set([0, ...locked])].sort((a, b) => a - b);
    else if (isAccented(accent) && !walking) rhythm = bassRhythmFromAccents(accent.weights, style.meter.stepsPerBeat, perBar);
    if (feel) rhythm = [...rhythm, ...hitSteps(feel, start, perBar, steps)];

    const silent = (step: number): boolean => feel?.stops.has(points[step].beat) ?? false;
    const stepList = [...new Set(rhythm)].filter((step) => step >= 0 && step < steps && !silent(step)).sort((a, b) => a - b);
    let offBeat = 0;
    stepList.forEach((step, index) => {
      const point = points[step];
      if (point.beat >= beats.length) return;
      const strong = step === 0 || 2 * step === steps;
      const forced = previousBeat >= 0 && nameAt(previousBeat) !== nameAt(point.beat);
      if (!strong && !forced) offBeat += 1;
      slots.push({
        time: point.time,
        beat: point.beat,
        chord: chordAt(point.beat),
        style,
        energy: plan.energy,
        index,
        last: index === stepList.length - 1,
        strong,
        downbeat: step === 0,
        locked: locked.has(step),
        loud: plan.loud,
        forced,
        fifth: !strong && !forced && offBeat % 2 === 1,
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
 * starting from the middle of the range. Velocities are jittered from the seed.
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
  const notes: NoteEvent[] = [];
  if (grid.beats.length === 0 || plans.length === 0) return notes;

  const random = createRandom(seed);
  const slots = buildSlots(grid, harmony, plans, settings, kick, random, feel);
  const range = BASS_NOTE_RANGES[settings.bassRange];
  let previous = range.centre;

  slots.forEach((slot, i) => {
    if (!slot.chord) return;
    const next = slots[i + 1];
    const { pitch, approach } = pitchOf(slot, slot.chord, next, previous, settings, range);
    const accent = (slot.downbeat ? DOWNBEAT_ACCENT : 0) + (slot.locked ? KICK_ACCENT : 0) + (approach ? APPROACH_DIP : 0);
    const jitter = random.int(2 * VELOCITY_JITTER + 1) - VELOCITY_JITTER;
    const nextTime = next ? next.time : slot.barEnd;
    notes.push({
      time: slot.time,
      pitch,
      velocity: clampVelocity(LOUD_VELOCITY[slot.loud] + accent + jitter),
      duration: noteLength(slot, nextTime, beatSpan(grid.beats, slot.beat), slot.energy),
    });
    previous = pitch;
  });

  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
