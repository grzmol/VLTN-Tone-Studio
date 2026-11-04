// Measures each unit of a song for the section detector: its harmony (chroma), its loudness and whether it has vocals. The units are bars
// when the song has a beat grid, and time frames when it does not. This file does the signal work; the detector in sections.ts only sees
// the numbers. The worker (sections-worker.ts) runs it off the main thread.

import { fft, hann } from "../tonematch/fft";
import { monoSum } from "../band/beat-grid";
import type { PcmAudio } from "../types";
import { detectSections, type DetectedSection, type DetectOptions, type SectionUnit } from "./sections";

/**
 * The vocals count as present in a unit when their level is within this many decibels of the song's loud vocal level (the 90th
 * percentile over its units). Measured against the mix, a vocal stem's leakage counts as vocals; against the song's own vocals it does not.
 */
export const VOCAL_BELOW_LOUD_DB = 15;
/** Length of the FFT the chroma is measured with. About 5 Hz a bin at 44.1 kHz, so semitones near the bottom of the range stay apart. */
const CHROMA_FFT = 8192;
/** The lowest and highest frequencies that count towards the chroma, in Hz. */
const CHROMA_LOW_HZ = 65;
const CHROMA_HIGH_HZ = 2000;

/** What the worker is given: the mix, the stem the harmony is read from, the vocals stem when there is one, the units to measure and,
 * when the song has been analysed for chords, the chords (in time order). */
export interface SectionsInput {
  mix: PcmAudio;
  harmony: PcmAudio;
  vocals: PcmAudio | null;
  spans: ReadonlyArray<{ start: number; end: number }>;
  options: DetectOptions;
  chords?: ReadonlyArray<{ time: number; name: string }>;
  /** The drums and bass stems, when the song has them. They show where the drums stop and the bass drops out. */
  drums?: PcmAudio | null;
  bass?: PcmAudio | null;
}

const NOTE_PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * The pitch-class template of a chord name such as "F#m", "E5", "Bsus4" or "Dmaj7": the root, the third (minor, major, or the suspended
 * note) and the fifth. Names it cannot read give an empty template.
 */
export function chordTemplate(name: string): number[] {
  const template = new Array<number>(12).fill(0);
  const match = /^([A-G])(#|b)?(.*)$/.exec(name.trim());
  if (!match) return template;
  const root = (NOTE_PITCH[match[1]] + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12;
  const quality = match[3];
  let third = 4;
  if (/^m(?!aj)/.test(quality) || quality.startsWith("dim")) third = 3;
  else if (quality.startsWith("sus4")) third = 5;
  else if (quality.startsWith("sus2")) third = 2;
  else if (quality.startsWith("5")) third = -1;
  template[root] = 1;
  if (third >= 0) template[(root + third) % 12] += 0.6;
  template[(root + 7) % 12] += 0.5;
  return template;
}

/** The harmony of a span as the chords sound in it: each chord's template, weighted by how long it sounds in the span. */
export function chordChroma(chords: ReadonlyArray<{ time: number; name: string }>, start: number, end: number): number[] {
  const chroma = new Array<number>(12).fill(0);
  chords.forEach((chord, i) => {
    const until = i + 1 < chords.length ? chords[i + 1].time : Infinity;
    const overlap = Math.min(until, end) - Math.max(chord.time, start);
    if (overlap <= 0) return;
    chordTemplate(chord.name).forEach((value, k) => (chroma[k] += value * overlap));
  });
  return chroma;
}

/** The mean power of the audio between two sample indices, over all its channels. Zero for an empty range. */
export function rmsOf(audio: PcmAudio, from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (const channel of audio.channels) {
    const end = Math.min(to, channel.length);
    for (let i = from; i < end; i++) sum += channel[i] * channel[i];
    count += Math.max(0, end - from);
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * The pitch-class energy of a mono signal between two sample indices, summed over FFT frames of `CHROMA_FFT` samples. Each bin in the
 * chroma band adds its magnitude to the pitch class it is nearest to. The result is not normalised: the detector compares directions.
 */
export function unitChroma(mono: ArrayLike<number>, sampleRate: number, from: number, to: number): number[] {
  const chroma = new Array<number>(12).fill(0);
  const window = hann(CHROMA_FFT);
  const re = new Float64Array(CHROMA_FFT);
  const im = new Float64Array(CHROMA_FFT);
  for (let at = from; at < to; at += CHROMA_FFT) {
    re.fill(0);
    im.fill(0);
    const length = Math.min(CHROMA_FFT, to - at);
    for (let i = 0; i < length; i++) re[i] = (mono[at + i] ?? 0) * window[i];
    fft(re, im);
    for (let k = 1; k < CHROMA_FFT / 2; k++) {
      const hz = (k * sampleRate) / CHROMA_FFT;
      if (hz < CHROMA_LOW_HZ || hz > CHROMA_HIGH_HZ) continue;
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      chroma[((midi % 12) + 12) % 12] += Math.hypot(re[k], im[k]);
    }
  }
  return chroma;
}

/** The level that a percentile of the values reaches (nearest rank). Zero for no values. */
function percentile(values: readonly number[], share: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/**
 * Measures every unit. Loudness is the mix's level over the unit. A unit has vocals when its vocals stem is within `VOCAL_BELOW_LOUD_DB` of
 * the song's loud vocal level. The harmony is the chords when the song has them, and the chroma of the harmony stem otherwise. With no
 * vocals stem, every unit counts as having vocals, so only the repeats and loudness name the sections.
 */
export function measureUnits(input: SectionsInput): SectionUnit[] {
  const { mix, vocals, spans, chords = [], drums = null, bass = null } = input;
  const sampleRate = mix.sampleRate;
  const harmony = monoSum([input.harmony]);
  const levels = spans.map(({ start, end }) => {
    const from = Math.floor(start * sampleRate);
    const to = Math.ceil(end * sampleRate);
    return { from, to, level: rmsOf(mix, from, to), vocal: vocals ? rmsOf(vocals, from, to) : 0 };
  });
  const floor =
    percentile(
      levels.map((l) => l.vocal),
      0.9,
    ) *
    10 ** (-VOCAL_BELOW_LOUD_DB / 20);
  return spans.map(({ start, end }, i) => {
    const { from, to, level, vocal } = levels[i];
    const hasVocals = vocals ? vocal > 0 && vocal >= floor : true;
    const chroma = chords.length ? chordChroma(chords, start, end) : unitChroma(harmony, sampleRate, from, to);
    return {
      start,
      end,
      chroma,
      energy: level,
      vocals: hasVocals,
      vocalEnergy: vocal,
      drumEnergy: drums ? rmsOf(drums, from, to) : undefined,
      bassEnergy: bass ? rmsOf(bass, from, to) : undefined,
    };
  });
}

/** Finds the sections of a song from its measured units. Pure, so the worker is only a thin shell around this. */
export function detectSongSections(input: SectionsInput): DetectedSection[] {
  return detectSections(measureUnits(input), input.options);
}
