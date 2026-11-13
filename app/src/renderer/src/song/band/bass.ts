// Bass generation: turns the beat grid, the chords and the section plans into timed bass notes. Pure: no audio and no store.
// Each section plays one bass part (bass-parts.ts). A part sets the rhythm of each bar and the role of each step. The groove, melodic
// and walking parts take their rhythm from the style's templates, a quarter-note walk, or the kick when the bass locks to it. Ring,
// pulse and pedal take their rhythm from bass-parts.ts. Each step takes the chord sounding on its beat. Octaves are picked to stay in
// range. At engine 1 each octave moves as little as possible from the note before; at engine 2 each section has a home note and every
// root is the instance of its pitch class nearest to it, so a pitch class keeps its octave through the section.
//
// Two steps are always planned together. An approach note is placed a semitone (or a whole tone) from the next bass note, and the
// next bass note is then picked from that approach. Both picks land on the same octave, because the approach is within a tone of the
// target and no other octave of the same pitch class is that close.

import type { BandSettings, BassMode, BassRange, SectionPlan } from "./arrangement";
import { OCTAVE_SHIFTS, pedalSteps, pulseSteps, ringSteps, type BarStep, type BassPart, type OctaveShift } from "./bass-parts";
import {
  chooseVariation,
  fillScale,
  keyScale,
  leadSteps,
  phraseBars,
  isPhraseEnd,
  scaleNeighbours,
  variationSeed,
  variationSteps,
  walkDown,
  type BandKey,
  type VariantNote,
} from "./bass-phrases";
import type { BeatGrid } from "./beat-grid";
import { chooseFigure, degreePitchClass, lockToKick, type BarNote, type Figure } from "./bass-figures";
import { SEVENTH, THIRD, fifthInterval, pitchClass } from "./chord-tones";
import { bassRhythmFromAccents, hitSteps, isAccented, rhythmScore, type Feel } from "./feel";
import type { ChordQuality, ChordAtBeat, ParsedChord } from "./harmony";
import { endingBar, endingShape } from "./ending";
import type { NoteEvent } from "./note";
import { createRandom, type Random } from "./random";
import { findStyle } from "./styles";
import type { Energy, Style } from "./styles/types";
import {
  barBeats,
  barEnd,
  barSpans,
  beatSpan,
  clampVelocity,
  fitStepsToBar,
  patternBeats,
  planOfBar,
  stepAt,
  stepsPerGridBeat,
  stretchesToBar,
} from "./timing";

/**
 * Lowest and highest MIDI note of each range, and where the line starts (around A1 to A2). Extended is a five-string or a dropped
 * four-string, from B0. Its centre sits low, so a root of C sharp, D or E flat lands below the low E instead of a seventh above it.
 */
export const BASS_NOTE_RANGES: Record<BassRange, { low: number; high: number; centre: number }> = {
  low: { low: 28, high: 40, centre: 34 },
  normal: { low: 28, high: 55, centre: 40 },
  high: { low: 33, high: 60, centre: 46 },
  extended: { low: 23, high: 50, centre: 31 },
};

/** A song in one of these keys (C, C sharp, D, E flat) plans with the extended range when the range is still the default. */
const LOW_KEY_TONICS: readonly number[] = [0, 1, 2, 3];

/**
 * The range the bass plans with. The default range (normal) becomes extended for a song whose key has a tonic of C, C sharp, D or E flat,
 * at engine 2. A range the performer chose, and a song with no known key, keep their own. `tonic` is the key's tonic when the range was
 * changed this way, so the panel can say so.
 */
export function bassRangeFor(settings: Pick<BandSettings, "bassRange" | "engine">, keys: readonly BandKey[]): { range: BassRange; tonic: number | null } {
  if (settings.engine < 2 || settings.bassRange !== "normal") return { range: settings.bassRange, tonic: null };
  // The song's key is the one that covers the most of it.
  const key = keys.reduce<BandKey | null>((best, candidate) => (best === null || candidate.end - candidate.start > best.end - best.start ? candidate : best), null);
  return key && LOW_KEY_TONICS.includes(key.tonic) ? { range: "extended", tonic: key.tonic } : { range: settings.bassRange, tonic: null };
}

/** A kick within this many seconds of a step locks the step to it. */
const LOCK_WINDOW = 0.03;
/** A note stops this far short of the next bass note. */
const NOTE_GAP = 0.03;
/** How much of a beat a unison hit of a three-hit ending lasts, and how much of a bar a root of a slow-down lasts. */
const UNISON_SHARE = 0.8;
const SLOWING_SHARE = 0.9;
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
/** A short figure note lasts the step to the next note divided by this. */
const SHORT_SHARE = 3;
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
/** A figure note marked with an accent is played this much harder. */
const FIGURE_ACCENT = 6;
/** An approach note is played this much softer, so it leads in without taking the line. */
const APPROACH_DIP = -10;
const VELOCITY_JITTER = 4;
/** The first note of a section that hits the one is this much harder. */
const HIT_ONE_ACCENT = 6;
/** A slide starts this many semitones below its note, on a chance of this share, into a downbeat after a rest of half a beat. */
const SLIDE_SEMITONES = 2;
const SLIDE_CHANCE = 0.3;
/** A dead note sits in the empty sixteenth before a note, on this chance, at busy 3 and up. It plays soft and short. */
const DEAD_CHANCE = 0.4;
const DEAD_BUSY_FROM = 3;
const DEAD_VELOCITY = 30;
const DEAD_DURATION = 0.04;

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
  /** The section's octave shift: at engine 1 applied when every note of the section fits the range, at engine 2 part of the home note. */
  octave: OctaveShift;
  /** The section's busy level, and whether its bass slides and plays dead notes (bass techniques). */
  busy: number;
  slides: boolean;
  deadNotes: boolean;
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
  /** A phrase variation or lead-in note: its kind, its place in the run, and the note it leads to. */
  variant?: Variant;
  /** The section's first note, which hits the one: it holds to the next chord change, and is harder. */
  hitOne: boolean;
  /** Song time the held note ends at, when it hits the one. */
  holdUntil: number;
  /** The section's name, and which time round it is (0 for the first). A name that appears twice repeats its jitter stream. */
  name: string;
  occurrence: number;
  repeats: boolean;
  /** The chord changed since the step before. This step plays the new bass note in every mode. */
  forced: boolean;
  /** An off-beat step that takes the fifth in roots-fifths. The off-beat steps alternate fifth and root. */
  fifth: boolean;
  /** The figure note the step plays (bass-figures.ts), when the section plays a figure. Its degree decides the pitch. */
  figure?: BarNote;
  /** The part's role for this step: a root, or the fifth (a passing note in a ring bar). */
  role: "root" | "fifth";
  /** The home note of the step's section (engine 2): its most common root, near the middle of the range, moved by the section's octave. Null at engine 1. */
  home: number | null;
  /** The song's key at the step, when the bass plays by engine 2 and the song's key is known. Fills and approach notes stay in it. */
  key: BandKey | null;
  /** The song's last bar: one held bass note on its downbeat. */
  ending: boolean;
  /** Song time the bar ends. */
  barEnd: number;
  /** Bass pitch class of the chord on the next bar's downbeat. Walking lines head toward it. Null past the end of the grid or on a rest. */
  nextBarBass: number | null;
}

/** A variant note as bass.ts places it: its kind, offset, the pitch class it leads to, the chord quality and whether it walks by semitones. */
interface Variant {
  kind: VariantNote["kind"];
  offset: number;
  target: number | null;
  quality: ChordQuality;
  chromatic: boolean;
  /** The key the run walks in. Null walks the scale of the chord's quality. */
  key: BandKey | null;
  /** The plan whose home register the run lands in: the next section for a lead-in, otherwise its own. */
  plan: number;
}

interface Picked {
  /** The root of the bar's chord that a figure note was placed from, so the next root is picked from it and not from a fifth or an octave. */
  root?: number;
  pitch: number;
  /** An approach note, which plays a little softer. */
  approach: boolean;
}

type Range = (typeof BASS_NOTE_RANGES)[keyof typeof BASS_NOTE_RANGES];

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

/** The instance of a pitch class nearest `home` that the range allows. Ties go to the lower note. */
function homeNote(pc: number, home: number, range: Range): number {
  let best = -1;
  for (let note = range.low; note <= range.high; note++) {
    if (pitchClass(note) === pc && (best < 0 || Math.abs(note - home) < Math.abs(best - home))) best = note;
  }
  return best < 0 ? home : best;
}

/**
 * The root of a step. With a home register (engine 2) it is the instance of the pitch class nearest the section's home note, wherever
 * the line went before; otherwise it is the octave nearest the note before.
 */
function rootNote(slot: Pick<Slot, "home">, pc: number, previous: number, range: Range, strong: boolean): number {
  return slot.home === null ? nearestOctave(pc, previous, range, strong) : homeNote(pc, slot.home, range);
}

/**
 * A note `interval` semitones (0 to 12) above a root, placed relative to it so a figure keeps its shape: below the root when the root is
 * above the section's home note, above it otherwise. A note that would leave the range goes the other way.
 */
function placeFromRoot(root: number, interval: number, home: number, range: Range): number {
  if (interval === 0) return root;
  const above = root + interval;
  const below = above - 12;
  const options = root > home ? [below, above] : [above, below];
  return options.find((note) => note >= range.low && note <= range.high) ?? root;
}

/** The note moved by a performer's octave nudge, when the moved note stays in the range. Otherwise the note as it was. */
function nudgedPitch(pitch: number, octave: number | undefined, range: Range): number {
  if (!octave) return pitch;
  const moved = pitch + 12 * octave;
  return moved >= range.low && moved <= range.high ? moved : pitch;
}

/** A note a `semitones` step below or above `target`, whichever is closer to `from`. Null when neither is in range. */
function approachNote(target: number, from: number, range: Range, semitones: number): number | null {
  const options = [target - semitones, target + semitones].filter((note) => note >= range.low && note <= range.high);
  if (options.length === 0) return null;
  return options.reduce((best, note) => (Math.abs(note - from) < Math.abs(best - from) ? note : best));
}

/**
 * The approach note into a melodic bar's next root. In a known key, below 2/3 complexity, it is the scale note just below or above the
 * target (a whole tone or a semitone, as the key has it), when the target is in the key. Otherwise it is `semitones` away.
 */
export function melodicApproach(key: BandKey | null, target: number, from: number, range: Range, semitones: number): number | null {
  const scale = key ? keyScale(key) : null;
  if (!scale || semitones === 1 || !scale.includes(pitchClass(target))) return approachNote(target, from, range, semitones);
  const options = scaleNeighbours(target, scale).filter((note) => note >= range.low && note <= range.high);
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
  const fifth = fifthInterval(chord.quality);
  // With a home register a fifth is placed from the bar's root, so it does not move the root's octave.
  const fifthNote = (): number =>
    slot.home === null ? nearestOctave(pitchClass(chord.bass + fifth), previous, range, false) : placeFromRoot(rootNote(slot, chord.bass, previous, range, false), fifth, slot.home, range);
  if (slot.role === "fifth") return fifthNote();
  if (method === "roots") return rootNote(slot, chord.bass, previous, range, slot.strong);
  if (method === "octaves") {
    const base = rootNote(slot, chord.bass, previous, range, slot.strong);
    const upper = base + 12;
    return slot.index % 2 === 1 && !slot.forced && upper <= range.high ? upper : base;
  }
  // Fifths and melodic: the bass note on a strong or forced step, otherwise the fifth or the root in turn.
  if (slot.strong || slot.forced) return rootNote(slot, chord.bass, previous, range, slot.strong);
  return slot.fifth ? fifthNote() : rootNote(slot, chord.bass, previous, range, false);
}

/**
 * The note for a figure step: its degree placed above the chord's bass note, which is picked from the last root. A fifth, third or
 * seventh that would leave the range moves an octave down. An approach is the scale note (or the semitone, or whole tone) below the next
 * bar's root, and falls back to the fifth when there is no next bar.
 */
function figurePitch(slot: Slot, note: BarNote, chord: ParsedChord, previous: number, range: Range, complexity: number): Picked {
  const root = rootNote(slot, chord.bass, previous, range, slot.strong);
  const home = slot.home ?? root;
  const place = (pc: number): number => placeFromRoot(root, (pc - chord.bass + 12) % 12, home, range);
  if (note.degree === "app") {
    if (slot.nextBarBass !== null) {
      const target = rootNote(slot, slot.nextBarBass, root, range, false);
      const scale = slot.key ? keyScale(slot.key) : null;
      const below = scale && scale.includes(pitchClass(target)) ? scaleNeighbours(target, scale)[0] : target - (complexity < CHROMATIC_FROM ? 2 : 1);
      if (below >= range.low) return { pitch: below, approach: true, root };
    }
    return { pitch: place(pitchClass(chord.bass + fifthInterval(chord.quality))), approach: false, root };
  }
  if (note.degree === "8") return { pitch: placeFromRoot(root, 12, home, range), approach: false, root };
  const pc = degreePitchClass(note.degree, chord, slot.key);
  return { pitch: pc === null ? root : place(pc), approach: false, root };
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
  if (slot.ending) return { pitch: rootNote(slot, chord.bass, previous, range, true), approach: false };
  // A note the performer set by hand is played as set: no approach, walking tone or fifth takes its place.
  if (chord.byHand) return { pitch: rootNote(slot, chord.bass, previous, range, slot.strong), approach: false };
  // A figure note is its degree on the chord. A step that strikes a new chord plays the chord's root, so a figure restarts on the chord.
  if (slot.figure && !slot.forced) return figurePitch(slot, slot.figure, chord, previous, range, settings.complexity);
  if (slot.method === "walking" && slot.walking) return walkingPitch(slot, chord, next, previous, range);
  if (slot.method === "melodic" && approachApplies(slot, chord, next)) {
    const target = rootNote(next, next.chord.bass, previous, range, false);
    const approach = melodicApproach(slot.key, target, previous, range, settings.complexity < CHROMATIC_FROM ? 2 : 1);
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
 * How long a note lasts, in seconds. A hit-the-one note holds to the next chord change or the bar end. Ring lasts to the next note. Pulse,
 * groove, melodic and a variant note last a share of the step to the next note, rising with the loud level, and walking a fixed share.
 * A short figure note lasts a third of that step.
 * Pedal lasts to the bar end. The bass feel scales the result, and the note never runs past the next note less a gap, or past its bar.
 */
function noteLength(slot: Slot, nextTime: number, feel: number): number {
  if (slot.ending) return slot.barEnd - slot.time;
  const gap = nextTime - slot.time;
  const bar = slot.barEnd - slot.time;
  // A hit-the-one note holds past the next note, which the renderer cuts short at its attack.
  if (slot.hitOne) return Math.max(MIN_DURATION, Math.min(slot.holdUntil - slot.time - NOTE_GAP, bar));
  const level = (slot.loud - 1) / 4;
  const share = (range: readonly [number, number]): number => range[0] + (range[1] - range[0]) * level;
  let length: number;
  // A short figure note (funk, reggae) lasts a third of the step to the next note, whatever the loud level.
  if (slot.figure?.short) length = gap / SHORT_SHARE;
  else if (slot.variant) length = gap * share(GROOVE_SHARE);
  else if (slot.part === "ring") length = gap;
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
 * The notes of a phrase variant or a lead-in, with the pitch they land on. A pickup and a run walk to the root of the next bar, a pop is
 * the chord's root an octave up when that fits, and a lead walks to the next section's root.
 */
function variantPitch(chord: ParsedChord, variant: Variant, previous: number, range: Range, home: number | null): Picked {
  // A note that leads to a root lands on the root's place in the home register, which the next bar plays it in.
  const rootOf = (pc: number): number => (home === null ? nearestOctave(pc, previous, range, false) : homeNote(pc, home, range));
  if (variant.kind === "pop") {
    const base = rootOf(chord.bass);
    return { pitch: base + 12 <= range.high ? base + 12 : base, approach: false };
  }
  const root = rootOf(variant.target ?? chord.bass);
  if (variant.kind === "pickup") return { pitch: root, approach: true };
  const note = walkDown(root, variant.offset, fillScale(root, variant.quality, variant.key), variant.chromatic);
  return { pitch: note >= range.low ? note : root, approach: variant.kind === "run" };
}

/**
 * The steps that can sound, in time order, for every bar with bass on. A bar belongs to the plan covering its first beat. The pickup is
 * silent, the last bar of the song is one held note on its downbeat, and a rest part plays nothing. With `feel`, the rhythm follows the
 * accents unless the bass locks to the kick, a stop is silent, and a hit beat always gets a note. A phrase closes with a variation in its
 * last bar, and a section that changes to another one leads into it in the second half of its last bar.
 */
function buildSlots(
  grid: BeatGrid,
  harmony: readonly ChordAtBeat[],
  plans: readonly SectionPlan[],
  settings: BandSettings,
  kick: readonly NoteEvent[],
  random: Random,
  feel: Feel | undefined,
  seed: number,
  endTime: number | undefined,
  keys: readonly BandKey[],
): Slot[] {
  const beats = grid.beats;
  const perBar = barBeats(grid);
  const spans = barSpans(grid);
  const starts = spans.map((span) => span.start);
  const planOf = spans.map((span) => planOfBar(plans, beats, span));
  const barsInPlan = new Map<number, number>();
  for (const index of planOf) if (index >= 0) barsInPlan.set(index, (barsInPlan.get(index) ?? 0) + 1);
  // Each plan's occurrence of its name, counted from the first time round. A name that appears twice repeats.
  const nameCount = new Map<string, number>();
  for (const plan of plans) nameCount.set(plan.name, (nameCount.get(plan.name) ?? 0) + 1);
  const seenName = new Map<string, number>();
  const occurrence = plans.map((plan) => {
    const before = seenName.get(plan.name) ?? 0;
    seenName.set(plan.name, before + 1);
    return plan.name === "" ? 0 : before;
  });
  const slots: Slot[] = [];
  const ending = endingBar(grid, plans, settings.ending, endTime);
  const shape = ending >= 0 ? endingShape(grid, ending, settings.ending) : null;
  const chordAt = (beat: number): ParsedChord | null => harmony[beat]?.chord ?? null;
  const nameAt = (beat: number): string | null => chordAt(beat)?.name ?? null;
  // The earlier engine knows nothing of the key, so its fills and approach notes are as they were.
  const keyAt = (time: number): BandKey | null => (settings.engine >= 2 ? (keys.find((key) => time >= key.start && time < key.end) ?? null) : null);

  // The first segment of each section's first time round. A repeat plays the same rhythm and length for its first bars.
  const firstSegment = new Map<string, { rhythm: number; barsLeft: number }>();
  let segment: Segment | null = null;
  let previousBeat = -1;
  let endingSlot: ((time: number, held: number, index: number) => Slot) | null = null;
  let currentPlan = -2;
  let barInPlan = 0;
  let pedalChord: ParsedChord | null = null;
  let phraseRandom = createRandom(0);
  const figureOf = new Map<number, Figure>();

  for (let k = 0; k < starts.length; k++) {
    if (ending >= 0 && k > ending) break;
    const start = starts[k];
    const planIndex = planOf[k];
    if (planIndex !== currentPlan) {
      currentPlan = planIndex;
      barInPlan = 0;
      // A pedal holds the chord the section starts on, whatever the chords do after it.
      const first = planIndex >= 0 ? starts[k] : -1;
      pedalChord = first >= 0 ? chordAt(first) : null;
      if (planIndex >= 0) phraseRandom = createRandom(variationSeed(seed, plans[planIndex].name, occurrence[planIndex]));
    } else {
      barInPlan += 1;
    }
    const plan = planIndex >= 0 ? plans[planIndex] : undefined;
    const style = plan && plan.play.bass ? findStyle(plan.style) : undefined;
    if (!plan || !style || plan.bassPart === "rest") {
      segment = null;
      continue;
    }

    // A bar can be shorter or longer than the rest where the song's bar lines move.
    const length = spans[k].beats;
    const end = barEnd(beats, start, length);
    const nextBarBass = chordAt(start + length)?.bass ?? null;
    const makeEnding = (time: number, beat: number, held: number, index: number): Slot => ({
      time,
      beat,
      chord: plan.bassPart === "pedal" ? pedalChord : chordAt(start),
      style,
      plan: planIndex,
      part: plan.bassPart,
      method: methodOf(plan.bassPart, settings.bassMode),
      walking: false,
      loud: plan.loud,
      octave: plan.octave,
      busy: plan.busy,
      slides: plan.slides,
      deadNotes: plan.deadNotes,
      index,
      last: true,
      strong: true,
      downbeat: true,
      locked: false,
      hitOne: false,
      holdUntil: end,
      name: plan.name,
      occurrence: occurrence[planIndex],
      repeats: nameCount.get(plan.name)! > 1,
      forced: false,
      fifth: false,
      role: "root",
      home: null,
      key: keyAt(time),
      ending: true,
      barEnd: time + held,
      nextBarBass,
    });
    if (k === ending) {
      // A note past the grid's end sits on the bar's own first beat as far as the slot's place goes.
      const at = (time: number, held: number, index: number) => makeEnding(time, start, held, index);
      if (shape?.replacesBar) {
        // The unison hits last a bit less than a beat each, and the last note rings.
        const beatLength = beatSpan(beats, start);
        const silent = settings.ending.kind === "hit" && feel?.stops.has(start) === true;
        if (!silent) {
          shape.unison.forEach((time, i) => slots.push(at(time, beatLength * UNISON_SHARE, i)));
          slots.push(at(shape.final, shape.ring, shape.unison.length));
        }
        previousBeat = start;
        continue;
      }
      endingSlot = at;
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
      const repeat: { rhythm: number; barsLeft: number } | undefined = occurrence[planIndex] > 0 ? firstSegment.get(plan.name) : undefined;
      if (repeat) {
        segment = { plan: planIndex, rhythm: repeat.rhythm, barsLeft: repeat.barsLeft };
      } else {
        segment = { plan: planIndex, rhythm: random.int(variations.length), barsLeft: random.pick(VARIATION_BARS) };
        if (occurrence[planIndex] === 0 && plan.name !== "" && !firstSegment.has(plan.name)) {
          firstSegment.set(plan.name, { rhythm: segment.rhythm, barsLeft: segment.barsLeft });
        }
      }
    }
    segment.barsLeft -= 1;

    // Steps are drawn the same way in every mode, so the variation a bar gets does not depend on the mode or on the kick.
    const steps = style.meter.beatsPerBar * style.meter.stepsPerBeat;
    // The bar's own steps: the pattern's steps, cut short or carried on to the bar's length.
    const barSteps = Math.max(1, Math.round(stepsPerGridBeat(style, perBar) * length));
    const points = Array.from({ length: Math.max(steps, barSteps) }, (_, step) => stepAt(beats, style, start, step, perBar, settings.swing));
    const walking = part === "walking" || (part === "groove" && settings.bassMode === "walking" && style.bass.walking);
    const own = ownSteps(part, plan.busy, steps, style.meter.stepsPerBeat, barInPlan);
    const roles = new Map<number, "root" | "fifth">();
    let rhythm: number[];
    if (own) {
      rhythm = own.map((entry) => entry.step);
      for (const entry of own) roles.set(entry.step, entry.role);
    } else {
      rhythm = walking ? quarterSteps(steps, patternBeats(style, perBar)) : variations[segment.rhythm];
    }
    // A style written for another number of beats than the bar has plays the part of its pattern that fits the bar.
    if (!stretchesToBar(style) && style.meter.beatsPerBar !== length)
      rhythm = fitStepsToBar(
        rhythm.map((step) => ({ step })),
        steps,
        style.meter.beatsPerBar,
        length,
      ).map((entry) => entry.step);
    let locked = new Set<number>();
    let figureNotes = new Map<number, BarNote>();
    // A groove or melodic section plays one figure, chosen once for its name (engine 2). The figure takes the place of the style's rhythm.
    const figured = settings.engine >= 2 && !own && !walking && (part === "groove" || part === "melodic");
    if (grooveLike) {
      const kicks = settings.lockToKick ? kick.filter((note) => note.time >= beats[start] - LOCK_WINDOW && note.time < end - LOCK_WINDOW) : [];
      const accent = feel ? feel.profiles[planIndex] : undefined;
      if (figured) {
        let chosen = figureOf.get(planIndex);
        if (!chosen) {
          chosen = chooseFigure(style.bass.figures[plan.busy], part as "groove" | "melodic", seed, plan.name === "" ? `#${planIndex}` : plan.name, isAccented(accent) ? (covered) => rhythmScore(covered, accent.weights) : undefined);
          figureOf.set(planIndex, chosen);
        }
        let notes: BarNote[] = chosen.notes[barInPlan % chosen.bars];
        if (!stretchesToBar(style) && style.meter.beatsPerBar !== length) notes = fitStepsToBar(notes, steps, style.meter.beatsPerBar, length);
        // With the kick locked, every figure note stays: one within a step of a kick moves onto it, and a kick the figure misses gets a root.
        if (kicks.length > 0) notes = lockToKick(notes, kickSteps(kicks, points));
        figureNotes = new Map(notes.map((note) => [note.step, note]));
        rhythm = notes.map((note) => note.step);
        locked = new Set(notes.filter((note) => note.locked).map((note) => note.step));
      } else if (kicks.length > 0) {
        locked = kickSteps(kicks, points);
        rhythm = [...new Set([0, ...locked])].sort((a, b) => a - b);
      } else if (isAccented(accent) && !walking) rhythm = bassRhythmFromAccents(accent.weights, style.meter.stepsPerBeat, perBar);
    }
    // A chord that changes in the middle of a bar is struck there, for every part but the pedal and the walk.
    if (part !== "pedal" && !walking) {
      for (let step = 1; step < barSteps; step++) {
        if (points[step].beat < beats.length && nameAt(points[step].beat) !== nameAt(points[step - 1].beat)) rhythm.push(step);
      }
    }
    if (feel) rhythm = [...rhythm, ...hitSteps(feel, start, perBar, stepsPerGridBeat(style, perBar))];

    // The phrase variations and the lead-in. The lead-in takes the second half of the section's last bar, and the variation a phrase's last bar.
    const quality = chordAt(start)?.quality ?? "major";
    const chromatic = plan.busy >= 4;
    const barKey = keyAt(beats[start]);
    const variants = new Map<number, Variant>();
    const nextPlan = plans[planIndex + 1];
    let leadTarget: number | null = null;
    let leadKey: BandKey | null = null;
    if (
      barInPlan === planBars - 1 &&
      nextPlan &&
      nextPlan.name !== plan.name &&
      plan.fills >= 1 &&
      nextPlan.play.bass &&
      nextPlan.bassPart !== "rest" &&
      !lead
    ) {
      const firstBeat = starts[planOf.indexOf(planIndex + 1)] ?? -1;
      const first = firstBeat >= 0 ? chordAt(firstBeat) : null;
      const quiet = Array.from({ length }, (_, b) => start + b).some((beat) => feel?.stops.has(beat));
      if (first && !quiet) leadTarget = first.bass;
      leadKey = keyAt(beats[firstBeat] ?? beats[start]);
    }
    if (leadTarget !== null) {
      rhythm = rhythm.filter((step) => step < steps / 2);
      for (const note of leadSteps(plan.busy, steps)) variants.set(note.step, { kind: "lead", offset: note.offset, target: leadTarget, quality, chromatic, key: leadKey, plan: planIndex + 1 });
    } else if (!lead && plan.fills > 0 && isPhraseEnd(barInPlan, planBars)) {
      const phrase = Math.floor(barInPlan / phraseBars(planBars));
      const variation = chooseVariation(plan.fills, part, phrase, phraseRandom, plan.pickups);
      if (variation) {
        const change = variationSteps(variation, steps, style.meter.stepsPerBeat, phraseRandom);
        rhythm = rhythm.filter((step) => !change.remove.includes(step));
        for (const note of change.add) {
          const target = note.kind === "pop" ? null : nextBarBass;
          if (note.kind !== "pop" && target === null) continue;
          variants.set(note.step, { kind: note.kind, offset: note.offset, target, quality, chromatic, key: barKey, plan: planIndex });
        }
      }
    }

    const silent = (step: number): boolean => feel?.stops.has(points[step].beat) ?? false;
    const stepList = [...new Set([...rhythm, ...variants.keys()])].filter((step) => step >= 0 && step < barSteps && !silent(step)).sort((a, b) => a - b);
    const holdEnd = (beat: number): number => {
      for (let b = beat + 1; b < start + length && b < beats.length; b++) if (nameAt(b) !== nameAt(beat)) return beats[b];
      return end;
    };
    let offBeat = 0;
    stepList.forEach((step, index) => {
      const point = points[step];
      if (point.beat >= beats.length) return;
      const strong = step === 0 || 2 * step === steps;
      const pedal = part === "pedal";
      const forced = !pedal && previousBeat >= 0 && nameAt(previousBeat) !== nameAt(point.beat);
      if (!strong && !forced) offBeat += 1;
      const hitOne = plan.hitTheOne && barInPlan === 0 && index === 0;
      // A beat with a note set by hand keeps that note: a pedal, a fill or a lead-in into the next section plays around it, not over it.
      const byHand = chordAt(point.beat)?.byHand === true;
      slots.push({
        time: point.time,
        beat: point.beat,
        chord: pedal && !variants.has(step) && !byHand ? pedalChord : chordAt(point.beat),
        style,
        plan: planIndex,
        part,
        method,
        walking,
        loud,
        octave: plan.octave,
        busy: plan.busy,
        slides: plan.slides,
        deadNotes: plan.deadNotes,
        index,
        last: index === stepList.length - 1,
        strong,
        downbeat: step === 0,
        locked: locked.has(step),
        hitOne,
        holdUntil: hitOne ? holdEnd(point.beat) : end,
        name: plan.name,
        occurrence: occurrence[planIndex],
        repeats: nameCount.get(plan.name)! > 1,
        forced,
        fifth: !strong && !forced && offBeat % 2 === 1,
        role: roles.get(step) ?? "root",
        home: null,
        key: keyAt(point.time),
        figure: byHand || variants.has(step) ? undefined : figureNotes.get(step),
        variant: byHand ? undefined : variants.get(step),
        ending: false,
        barEnd: end,
        nextBarBass,
      });
      previousBeat = point.beat;
    });
  }

  // A hold or a slow ending plays on after its bar, which may be past the grid's end: a root on each bar of a slow-down, then the last
  // note, which rings.
  if (shape && endingSlot) {
    const slowing = shape.slowing.filter((beat) => beat.downbeat);
    slowing.forEach((beat, i) => {
      const next = slowing[i + 1]?.time ?? shape.final;
      slots.push(endingSlot!(beat.time, (next - beat.time) * SLOWING_SHARE, i));
    });
    slots.push(endingSlot(shape.final, shape.ring, slowing.length));
  }

  return slots;
}

/**
 * The home note of each section plan: its most common root (by steps), placed at the octave nearest the middle of the range and moved by the
 * section's octave shift. A section with no chords has none. Every root in the section is then the instance of its pitch class nearest this
 * note, so a pitch class keeps its octave through the section instead of drifting with the path the line took.
 */
function homeNotes(slots: readonly Slot[], range: Range): Map<number, number> {
  const counts = new Map<number, Map<number, number>>();
  for (const slot of slots) {
    if (!slot.chord || slot.ending) continue;
    const own = counts.get(slot.plan) ?? new Map<number, number>();
    own.set(slot.chord.bass, (own.get(slot.chord.bass) ?? 0) + 1);
    counts.set(slot.plan, own);
  }
  const homes = new Map<number, number>();
  for (const [plan, own] of counts) {
    let common = -1;
    for (const [pc, count] of own) if (common < 0 || count > own.get(common)!) common = pc;
    const octave = slots.find((slot) => slot.plan === plan)?.octave ?? 0;
    homes.set(plan, homeNote(common, range.centre, range) + 12 * octave);
  }
  return homes;
}

/**
 * Bass notes for the whole song, sorted by time. Rests come from null chords. Each note's octave is picked from the note before it,
 * starting from the middle of the range (engine 1), or from the section's home note (engine 2). Velocities are jittered from the seed.
 * At engine 1 a section's octave shift is applied to all its notes, or to none of them when any would leave the range.
 *
 * The jitter of a main note comes from one stream, so a note added in one bar moves no note in another. A section that repeats its name
 * restarts its own stream each time round, so its notes match its first time round wherever they are not varied. A variant note has
 * its own jitter, seeded by its place.
 */
export function generateBass(
  grid: BeatGrid,
  harmony: readonly ChordAtBeat[],
  plans: readonly SectionPlan[],
  settings: BandSettings,
  kick: readonly NoteEvent[],
  seed: number,
  feel?: Feel,
  endTime?: number,
  keys: readonly BandKey[] = [],
): NoteEvent[] {
  if (grid.beats.length === 0 || plans.length === 0) return [];

  const random = createRandom(seed);
  const slots = buildSlots(grid, harmony, plans, settings, kick, random, feel, seed, endTime, keys);
  const range = BASS_NOTE_RANGES[bassRangeFor(settings, keys).range];
  // Engine 2 keeps each section's roots in one register: its home note (see homeNotes).
  const homes = settings.engine >= 2 ? homeNotes(slots, range) : null;
  for (const slot of slots) slot.home = homes?.get(slot.plan) ?? null;
  let previous = range.centre;
  const streams = new Map<string, { occurrence: number; random: Random }>();
  const jitter = (slot: Slot): number => {
    let source = random;
    if (slot.variant) source = createRandom(variationSeed(seed, "variant", slot.beat * 128 + slot.index));
    else if (slot.repeats) {
      const stream = streams.get(slot.name);
      if (!stream || stream.occurrence !== slot.occurrence) {
        source = createRandom(variationSeed(seed, slot.name, 0));
        streams.set(slot.name, { occurrence: slot.occurrence, random: source });
      } else source = stream.random;
    }
    return source.int(2 * VELOCITY_JITTER + 1) - VELOCITY_JITTER;
  };
  const picked: { slot: Slot; pitch: number; velocity: number; duration: number; time: number }[] = [];

  slots.forEach((slot, i) => {
    if (!slot.chord) return;
    const next = slots[i + 1];
    const chosen = slot.variant ? variantPitch(slot.chord, slot.variant, previous, range, homes ? (homes.get(slot.variant.plan) ?? null) : null) : pitchOf(slot, slot.chord, next, previous, range, settings);
    // A note the performer set by hand (bass-overrides.ts) moves by its octave nudge, on a chord note and not on an approach.
    const approach = chosen.approach;
    const pitch = approach || slot.variant ? chosen.pitch : nudgedPitch(chosen.pitch, slot.chord.bassOctave, range);
    const accent = (slot.downbeat ? DOWNBEAT_ACCENT : 0) + (slot.locked ? KICK_ACCENT : 0) + (approach ? APPROACH_DIP : 0) + (slot.hitOne ? HIT_ONE_ACCENT : 0) + (slot.figure?.accent ? FIGURE_ACCENT : 0);
    const nextTime = next ? next.time : slot.barEnd;
    picked.push({
      slot,
      pitch,
      velocity: clampVelocity(LOUD_VELOCITY[slot.loud] + accent + jitter(slot)),
      duration: noteLength(slot, nextTime, settings.bassFeel),
      time: slot.time,
    });
    // A variant note does not move the voice leading, so the bars after it play as they would without it.
    if (!slot.variant) previous = chosen.root ?? pitch;
  });

  // An octave shift is all or nothing per section: if any of its notes would leave the range, the section keeps its own octave.
  const shifts = new Map<number, number>();
  // Engine 2 has no all-or-nothing shift: the octave is part of the home note, and a note that would leave the range moves on its own.
  for (const octave of homes ? [] : OCTAVE_SHIFTS) {
    if (octave === 0) continue;
    for (const planIndex of new Set(picked.map((entry) => entry.slot.plan))) {
      if (plans[planIndex]?.octave !== octave) continue;
      const own = picked.filter((entry) => entry.slot.plan === planIndex);
      if (own.every((entry) => entry.pitch + 12 * octave >= range.low && entry.pitch + 12 * octave <= range.high)) shifts.set(planIndex, 12 * octave);
    }
  }

  const sorted = picked
    .map((entry) => ({
      slot: entry.slot,
      note: { time: entry.time, pitch: entry.pitch + (shifts.get(entry.slot.plan) ?? 0), velocity: entry.velocity, duration: entry.duration } as NoteEvent,
    }))
    .sort((a, b) => a.note.time - b.note.time || a.note.pitch - b.note.pitch);
  return endBeforeNext(addTechniques(sorted, grid.beats, seed));
}

/** A bass note ends at least this long before the next bass note starts, so two bass notes never sound together in a MIDI file. */
export const BASS_GAP = 0.01;
/** The shortest a note is held to, when the notes given are closer together than the gap allows. */
const CLAMP_FLOOR = 0.005;

/**
 * The notes with each one ended before the next starts: a note longer than the room before the next note is cut to fit, and keeps at
 * least a few milliseconds. Applied after the humanising too, which moves the starts, so no overlap reaches the renderer or the export.
 */
export function endBeforeNext(notes: readonly NoteEvent[]): NoteEvent[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  return sorted.map((note, i) => {
    const next = sorted[i + 1];
    if (!next) return note;
    const room = next.time - BASS_GAP - note.time;
    if (note.duration <= room) return note;
    return { ...note, duration: Math.max(CLAMP_FLOOR, room) };
  });
}

/**
 * The bass techniques of a sorted list of notes: a slide into a downbeat that comes after a rest of half a beat, and a dead note in the
 * empty sixteenth before a note, at busy 3 and up. Each chance is drawn from its own stream, so a technique on or off moves no other note.
 * A dead note takes the note before it and stops that note where it starts.
 */
function addTechniques(sorted: readonly { slot: Slot; note: NoteEvent }[], beats: readonly number[], seed: number): NoteEvent[] {
  const chance = createRandom(variationSeed(seed, "technique", 0));
  const dead: NoteEvent[] = [];
  sorted.forEach(({ slot, note }, i) => {
    const previous = sorted[i - 1]?.note;
    const next = sorted[i + 1]?.note;
    const beat = beatSpan(beats, slot.beat);
    const sixteenth = beat / 4;
    if (slot.slides && slot.downbeat && !slot.variant && !slot.ending && !slot.hitOne) {
      const rest = previous ? note.time - (previous.time + previous.duration) : Infinity;
      if (rest >= beat / 2 && chance.next() < SLIDE_CHANCE) note.slideFrom = SLIDE_SEMITONES;
    }
    if (slot.deadNotes && slot.busy >= DEAD_BUSY_FROM && !slot.variant && next && next.time - note.time >= 2 * sixteenth) {
      if (chance.next() < DEAD_CHANCE) {
        const at = next.time - sixteenth;
        note.duration = Math.min(note.duration, at - note.time);
        dead.push({ time: at, pitch: note.pitch, velocity: DEAD_VELOCITY, duration: DEAD_DURATION, dead: true });
      }
    }
  });
  return [...sorted.map((entry) => entry.note), ...dead].sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
