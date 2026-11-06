import { SimpleFilter, SoundTouch } from "soundtouchjs";
import { clampCents, clampRate, clampSemitones, pitchRatio } from "../performance/speed";
import type { PcmAudio } from "../types";

// Offline time-stretch and pitch shift for one stem (pure). A song at rate `r` plays one song second in 1 / r seconds, so the
// stretched stem has `stretchedLength(frames, r)` frames, and its pitch moves by semitones and cents without changing its length.
// The whole stem is rendered once, before it plays, so playback itself does no DSP and cannot run out of CPU mid-song.
//
// The engine is SoundTouch (soundtouchjs, LGPL-2.1), which is WSOLA-based. Its output runs a little off song time: a fixed start-up
// delay, plus a drift that grows with the song's length. Both are systematic, so they are measured once per setting and removed
// (see `alignment`). What is left is each transient's own WSOLA jitter, which is not removed; see the Status in the spec for the
// measured numbers.

/** WSOLA window lengths. Shorter windows track transients more closely, at some cost to low notes. */
const SEQUENCE_MS = 30;
const SEEK_MS = 6;

/** The calibration click train: bursts every second over a low noise bed, with a fixed seed so every render measures the same */
const CAL_SECONDS = 12;
const CAL_SEED = 999;
const BURST_FRAMES = 200;
const SEARCH_S = 0.25;
const MIN_MATCH = 0.4;

const BLOCK_FRAMES = 4096;

/** Output frames for `frames` input frames played at `rate`. */
export function stretchedLength(frames: number, rate: number): number {
  return Math.round(frames / clampRate(rate));
}

export interface StretchSettings {
  /** Playback rate, 0.5 to 1.5 (see speed.ts) */
  rate: number;
  /** Whole semitones to shift the pitch by */
  semitones: number;
  /** Fine tune in cents, added to the semitones */
  cents: number;
}

/**
 * How far the engine's output runs from song time for one setting: an output sample at song time `t` is `a + b * t` seconds away from
 * where it should be. `a` is the start-up delay and `b` the drift.
 */
export interface Alignment {
  a: number;
  b: number;
}

const NO_ALIGNMENT: Alignment = { a: 0, b: 0 };
const alignments = new Map<string, Alignment>();

/** A raw SoundTouch pass over stereo input, from the start of the input, giving `length` output frames. */
function engine(left: Float32Array, right: Float32Array, sampleRate: number, settings: StretchSettings, length: number): [Float32Array, Float32Array] {
  const frames = left.length;
  const source = {
    extract(target: Float32Array, numFrames: number, position: number): number {
      for (let i = 0; i < numFrames; i++) {
        const at = position + i;
        target[i * 2] = at < frames ? left[at] : 0;
        target[i * 2 + 1] = at < frames ? right[at] : 0;
      }
      return numFrames;
    },
  };
  const shifter = new SoundTouch();
  shifter.stretch.setParameters(sampleRate, SEQUENCE_MS, SEEK_MS, 0);
  shifter.tempo = clampRate(settings.rate);
  shifter.pitch = pitchRatio(clampSemitones(settings.semitones), clampCents(settings.cents));
  const filter = new SimpleFilter(source, shifter);
  const out: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const block = new Float32Array(BLOCK_FRAMES * 2);
  for (let done = 0; done < length; ) {
    const got = filter.extract(block, Math.min(BLOCK_FRAMES, length - done));
    if (!got) break;
    for (let i = 0; i < got; i++) {
      out[0][done + i] = block[i * 2];
      out[1][done + i] = block[i * 2 + 1];
    }
    done += got;
  }
  return out;
}

/** A click train over low noise: a burst every second, with the bursts' times in song seconds. */
function calibrationTrain(sampleRate: number): { signal: Float32Array; bursts: number[] } {
  const frames = Math.round(CAL_SECONDS * sampleRate);
  const signal = new Float32Array(frames);
  let seed = CAL_SEED;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < frames; i++) signal[i] = 0.02 * random();
  const bursts: number[] = [];
  for (let t = 0.5; t < CAL_SECONDS - 0.5; t += 1) {
    const start = Math.round(t * sampleRate);
    bursts.push(start);
    for (let i = 0; i < BURST_FRAMES; i++) signal[start + i] += 0.8 * random() * Math.exp(-i / 40);
  }
  return { signal, bursts };
}

/**
 * Measures how the engine's output runs from song time for `settings`, by rendering a click train with the same settings and matching
 * each burst in the output. The fit is a straight line through the matched bursts. Bursts that do not match are left out. Cached per
 * sample rate and setting, so the stems of a song share one measurement.
 */
export function alignment(settings: StretchSettings, sampleRate: number): Alignment {
  const key = [sampleRate, clampRate(settings.rate), clampSemitones(settings.semitones), clampCents(settings.cents)].join("|");
  const cached = alignments.get(key);
  if (cached) return cached;
  const { signal, bursts } = calibrationTrain(sampleRate);
  const [out] = engine(signal, signal, sampleRate, settings, stretchedLength(signal.length, settings.rate));
  const template = signal.subarray(bursts[2], bursts[2] + BURST_FRAMES);
  const search = Math.round(SEARCH_S * sampleRate);
  const points: { t: number; d: number }[] = [];
  for (const start of bursts.slice(1, -1)) {
    const expected = Math.round(start / clampRate(settings.rate));
    let best = -Infinity,
      at = expected;
    for (let k = Math.max(0, expected - search); k < Math.min(out.length - BURST_FRAMES, expected + search); k++) {
      let c = 0;
      for (let i = 0; i < BURST_FRAMES; i++) c += out[k + i] * template[i];
      if (c > best) {
        best = c;
        at = k;
      }
    }
    if (best > MIN_MATCH) points.push({ t: start / sampleRate, d: (at - expected) / sampleRate });
  }
  const result = points.length < 3 ? NO_ALIGNMENT : fit(points);
  if (alignments.size > 16) alignments.clear();
  alignments.set(key, result);
  return result;
}

/** Least-squares line through (t, d) */
function fit(points: { t: number; d: number }[]): Alignment {
  const n = points.length;
  const meanT = points.reduce((sum, p) => sum + p.t, 0) / n,
    meanD = points.reduce((sum, p) => sum + p.d, 0) / n;
  let spread = 0,
    cross = 0;
  for (const p of points) {
    spread += (p.t - meanT) ** 2;
    cross += (p.t - meanT) * (p.d - meanD);
  }
  const b = cross / spread;
  return { a: meanD - b * meanT, b };
}

/**
 * Renders one stem at `settings`. Mono stays mono; stereo keeps both channels. The engine's output is read back at the position where
 * each sample of song time belongs, so the transients land on song time; the output is then cut to `stretchedLength` frames. Silence
 * after the end of the input is fed through the engine so its last samples come out.
 */
export function stretchPcm(pcm: PcmAudio, settings: StretchSettings): PcmAudio {
  const rate = clampRate(settings.rate);
  const input = pcm.channels;
  const frames = input[0].length;
  const sampleRate = pcm.sampleRate;
  const length = stretchedLength(frames, rate);
  const shift = frames ? alignment({ ...settings, rate }, sampleRate) : NO_ALIGNMENT;
  // The read-back reaches up to the largest shift in either direction, so the raw output is padded by that much.
  const songSeconds = frames / sampleRate;
  const reach = Math.max(Math.abs(shift.a), Math.abs(shift.a + shift.b * songSeconds));
  const padded = length + Math.ceil(reach * sampleRate) + 64;
  const [left, right] = engine(input[0], input[1] ?? input[0], sampleRate, { ...settings, rate }, padded);
  const out = [new Float32Array(length), new Float32Array(length)];
  for (let c = 0; c < 2; c++) {
    const source = c === 0 ? left : right;
    for (let v = 0; v < length; v++) {
      // Output sample v is song time v * rate; the engine's copy of that sits `shift` seconds away.
      const at = v + (shift.a + shift.b * ((v * rate) / sampleRate)) * sampleRate;
      if (at < 0 || at >= padded - 1) continue;
      const i = Math.floor(at),
        f = at - i;
      out[c][v] = source[i] * (1 - f) + source[i + 1] * f;
    }
  }
  return { sampleRate, channels: input.length > 1 ? out : [out[0]] };
}
