// Pitch-class (chroma) measurements for the chord and key analysis. A span of audio becomes twelve numbers, one per pitch class, so the
// chord and key estimators compare the same kind of value. The steps are: a Hann window of the span, a large FFT, a log-frequency view
// with 36 bins to the octave (three per semitone), a log-compressed level with the local floor taken off, and a fold onto the twelve
// pitch classes after the song's tuning is corrected. Everything here is pure, so the worker and the tests share it.

import { fft, hann } from "../tonematch/fft";
import type { PcmAudio } from "../types";

/** A stretch of audio to measure, in seconds of the audio it is read from. */
export interface ChromaSpan {
  start: number;
  end: number;
}

export interface ChromaFrames {
  /** One chroma vector per span, pitch class 0 (C) to 11 (B). Each sums to 1, or is all zero when the span is silent. */
  treble: Float32Array[];
  /** One bass chroma vector per span, or null when no bass audio was given. */
  bass: Float32Array[] | null;
  /** The song's tuning relative to A440, in cents, clamped to −50 to +50. Zero when no clear tuning was found. */
  tuningCents: number;
}

/** The longest window the chroma reads, in samples. Longer spans are read through their middle. */
export const CHROMA_FFT = 16384;
/** Shorter spans are read through a window this long, centred on the span, so a fast beat still has enough resolution. */
const MIN_WINDOW_SECONDS = 0.4;
const LOG_LOW_HZ = 40;
const LOG_HIGH_HZ = 2000;
const BINS_PER_OCTAVE = 36;
const LOG_BINS = Math.floor(BINS_PER_OCTAVE * Math.log2(LOG_HIGH_HZ / LOG_LOW_HZ)) + 1;
/** The treble chroma reads the harmony in this band; the bass chroma reads the bass audio in its own band. */
const TREBLE_HZ = { low: 110, high: 2000 };
const BASS_HZ = { low: 40, high: 250 };
/** Log compression: a sine of amplitude A reads log(1 + LOG_GAIN · A). Small sines still show, loud ones do not swamp the rest. */
const LOG_GAIN = 100;
/** The local floor is the median over this many bins either side (six bins is a third of an octave). */
const FLOOR_HALF_WIDTH = 6;
/** Spans quieter than this RMS are silent, so their noise does not become a chord. */
const SILENT_RMS = 1e-4;
/** The tuning is read from at most this many spans, spread evenly over the song. */
const TUNING_SPANS = 96;
/** The tuning is only used when the peaks agree on it: a mean-vector length of at least this. */
const TUNING_MIN_AGREEMENT = 0.3;

const windows = new Map<number, Float64Array>();
const scratch = new Map<number, { re: Float64Array; im: Float64Array }>();

function windowOf(size: number): Float64Array {
  let w = windows.get(size);
  if (!w) {
    w = hann(size);
    windows.set(size, w);
  }
  return w;
}

function buffersOf(): { re: Float64Array; im: Float64Array } {
  let buffers = scratch.get(CHROMA_FFT);
  if (!buffers) {
    buffers = { re: new Float64Array(CHROMA_FFT), im: new Float64Array(CHROMA_FFT) };
    scratch.set(CHROMA_FFT, buffers);
  }
  return buffers;
}

/** Frequency in Hz of log bin `j`. */
const logHz = (j: number) => LOG_LOW_HZ * 2 ** (j / BINS_PER_OCTAVE);

/** Which samples a span reads: a window centred on the span, at least `MIN_WINDOW_SECONDS` long and at most `CHROMA_FFT` samples. */
export function windowFor(span: ChromaSpan, sampleRate: number, length: number): { from: number; size: number } | null {
  if (length <= 0 || !(span.end > span.start) || !(sampleRate > 0)) return null;
  const size = Math.min(CHROMA_FFT, length, Math.round(Math.max(span.end - span.start, MIN_WINDOW_SECONDS) * sampleRate));
  const centre = Math.round(((span.start + span.end) / 2) * sampleRate);
  const from = Math.max(0, Math.min(Math.round(centre - size / 2), length - size));
  return { from, size };
}

/** The channel with the most energy in the window. Summing opposite-phase channels can cancel a part, so the loudest is read alone. */
function loudestChannel(audio: PcmAudio, from: number, size: number): Float32Array {
  let best = audio.channels[0],
    loudest = -1;
  for (const channel of audio.channels) {
    let energy = 0;
    for (let i = from; i < Math.min(channel.length, from + size); i++) energy += channel[i] * channel[i];
    if (energy > loudest) {
      loudest = energy;
      best = channel;
    }
  }
  return best;
}

/** The FFT of a windowed span, left in the scratch buffers. Returns false when the span is silent. */
function transform(audio: PcmAudio, from: number, size: number): boolean {
  const channel = loudestChannel(audio, from, size);
  let energy = 0;
  for (let i = from; i < Math.min(channel.length, from + size); i++) energy += channel[i] * channel[i];
  if (Math.sqrt(energy / size) < SILENT_RMS) return false;
  const { re, im } = buffersOf();
  const window = windowOf(size);
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < size; i++) re[i] = (channel[from + i] ?? 0) * window[i];
  fft(re, im);
  return true;
}

/**
 * The log-frequency level of the span, after the floor is taken off. Each log bin takes the strongest of two readings. The first reads the
 * FFT at the bin's own frequency, by linear interpolation between the two FFT bins either side. The second shares every FFT bin between the
 * two log bins either side of it, with triangular weights in log frequency. The second matters above a few hundred hertz, where a log bin
 * is wider than an FFT bin is apart: a peak that falls between the two sampled points would otherwise vanish. Returns null for silence.
 */
function logLevels(audio: PcmAudio, span: ChromaSpan): Float64Array | null {
  const sampleRate = audio.sampleRate;
  const length = audio.channels[0]?.length ?? 0;
  const at = windowFor(span, sampleRate, length);
  if (!at || !transform(audio, at.from, at.size)) return null;
  const { re, im } = buffersOf();
  // A Hann window of `size` samples gives a sine of amplitude A a peak of A · size / 4, so this scale reads the amplitude back.
  const scale = 4 / at.size;
  const amplitude = (k: number) => Math.hypot(re[k], im[k]) * scale;
  const magnitude = new Float64Array(LOG_BINS);
  for (let j = 0; j < LOG_BINS; j++) {
    const bin = (logHz(j) * CHROMA_FFT) / sampleRate;
    const k = Math.floor(bin),
      frac = bin - k;
    if (k < 1 || k + 1 >= CHROMA_FFT / 2) continue;
    magnitude[j] = amplitude(k) * (1 - frac) + amplitude(k + 1) * frac;
  }
  for (let k = 1; k < CHROMA_FFT / 2; k++) {
    const hz = (k * sampleRate) / CHROMA_FFT;
    if (hz < LOG_LOW_HZ || hz >= LOG_HIGH_HZ) continue;
    const x = BINS_PER_OCTAVE * Math.log2(hz / LOG_LOW_HZ);
    const j = Math.floor(x),
      frac = x - j;
    const value = amplitude(k);
    magnitude[j] = Math.max(magnitude[j], value * (1 - frac));
    if (j + 1 < LOG_BINS) magnitude[j + 1] = Math.max(magnitude[j + 1], value * frac);
  }
  const raw = new Float64Array(LOG_BINS);
  for (let j = 0; j < LOG_BINS; j++) raw[j] = Math.log(1 + LOG_GAIN * magnitude[j]);
  return subtractFloor(raw);
}

/** Subtracts the local median (a third of an octave either side) from each bin, so a broad noise floor does not read as notes. */
function subtractFloor(levels: Float64Array): Float64Array {
  const out = new Float64Array(levels.length);
  const neighbourhood: number[] = [];
  for (let j = 0; j < levels.length; j++) {
    neighbourhood.length = 0;
    for (let k = Math.max(0, j - FLOOR_HALF_WIDTH); k <= Math.min(levels.length - 1, j + FLOOR_HALF_WIDTH); k++) neighbourhood.push(levels[k]);
    neighbourhood.sort((a, b) => a - b);
    const median = neighbourhood[neighbourhood.length >> 1];
    out[j] = Math.max(0, levels[j] - median);
  }
  return out;
}

/**
 * Folds the log levels inside `band` onto the twelve pitch classes, after removing the tuning offset (in semitones). A bin between two
 * semitones is shared between them, with its weight falling off linearly, so a note a little off the grid still lands on its pitch class.
 */
function fold(levels: Float64Array, band: { low: number; high: number }, tuningSemitones: number): Float64Array {
  const chroma = new Float64Array(12);
  for (let j = 0; j < levels.length; j++) {
    const hz = logHz(j);
    if (hz < band.low || hz > band.high) continue;
    const position = 69 + 12 * Math.log2(hz / 440) - tuningSemitones;
    const nearest = Math.round(position);
    const weight = 1 - 2 * Math.abs(position - nearest);
    chroma[((nearest % 12) + 12) % 12] += levels[j] * weight;
  }
  return chroma;
}

/** The chroma of one span, normalised to a sum of 1. Zero when the span is silent. */
function chromaOf(levels: Float64Array | null, band: { low: number; high: number }, tuningSemitones: number): Float32Array {
  const out = new Float32Array(12);
  if (!levels) return out;
  const folded = fold(levels, band, tuningSemitones);
  const total = folded.reduce((a, b) => a + b, 0);
  if (total > 0) for (let i = 0; i < 12; i++) out[i] = folded[i] / total;
  return out;
}

/** Evenly spread spans, at most `TUNING_SPANS` of them, so the tuning reflects the whole song. */
function sampleSpans(spans: readonly ChromaSpan[]): ChromaSpan[] {
  if (spans.length <= TUNING_SPANS) return [...spans];
  return Array.from({ length: TUNING_SPANS }, (_, i) => spans[Math.floor((i * spans.length) / TUNING_SPANS)]);
}

/**
 * The song's tuning from the strongest partials between 110 Hz and 2 kHz. Each peak's distance from the semitone grid is averaged as an
 * angle, so peaks on either side of the grid cancel instead of pulling the estimate. A weak or scattered agreement gives zero.
 */
export function estimateTuningCents(audio: PcmAudio, spans: readonly ChromaSpan[]): number {
  const sampleRate = audio.sampleRate;
  const length = audio.channels[0]?.length ?? 0;
  let sumRe = 0,
    sumIm = 0,
    total = 0;
  for (const span of sampleSpans(spans)) {
    const at = windowFor(span, sampleRate, length);
    if (!at || !transform(audio, at.from, at.size)) continue;
    const { re, im } = buffersOf();
    const low = Math.ceil((TREBLE_HZ.low * CHROMA_FFT) / sampleRate),
      high = Math.floor((TREBLE_HZ.high * CHROMA_FFT) / sampleRate);
    const magnitude = new Float64Array(high + 2);
    let peak = 0;
    for (let k = low - 1; k <= high + 1; k++) {
      magnitude[k] = Math.hypot(re[k], im[k]);
      peak = Math.max(peak, magnitude[k]);
    }
    for (let k = low; k <= high; k++) {
      const m = magnitude[k];
      if (m < 0.1 * peak || m < magnitude[k - 1] || m <= magnitude[k + 1]) continue;
      // Parabolic interpolation of the log magnitude gives the peak's true frequency, finer than one FFT bin.
      const a = Math.log(magnitude[k - 1] + 1e-12),
        b = Math.log(m + 1e-12),
        c = Math.log(magnitude[k + 1] + 1e-12);
      const offset = (0.5 * (a - c)) / (a - 2 * b + c);
      const hz = ((k + offset) * sampleRate) / CHROMA_FFT;
      const deviation = 69 + 12 * Math.log2(hz / 440);
      const distance = (deviation - Math.round(deviation)) * 2 * Math.PI;
      sumRe += m * Math.cos(distance);
      sumIm += m * Math.sin(distance);
      total += m;
    }
  }
  if (!total || Math.hypot(sumRe, sumIm) / total < TUNING_MIN_AGREEMENT) return 0;
  const semitones = Math.atan2(sumIm, sumRe) / (2 * Math.PI);
  return Math.max(-50, Math.min(50, Math.round(semitones * 100)));
}

/**
 * The chroma of each span. `harmony` is read for the treble chroma (110 Hz to 2 kHz); `bass`, when given, is read for the bass chroma
 * (40 to 250 Hz). Both use the tuning found in `harmony`. Spans are in seconds, so the caller decides the timing (beats, or a fixed hop).
 */
export function chromaFrames(harmony: PcmAudio, spans: readonly ChromaSpan[], bass: PcmAudio | null = null): ChromaFrames {
  const tuningCents = estimateTuningCents(harmony, spans);
  const tuning = tuningCents / 100;
  const treble = spans.map((span) => chromaOf(logLevels(harmony, span), TREBLE_HZ, tuning));
  const bassChroma = bass ? spans.map((span) => chromaOf(logLevels(bass, span), BASS_HZ, tuning)) : null;
  return { treble, bass: bassChroma, tuningCents };
}
