// The evidence a song's key is read from (spec 82). The harmony gives a tuning-corrected chroma for each two-second frame (chroma.ts),
// the chords give the pitch classes they sound, weighted by how long each lasts, and the bass gives its own chroma per frame. Three
// profiles are then mixed into one, so the key follows the harmony, the chord names and the bass note together. Pure, so the key worker
// and the tests share it.

import type { Chord } from "../performance/chords";
import type { PcmAudio } from "../types";
import { chromaFrames, type ChromaSpan } from "./chroma";
import { CHORD_TYPES, type ChordType } from "./chord-templates";

/** The frames the key reads the audio in, in seconds. */
export const KEY_FRAME_SECONDS = 2;
/** How much each source counts in the combined profile. A source that is missing drops out and the others are scaled up. */
export const KEY_WEIGHTS = { chroma: 0.5, chords: 0.3, bass: 0.2 } as const;
/** The first and last chord of a window, and the chords that end a section, count this much more for their length. */
export const ANCHOR_WEIGHT = 1.5;
/** A chord ends a section when its end is within this many seconds of a section end. */
const SECTION_END_TOLERANCE = 0.5;
/** The root of a chord counts twice as much as each of its other tones. */
const ROOT_WEIGHT = 2;
const NATURAL_PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type ChordQuality = "major" | "minor" | "other";

/** One chord over a stretch of the song, in seconds. `anchor` marks the first and last chord and the ones that end a section. */
export interface TimedChord {
  start: number;
  end: number;
  root: number;
  quality: ChordQuality;
  tones: readonly number[];
  anchor: boolean;
}

/** A chord's share of a window: how many seconds of the window it fills. */
export interface ChordRun {
  root: number;
  quality: ChordQuality;
  tones: readonly number[];
  seconds: number;
  anchor: boolean;
}

export interface KeyFrame {
  start: number;
  end: number;
  /** The harmony's pitch classes in this frame, summing to 1, or all zero when the frame is silent. */
  treble: Float32Array;
  /** The bass's pitch classes in this frame, or null when the song has no bass. */
  bass: Float32Array | null;
}

/** The audio frames and the timed chords of one song, built once and read over any window with `evidenceIn`. */
export interface KeyFrames {
  frames: KeyFrame[];
  chords: TimedChord[];
}

/** What the key is read from over one window of the song. Each profile sums to 1, or is null when it has nothing in the window. */
export interface KeyEvidence {
  chroma: Float64Array;
  bass: Float64Array | null;
  chordTones: Float64Array | null;
  runs: ChordRun[];
}

/** The root and the chord type of a chord name such as `Em7/B`, or null for `N` and for a name that does not parse. */
export function parseChordRoot(name: string): { root: number; type: ChordType } | null {
  const match = /^([A-G])(#|b)?([^/]*)/.exec(name.trim());
  if (!match) return null;
  const type = CHORD_TYPES.find((candidate) => candidate.suffix === match[3]);
  if (!type) return null;
  const root = (NATURAL_PITCH[match[1]] + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12;
  return { root, type };
}

/** Major for a major third, minor for a minor third, and other for anything else (power, sus, diminished, augmented). */
function qualityOf(type: ChordType): ChordQuality {
  if (type.tones[1] === 4) return "major";
  if (type.tones[1] === 3) return "minor";
  return "other";
}

/** The chords with their end times, skipping the ones that do not parse. A chord ends where the next one starts, or at the song's end. */
function timedChordsOf(chords: readonly Chord[], duration: number, sectionEnds: readonly number[]): TimedChord[] {
  const timed: TimedChord[] = [];
  chords.forEach((chord, i) => {
    const end = i + 1 < chords.length ? chords[i + 1].time : duration;
    const parsed = parseChordRoot(chord.name);
    if (!parsed || !(end > chord.time)) return;
    const endsSection = sectionEnds.some((time) => Math.abs(end - time) <= SECTION_END_TOLERANCE);
    timed.push({
      start: chord.time,
      end,
      root: parsed.root,
      quality: qualityOf(parsed.type),
      tones: parsed.type.tones,
      anchor: i === 0 || i === chords.length - 1 || endsSection,
    });
  });
  return timed;
}

/**
 * The frames of a song, read once: the harmony's chroma and the bass's chroma per two-second frame, and the timed chords. `sectionEnds`
 * are the song's section ends in seconds, so a chord that ends a section counts as an anchor.
 */
export function keyFramesOf(harmony: PcmAudio, bass: PcmAudio | null, chords: readonly Chord[], sectionEnds: readonly number[]): KeyFrames {
  const duration = (harmony.channels[0]?.length ?? 0) / harmony.sampleRate;
  const spans: ChromaSpan[] = [];
  for (let start = 0; start < duration; start += KEY_FRAME_SECONDS) spans.push({ start, end: Math.min(duration, start + KEY_FRAME_SECONDS) });
  const { treble, bass: bassFrames } = chromaFrames(harmony, spans, bass);
  const frames = spans.map((span, i) => ({ start: span.start, end: span.end, treble: treble[i], bass: bassFrames ? bassFrames[i] : null }));
  return { frames, chords: timedChordsOf(chords, duration, sectionEnds) };
}

/** Scales a profile to sum to 1, or returns null when it holds no weight. */
function normalised(values: Float64Array): Float64Array | null {
  const sum = values.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !Number.isFinite(sum)) return null;
  return values.map((v) => v / sum);
}

/**
 * The evidence over the window from `start` to `end` seconds. A frame counts when its middle is in the window. A chord counts for the
 * seconds it shares with the window; the window's first and last chord are anchors too, whatever the song says.
 */
export function evidenceIn(keyFrames: KeyFrames, start: number, end: number): KeyEvidence {
  const chroma = new Float64Array(12),
    bass = new Float64Array(12);
  let weight = 0,
    bassWeight = 0;
  const hasBass = keyFrames.frames.some((frame) => frame.bass);
  for (const frame of keyFrames.frames) {
    const middle = (frame.start + frame.end) / 2;
    if (middle < start || middle >= end) continue;
    const length = frame.end - frame.start;
    weight += length;
    for (let i = 0; i < 12; i++) chroma[i] += length * frame.treble[i];
    if (frame.bass) {
      bassWeight += length;
      for (let i = 0; i < 12; i++) bass[i] += length * frame.bass[i];
    }
  }
  const runs: ChordRun[] = [];
  for (const chord of keyFrames.chords) {
    const seconds = Math.min(chord.end, end) - Math.max(chord.start, start);
    if (seconds > 0) runs.push({ root: chord.root, quality: chord.quality, tones: chord.tones, seconds, anchor: chord.anchor });
  }
  if (runs.length) {
    runs[0].anchor = true;
    runs[runs.length - 1].anchor = true;
  }
  const tones = new Float64Array(12);
  for (const run of runs) {
    const share = run.seconds * (run.anchor ? ANCHOR_WEIGHT : 1);
    for (const interval of run.tones) tones[(run.root + interval) % 12] += share * (interval === 0 ? ROOT_WEIGHT : 1);
  }
  return {
    chroma: (weight ? chroma.map((v) => v / weight) : chroma) as Float64Array,
    bass: hasBass && bassWeight ? normalised(bass) : null,
    chordTones: normalised(tones),
    runs,
  };
}

/**
 * The three profiles mixed by `KEY_WEIGHTS`: each one scaled to sum to 1 first, then weighted, and the weights of the sources that are
 * present scaled to sum to 1. Null when the window has no evidence at all.
 */
export function combinedProfile(evidence: KeyEvidence): Float64Array | null {
  const sources: [Float64Array | null, number][] = [
    [normalised(evidence.chroma), KEY_WEIGHTS.chroma],
    [evidence.chordTones, KEY_WEIGHTS.chords],
    [evidence.bass, KEY_WEIGHTS.bass],
  ];
  const out = new Float64Array(12);
  let total = 0;
  for (const [profile, weight] of sources) {
    if (!profile) continue;
    total += weight;
    for (let i = 0; i < 12; i++) out[i] += weight * profile[i];
  }
  if (!total) return null;
  return out.map((v) => v / total);
}
