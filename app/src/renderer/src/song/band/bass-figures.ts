// Bass figures (spec 134): a rhythm with a degree on each note, one or two bars long. A groove or melodic section plays one figure over and
// over, so its chorus has a shape of its own instead of a root on every strong step. A figure is written as text, one token for each step
// of an even division of the bar: a dot is a rest, a number is the degree (1 root, 5 fifth, 8 octave, 3 third, 7 seventh, 6 sixth), "app"
// is an approach to the next chord's root, a ">" after a degree accents the note and an "s" makes it short. Bars are separated by "|".
// This file chooses a figure and fits it to the kick; bass.ts places its notes. Pure.

import { keyScale, variationSeed, type BandKey } from "./bass-phrases";
import { SEVENTH, THIRD, fifthInterval, pitchClass } from "./chord-tones";
import type { ParsedChord } from "./harmony";
import { createRandom } from "./random";

/** The degree of a figure note: root, fifth, octave, third, seventh (the chord's own, else the key's), sixth, or an approach to the next chord's root. */
export type Degree = "1" | "5" | "8" | "3" | "7" | "6" | "app";

export interface FigureNote {
  /** Step in the bar, counted on the style's step grid from 0 at the downbeat. */
  step: number;
  degree: Degree;
  /** The note is played harder. */
  accent?: boolean;
  /** The note lasts a third of the step to the next note (funk, reggae). */
  short?: boolean;
}

export interface Figure {
  bars: 1 | 2;
  /** The notes of each bar, in step order. */
  notes: FigureNote[][];
}

/** The degrees a groove part may use: a figure with any other degree is for the melodic part. */
const GROOVE_DEGREES: readonly Degree[] = ["1", "5", "8"];

const TOKEN = /^(1|5|8|3|7|6|app)(>)?(s)?$/;

/**
 * A figure from its text. `steps` is the number of steps in the style's bar; each bar must have a token count that divides it, so a token
 * is a whole number of steps. Throws on a token it does not know, which a test of every style catches.
 */
export function figure(steps: number, ...bars: string[]): Figure {
  if (bars.length === 0) throw new RangeError("a figure needs at least one bar");
  if (bars.length > 2) throw new RangeError("a figure is one or two bars");
  const notes = bars.flatMap((text) =>
    text
      .split("|")
      .map((bar) => bar.trim().split(/\s+/))
      .map((tokens) => {
        if (steps % tokens.length !== 0) throw new RangeError(`${tokens.length} tokens do not divide ${steps} steps`);
        const each = steps / tokens.length;
        const bar: FigureNote[] = [];
        tokens.forEach((token, i) => {
          if (token === ".") return;
          const match = TOKEN.exec(token);
          if (!match) throw new RangeError(`"${token}" is not a figure token`);
          const note: FigureNote = { step: i * each, degree: match[1] as Degree };
          if (match[2]) note.accent = true;
          if (match[3]) note.short = true;
          bar.push(note);
        });
        return bar;
      }),
  );
  if (notes.length > 2) throw new RangeError("a figure is one or two bars");
  return { bars: notes.length as 1 | 2, notes };
}

/** Whether every note of the figure is a root, fifth or octave. */
export function isPlain(candidate: Figure): boolean {
  return candidate.notes.every((bar) => bar.every((note) => GROOVE_DEGREES.includes(note.degree)));
}

/** The steps a figure plays in each bar, as sets. */
function stepSets(candidate: Figure): Set<number>[] {
  return candidate.notes.map((bar) => new Set(bar.map((note) => note.step)));
}

/** Scores the steps a bar plays against a section's accents: higher is a better fit (rhythmScore in feel.ts). */
export type StepScore = (covered: ReadonlySet<number>) => number;

/** How well a figure's rhythm fits the accents of a section: the mean score over its bars. */
export function figureScore(candidate: Figure, score: StepScore): number {
  const sets = stepSets(candidate);
  return sets.reduce((sum, covered) => sum + score(covered), 0) / sets.length;
}

/**
 * The figure a section plays, chosen once for its name. A groove draws only from figures of roots, fifths and octaves, a melodic part from
 * all of them. Without clear accents the pick is seeded by the section's name, so a repeat of the name plays the same figure. With them
 * (`score` of a bar's steps against the accents) the best-scoring figure wins and the seeded order breaks ties.
 */
export function chooseFigure(figures: readonly Figure[], part: "groove" | "melodic", seed: number, name: string, score?: StepScore): Figure {
  const plain = figures.filter(isPlain);
  const pool = part === "groove" && plain.length > 0 ? plain : figures;
  const order = pool.map((_, i) => i);
  const random = createRandom(variationSeed(seed, `figure:${name}`, 0));
  // A seeded shuffle gives the tie order, so equal scores do not always pick the first figure.
  for (let i = order.length - 1; i > 0; i--) {
    const j = random.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (!score) return pool[order[0]];
  const scores = pool.map((candidate) => figureScore(candidate, score));
  return pool[order.reduce((best, i) => (scores[i] > scores[best] ? i : best))];
}

/** A figure note as the bar plays it: the step, its degree and whether the kick moved it or added it. */
export interface BarNote extends FigureNote {
  /** The step is one the kick locks the bass to. */
  locked?: boolean;
}

/**
 * The notes of a bar fitted to the kick. Every figure note stays. A figure note within one step of a kick moves onto it, and a kick with
 * no figure note within two steps gets a root. `kicks` are the steps the kick plays on.
 */
export function lockToKick(notes: readonly FigureNote[], kicks: ReadonlySet<number>): BarNote[] {
  const placed: BarNote[] = notes.map((note) => ({ ...note }));
  for (const kick of [...kicks].sort((a, b) => a - b)) {
    const on = placed.find((note) => note.step === kick);
    if (on) {
      on.locked = true;
      continue;
    }
    const near = placed.filter((note) => !note.locked && Math.abs(note.step - kick) === 1).sort((a, b) => a.step - b.step)[0];
    if (near) {
      near.step = kick;
      near.locked = true;
    } else if (!placed.some((note) => Math.abs(note.step - kick) <= 2)) {
      placed.push({ step: kick, degree: "1", locked: true });
    }
  }
  return placed.sort((a, b) => a.step - b.step);
}

/**
 * The pitch class a degree plays on a chord, or null for an approach, which depends on the next chord. A chord with no third or no seventh
 * takes the key's scale note a third or seventh above its root, and the fifth when no key is known.
 */
export function degreePitchClass(degree: Degree, chord: ParsedChord, key: Pick<BandKey, "tonic" | "mode"> | null): number | null {
  const fifth = pitchClass(chord.root + fifthInterval(chord.quality));
  const inKey = (...intervals: number[]): number | null => {
    if (!key) return null;
    const scale = keyScale(key);
    const found = intervals.find((interval) => scale.includes(pitchClass(chord.root + interval)));
    return found === undefined ? null : pitchClass(chord.root + found);
  };
  switch (degree) {
    case "1":
    case "8":
      return chord.bass;
    case "5":
      return fifth;
    case "3": {
      const own = THIRD[chord.quality];
      return own !== null ? pitchClass(chord.root + own) : (inKey(3, 4) ?? fifth);
    }
    case "7": {
      const own = SEVENTH[chord.seventh];
      return own !== null ? pitchClass(chord.root + own) : (inKey(10, 11) ?? fifth);
    }
    case "6":
      return inKey(9, 8) ?? pitchClass(chord.root + 9);
    case "app":
      return null;
  }
}
