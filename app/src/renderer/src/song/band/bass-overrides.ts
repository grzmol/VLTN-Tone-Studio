// Bass notes the performer sets by hand (spec 87). An override says which pitch class the bass plays over a stretch of the song, for a beat, a
// bar, until the next chord change, or one chord everywhere in its section. Everything here is pure: the grid, the harmony and the sections
// come in as values, and the overrides are plain data saved with the band settings.

import type { Section } from "../performance/sections";
import { NOTE_NAMES } from "../analysis/chord-templates";
import { BASS_LINE_CONFIDENT, type BassLineBeat } from "../analysis/bass-line";
import type { BeatGrid } from "./beat-grid";
import type { ChordAtBeat } from "./harmony";

/** The octave nudge of an override: one octave down, none, or one octave up from the note the bass would play. */
export const OVERRIDE_OCTAVES = [-1, 0, 1] as const;
export type OverrideOctave = (typeof OVERRIDE_OCTAVES)[number];

/** A stretch of the song (song seconds, on beats) where the bass plays `pc` (0 C to 11 B). Overrides never overlap. */
export interface BassOverride {
  start: number;
  end: number;
  pc: number;
  octave?: OverrideOctave;
}

/** A song with more overrides than this keeps the first ones only, so a damaged file cannot grow without limit. */
export const MAX_BASS_OVERRIDES = 500;

/** The ways an override can be applied to the song. */
export type OverrideScope = "beat" | "bar" | "untilChange" | "sectionChord";
export const OVERRIDE_SCOPES: readonly OverrideScope[] = ["beat", "bar", "untilChange", "sectionChord"];

/** Where the bass note on a beat comes from, as the strip's popover says it. */
export type NoteSource = "your-note" | "original-bass" | "chords";
export const NOTE_SOURCE_TEXT: Record<NoteSource, string> = {
  "your-note": "Your note",
  "original-bass": "From the original bass",
  chords: "From the chords",
};

const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * Reads saved overrides. Anything that is not an array gives none. An entry is kept only when its times and pitch class are valid, and an
 * entry that overlaps an earlier one (in time order) is dropped, so the result never overlaps.
 */
export function parseBassOverrides(value: unknown): BassOverride[] {
  if (!Array.isArray(value)) return [];
  const valid: BassOverride[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { start, end, pc, octave } = entry;
    if (!isTime(start) || !isTime(end) || end <= start) continue;
    if (typeof pc !== "number" || !Number.isInteger(pc) || pc < 0 || pc > 11) continue;
    if (octave !== undefined && !OVERRIDE_OCTAVES.includes(octave as OverrideOctave)) continue;
    valid.push(octave === undefined ? { start, end, pc } : { start, end, pc, octave: octave as OverrideOctave });
  }
  valid.sort((a, b) => a.start - b.start);
  const kept: BassOverride[] = [];
  for (const entry of valid) {
    const last = kept[kept.length - 1];
    if (last && entry.start < last.end) continue;
    kept.push(entry);
    if (kept.length === MAX_BASS_OVERRIDES) break;
  }
  return kept;
}

/**
 * Sets an override over its stretch. Whatever an existing override held there is cut back to the parts outside it, so a later edit replaces
 * the overlap and nothing else. The result is in time order.
 */
export function setBassOverride(overrides: readonly BassOverride[], next: BassOverride): BassOverride[] {
  const kept: BassOverride[] = [];
  for (const entry of overrides) {
    if (entry.end <= next.start || entry.start >= next.end) {
      kept.push(entry);
      continue;
    }
    if (entry.start < next.start) kept.push({ ...entry, end: next.start });
    if (entry.end > next.end) kept.push({ ...entry, start: next.end });
  }
  kept.push(next);
  return kept.sort((a, b) => a.start - b.start);
}

/** The override covering a time, if any. */
export function bassOverrideAt(overrides: readonly BassOverride[], time: number): BassOverride | undefined {
  return overrides.find((entry) => time >= entry.start && time < entry.end);
}

/** Removes the override covering a time, whole. Reset uses this, so a bar set as one override goes back in one step. */
export function clearBassOverrideAt(overrides: readonly BassOverride[], time: number): BassOverride[] {
  return overrides.filter((entry) => !(time >= entry.start && time < entry.end));
}

/** The pitch class of a chord name's root or slash bass written as text, such as `Bb` or `F#` (or null for an unknown name). */
function accidentalOf(name: string): "flat" | "sharp" | null {
  const match = /^[A-G]([#b])/.exec(name);
  if (!match) return null;
  return match[1] === "#" ? "sharp" : "flat";
}

/**
 * Whether the song's note names are written with flats. The chord names in the harmony decide: flats when more of them are written with a
 * flat root than with a sharp one. A song with neither gets sharps.
 */
export function usesFlats(harmony: readonly ChordAtBeat[]): boolean {
  let flats = 0;
  let sharps = 0;
  for (const entry of harmony) {
    const kind = entry.chord ? accidentalOf(entry.chord.name) : null;
    if (kind === "flat") flats++;
    else if (kind === "sharp") sharps++;
  }
  return flats > sharps;
}

/** The note name of a pitch class, spelled with flats or sharps. */
export function noteNameOf(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : NOTE_NAMES)[((pc % 12) + 12) % 12];
}

/** What a scope covers: the stretches of the song, each one a time range from its start to its end. */
export interface ScopeContext {
  grid: BeatGrid;
  harmony: readonly ChordAtBeat[];
  sections: readonly Section[];
  songEnd: number;
}

/** The time a beat's stretch ends: the next beat, or the song's end for the last one. */
function beatEnd(grid: BeatGrid, beat: number, songEnd: number): number {
  return beat + 1 < grid.beats.length ? grid.beats[beat + 1] : songEnd;
}

/** The beat indices where a bar starts: the grid's own bar starts when it has them, otherwise every bar of beatsPerBar from the downbeat. Beat 0 always starts one. */
function barStarts(grid: BeatGrid): Set<number> {
  const explicit = grid.barStarts ? new Set(grid.barStarts) : null;
  const starts = new Set<number>([0]);
  grid.beats.forEach((_, beat) => {
    const onBar = explicit ? explicit.has(beat) : (((beat - grid.downbeat) % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
    if (onBar) starts.add(beat);
  });
  return starts;
}

/**
 * The stretches one scope covers from a beat. "beat" is the beat's own time. "bar" runs from the bar line before the beat to the next one.
 * "untilChange" runs from the beat to the next beat whose chord differs. "sectionChord" is the run of beats with this beat's chord in each
 * section with this beat's name, so one chorus's chord is set in every chorus. A beat with no chord gets its own beat for any scope.
 */
export function scopeRanges(scope: OverrideScope, beat: number, context: ScopeContext): { start: number; end: number }[] {
  const { grid, harmony, sections, songEnd } = context;
  const beatOnly = () => [{ start: grid.beats[beat], end: beatEnd(grid, beat, songEnd) }];
  if (scope === "beat") return beatOnly();
  const chordName = harmony[beat]?.chord?.name ?? null;
  if (chordName === null) return beatOnly();
  if (scope === "bar") {
    const starts = barStarts(grid);
    let first = beat;
    while (first > 0 && !starts.has(first)) first--;
    let next = beat + 1;
    while (next < grid.beats.length && !starts.has(next)) next++;
    return [{ start: grid.beats[first], end: next < grid.beats.length ? grid.beats[next] : songEnd }];
  }
  if (scope === "untilChange") {
    let next = beat + 1;
    while (next < grid.beats.length && (harmony[next]?.chord?.name ?? null) === chordName) next++;
    return [{ start: grid.beats[beat], end: next < grid.beats.length ? grid.beats[next] : songEnd }];
  }
  const here = sections.find((section) => grid.beats[beat] >= section.start && grid.beats[beat] < section.end);
  const spans = here ? sections.filter((section) => section.name === here.name) : [{ start: 0, end: songEnd }];
  const ranges: { start: number; end: number }[] = [];
  for (const span of spans) {
    let runStart: number | null = null;
    for (let index = 0; index < grid.beats.length; index++) {
      const time = grid.beats[index];
      const matches = time >= span.start && time < span.end && (harmony[index]?.chord?.name ?? null) === chordName;
      if (matches && runStart === null) runStart = index;
      if (!matches && runStart !== null) {
        ranges.push({ start: grid.beats[runStart], end: time });
        runStart = null;
      }
    }
    if (runStart !== null) ranges.push({ start: grid.beats[runStart], end: Math.min(span.end, songEnd) });
  }
  return ranges.length ? ranges : beatOnly();
}

/**
 * Where the bass note on a beat comes from: the performer's override, the original bass (when the setting takes it and the harmony uses
 * the bassist's note), or the chords.
 */
export function noteSourceAt(
  beat: number,
  harmony: readonly ChordAtBeat[],
  overrides: readonly BassOverride[],
  bassLine: readonly BassLineBeat[] | null,
  bassFrom: "original" | "chords",
): NoteSource {
  const entry = harmony[beat];
  if (entry && bassOverrideAt(overrides, entry.time)) return "your-note";
  const reading = bassLine?.[beat];
  if (bassFrom === "original" && reading && reading.pc !== null && reading.confidence >= BASS_LINE_CONFIDENT && entry?.chord?.bass === reading.pc) {
    return "original-bass";
  }
  return "chords";
}

/** The bar a beat is in, counted from 1 at the first bar line. A beat before the first bar line is in bar 1. */
export function barNumberAt(grid: BeatGrid, beat: number): number {
  let count = 0;
  const starts = barStarts(grid);
  for (let index = 0; index <= beat && index < grid.beats.length; index++) if (starts.has(index)) count++;
  return Math.max(1, count);
}

/**
 * The overrides after one apply: the scope's stretches from the beat, each set to `pc` (and the octave nudge, when there is one). A scope
 * covers several stretches for "the chord everywhere in this section", and each one replaces what it overlaps.
 */
export function applyScope(
  overrides: readonly BassOverride[],
  scope: OverrideScope,
  beat: number,
  context: ScopeContext,
  pc: number,
  octave: OverrideOctave = 0,
): BassOverride[] {
  return scopeRanges(scope, beat, context).reduce<BassOverride[]>(
    (list, range) => {
      const next: BassOverride = octave === 0 ? { start: range.start, end: range.end, pc } : { start: range.start, end: range.end, pc, octave };
      return setBassOverride(list, next);
    },
    [...overrides],
  );
}
