import { chromaFrames, type ChromaSpan } from "../analysis/chroma";
import { CHORD_STATES, chordNameOf, chordScores } from "../analysis/chord-templates";
import { decodeChords, diatonicStates } from "../analysis/chord-hmm";
import type { PcmAudio } from "../types";
import { keyFromChroma } from "./key";

export interface Chord {
  time: number;
  name: string;
  confidence: number;
}

/**
 * What the chord detector reads. `harmony` carries the chords (guitar, piano and the other stems, or the mix); `bass` is the bass stem
 * when it has a signal; `beats` are the beat times of the song's grid, when one is known, and the chords then change only on beats.
 * `key` is the song's key name (such as "A minor") when one is known; without it the key is estimated from the harmony.
 */
export interface ChordsInput {
  harmony: PcmAudio;
  bass: PcmAudio | null;
  beats: number[] | null;
  key?: string | null;
}

/** Without a beat grid, the chords are read on a fixed hop of this many seconds. */
export const HOP_SECONDS = 0.25;

/**
 * The spans the chords are read over: beat to beat when the song has a grid (with the time before the first beat as one span), else
 * `HOP_SECONDS` steps. Each span's start is the time its chord is given.
 */
export function chordFrameSpans(beats: readonly number[] | null, duration: number): ChromaSpan[] {
  if (beats && beats.length >= 2) {
    const spans: ChromaSpan[] = [];
    if (beats[0] > 0) spans.push({ start: 0, end: beats[0] });
    beats.forEach((start, i) => spans.push({ start, end: i + 1 < beats.length ? beats[i + 1] : duration }));
    return spans.filter((span) => span.end > span.start && span.start < duration);
  }
  const spans: ChromaSpan[] = [];
  for (let start = 0; start < duration; start += HOP_SECONDS) spans.push({ start, end: Math.min(duration, start + HOP_SECONDS) });
  return spans;
}

/**
 * The chords of a song: one state per span (see `chordFrameSpans`), decoded over the whole song so a chord holds across noisy spans and
 * changes where the music changes. The key prior uses the given key, or else the key the harmony estimates when that estimate is strong.
 * Runs of one chord are merged, and each chord is timed at the start of its first span.
 */
export function detectChords(input: ChordsInput): Chord[] {
  const harmony = input.harmony;
  const duration = (harmony.channels[0]?.length ?? 0) / harmony.sampleRate;
  const spans = chordFrameSpans(input.beats, duration);
  if (!spans.length) return [];
  const { treble, bass } = chromaFrames(harmony, spans, input.bass);
  const scores = spans.map((_, i) => chordScores(treble[i], bass ? bass[i] : null));
  const key = input.key ?? estimatedKey(treble);
  const { path, posterior } = decodeChords(scores, diatonicStates(key));
  return runsOf(spans, path, posterior, bass);
}

/** The key the song's harmony points to, when the estimate is strong. Null otherwise, so the key prior is left out. */
function estimatedKey(treble: readonly Float32Array[]): string | null {
  const mean = new Float64Array(12);
  for (const chroma of treble) for (let i = 0; i < 12; i++) mean[i] += chroma[i];
  const estimate = keyFromChroma(mean);
  return estimate?.confidence === "strong" ? estimate.name : null;
}

/** Merges the spans that share a state into chords. A chord is timed at its first span, and its confidence is the mean of its spans. */
function runsOf(spans: readonly ChromaSpan[], path: readonly number[], posterior: readonly number[], bass: readonly Float32Array[] | null): Chord[] {
  const chords: Chord[] = [];
  for (let start = 0; start < path.length; ) {
    let end = start;
    while (end + 1 < path.length && path[end + 1] === path[start]) end++;
    const run = end - start + 1;
    // The slash bass is read from the mean bass chroma of the run, so one stray bass note does not rename the chord.
    let meanBass: Float64Array | null = null;
    if (bass) {
      meanBass = new Float64Array(12);
      for (let t = start; t <= end; t++) for (let i = 0; i < 12; i++) meanBass[i] += bass[t][i] / run;
    }
    const confidence = posterior.slice(start, end + 1).reduce((a, b) => a + b, 0) / run;
    chords.push({ time: spans[start].start, name: chordNameOf(CHORD_STATES[path[start]], meanBass), confidence });
    start = end + 1;
  }
  return chords;
}