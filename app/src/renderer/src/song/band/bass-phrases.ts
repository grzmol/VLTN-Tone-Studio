// Bass phrases (spec 85, stage 3): the variations that close a phrase, and the lead-in that carries a section into the next one. Pure.
// A phrase is four bars, or two when the section is shorter than four. Bars 1 to 3 of a phrase play the part as it is. The last bar may
// vary, and a variation is seeded, so the same song always gives the same one. The notes of a variation are placed on the bar's steps
// by bass.ts; this file decides what they are and where.

import type { Fills } from "./arrangement";
import type { BassPart } from "./bass-parts";
import type { ChordQuality } from "./harmony";
import type { Random } from "./random";

/** Four bars a phrase, or two in a section shorter than four bars. */
export function phraseBars(sectionBars: number): number {
  return sectionBars < 4 ? 2 : 4;
}

/** Whether a bar (counted from the start of its section) closes a phrase: the last bar of a phrase, or the section's last bar. */
export function isPhraseEnd(bar: number, sectionBars: number): boolean {
  const length = phraseBars(sectionBars);
  return bar % length === length - 1 || bar === sectionBars - 1;
}

/** The variation kinds: a pickup of eighths into the next downbeat, an octave pop, an approach run, or an empty last beat. */
export type VariationKind = "pickup" | "pop" | "run" | "empty";

export interface Variation {
  kind: VariationKind;
  /** The notes the variation adds: eighths for a pickup, notes for a run. Unused for a pop and an empty beat. */
  count: number;
}

/**
 * The variation a phrase plays, or null. Fills 0 never varies. Fills 1 varies every second phrase, with one or two notes. Fills 2 varies
 * every phrase with two or three, and fills 3 with one to four. A ring or a pedal only pickups or empties its last beat at fills 1 or
 * less, so it keeps its single held character.
 */
export function chooseVariation(fills: Fills, part: BassPart, phrase: number, random: Random, pickups = true): Variation | null {
  if (fills === 0) return null;
  if (fills === 1 && phrase % 2 === 0) return null;
  const [low, high] = fills === 1 ? [1, 2] : fills === 2 ? [2, 3] : [1, 4];
  const sized: VariationKind[] = (part === "ring" || part === "pedal") && fills <= 1 ? ["pickup", "empty"] : ["pickup", "pop", "run", "empty"];
  // A section with pickups off plays the other kinds instead, so a phrase still varies.
  const kinds = pickups ? sized : sized.filter((kind) => kind !== "pickup");
  const kind = random.pick(kinds);
  return { kind, count: low + random.int(high - low + 1) };
}

/** A note a variation adds to the bar. `offset` counts the scale steps below the target note (0 is the target itself). */
export interface VariantNote {
  step: number;
  kind: "pickup" | "pop" | "run" | "lead";
  offset: number;
}

/** The steps a variation changes in one bar: steps it takes away from the part, and notes it adds. */
export interface VariationSteps {
  remove: number[];
  add: VariantNote[];
}

/**
 * The steps of a variation in a bar of `steps` steps, `stepsPerBeat` to the beat. A pickup is one or two eighths before the bar's end
 * (into the next downbeat). A pop is one note on beat 3 or beat 4. A run is two to four eighths that walk into the next root. An empty
 * variation removes the last beat's steps.
 */
export function variationSteps(variation: Variation, steps: number, stepsPerBeat: number, random: Random): VariationSteps {
  const eighth = Math.max(1, Math.round(stepsPerBeat / 2));
  const lastBeat = steps - stepsPerBeat;
  switch (variation.kind) {
    case "pickup": {
      const count = Math.min(variation.count, 2);
      const at = Array.from({ length: count }, (_, k) => steps - (k + 1) * eighth);
      return { remove: at, add: at.map((step) => ({ step, kind: "pickup", offset: 0 })) };
    }
    case "pop": {
      const step = random.int(2) === 0 ? steps / 2 : lastBeat;
      return { remove: [step], add: [{ step, kind: "pop", offset: 0 }] };
    }
    case "run": {
      const count = Math.min(Math.max(variation.count, 2), 4);
      const at = Array.from({ length: count }, (_, k) => steps - (count - k) * eighth);
      return { remove: at, add: at.map((step, k) => ({ step, kind: "run", offset: count - k })) };
    }
    case "empty":
      return { remove: Array.from({ length: stepsPerBeat }, (_, k) => lastBeat + k), add: [] };
  }
}

/**
 * The lead-in of a section into the next: `busy` notes (one to four) in the second half of the bar. The last note lands on the next
 * section's first root (offset 0), and the ones before walk up to it.
 */
export function leadSteps(busy: number, steps: number): VariantNote[] {
  const count = Math.min(4, Math.max(1, busy));
  const half = steps / 2;
  return Array.from({ length: count }, (_, k) => ({
    step: Math.round(half + (k * half) / count),
    kind: "lead" as const,
    offset: count - 1 - k,
  }));
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** A song key as the bass reads it: the span of the song it covers, in seconds, its tonic as a pitch class, and its mode. */
export interface BandKey {
  start: number;
  end: number;
  tonic: number;
  mode: "major" | "minor";
}

const pitchClassOf = (note: number): number => ((note % 12) + 12) % 12;

/** The pitch classes of a key's scale: the major scale, or the natural minor. */
export function keyScale(key: Pick<BandKey, "tonic" | "mode">): number[] {
  return (key.mode === "minor" ? MINOR : MAJOR).map((step) => pitchClassOf(key.tonic + step));
}

/** The pitch classes of the scale a chord's quality suggests, counted from the chord's root as the tonic: minor for a minor or diminished chord. */
export function chordScale(root: number, quality: ChordQuality): number[] {
  return (quality === "minor" || quality === "dim" ? MINOR : MAJOR).map((step) => pitchClassOf(root + step));
}

/**
 * The scale a fill into a note walks: the song's key when the note is in it, otherwise the scale of the chord's quality (a chord outside
 * the key is borrowed, and has no place in the key's scale). With no key it is always the chord's scale.
 */
export function fillScale(target: number, quality: ChordQuality, key: Pick<BandKey, "tonic" | "mode"> | null): number[] {
  if (key) {
    const scale = keyScale(key);
    if (scale.includes(pitchClassOf(target))) return scale;
  }
  return chordScale(target, quality);
}

/**
 * The note `offset` scale steps below `target` (a MIDI note), in the scale given as pitch classes. Chromatic walks by semitones instead,
 * at busy 4 and up, which leaves the key on purpose.
 */
export function walkDown(target: number, offset: number, scale: readonly number[], chromatic: boolean): number {
  if (offset <= 0) return target;
  if (chromatic) return target - offset;
  let note = target;
  for (let k = 0; k < offset; k++) {
    note -= 1;
    while (!scale.includes(pitchClassOf(note))) note -= 1;
  }
  return note;
}

/** The note a scale step below or above `target`, in the scale given as pitch classes. */
export function scaleNeighbours(target: number, scale: readonly number[]): [number, number] {
  let below = target - 1;
  while (!scale.includes(pitchClassOf(below))) below -= 1;
  let above = target + 1;
  while (!scale.includes(pitchClassOf(above))) above += 1;
  return [below, above];
}

/**
 * The seed of a stream for one section occurrence. Each section name and occurrence gets its own stream, so a repeated section's
 * variations differ from its first time, and a song regenerates the same way.
 */
export function variationSeed(seed: number, name: string, occurrence: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
  return (hash + Math.imul(occurrence + 1, 2654435761)) >>> 0;
}
