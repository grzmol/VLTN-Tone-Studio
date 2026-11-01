// Reads the bass note the song's bass stem plays on each beat (spec 86). For every beat, the stem is cut into a few short frames after the
// attack, each frame is pitch-tracked with YIN, and the beat takes the pitch class most frames agree on. Pure: the beats and the stem come
// in as values, and the result is plain data, so the analysis worker and the tests run the same code.

import type { PcmAudio } from "../types";

/** The bass note of one beat: a pitch class (0 is C) or null when the stem is quiet or no pitch is clear, and how sure the reading is. */
export interface BassLineBeat {
  /** Index into the beat grid. */
  beat: number;
  pc: number | null;
  /** From 0 to 1: the share of the beat's frames that agree on the note, after smoothing. */
  confidence: number;
}

/** A bass note is used for the generated bass only at or above this confidence. Below it the chord's own bass is kept. */
export const BASS_LINE_CONFIDENT = 0.6;

/** The first part of each beat is skipped, since the pluck of the attack is not a pitch. */
const ATTACK_SECONDS = 0.05;
/** The last part of each beat is skipped, so the next note's attack is not read as this one's pitch. */
const END_MARGIN_SECONDS = 0.02;
/** The bass is read at this rate. Bass fundamentals are below 260 Hz, so 11 kHz is far above what the pitch needs. */
const ANALYSIS_RATE = 11025;
/** The frame length, in samples at the analysis rate: about 372 ms. Shorter frames read the lowest notes of a bass less reliably. */
const FRAME_SAMPLES = 4096;
/** A beat shorter than this, after the attack, has too little signal to read. */
const MIN_WINDOW_SAMPLES = 768;
/** The frames a beat is cut into. Three gives a median-like vote without reading the whole beat. */
const FRAMES_PER_BEAT = 3;
/** The lowest and highest pitches read: the bottom string of a five-string bass to above the top of a bass guitar's range. */
const LOW_HZ = 35;
const HIGH_HZ = 260;
/**
 * A frame or beat quieter than this RMS (−60 dBFS) has no bass in it. Bass notes in a separated stem often sit between −55 and −62 dBFS,
 * so a −50 dBFS gate would silence real notes.
 */
const QUIET_RMS = 10 ** (-60 / 20);
/** The YIN threshold: a lag whose cumulative difference is below this is a period. */
const PERIODIC_BELOW = 0.3;
/** Smoothed values keep this share of the confidence they came from, so a smoothed beat is never as sure as a read one. */
const SMOOTHED_SHARE = 0.8;

/** One beat's raw reading before smoothing. `sounding` is false only for a quiet beat. */
interface RawReading {
  pc: number | null;
  confidence: number;
  sounding: boolean;
}

/** The pitch of a frame, from YIN. `aperiodicity` is the YIN value at the period (0 is perfectly periodic). */
export interface PitchEstimate {
  hz: number;
  aperiodicity: number;
}

/** The pitch class (0 to 11) of a MIDI note number. */
export function pitchClassOfMidi(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/**
 * Estimates the pitch of one frame with YIN (de Cheveigné and Kawahara, 2002): the squared difference at each lag, normalised by its mean,
 * and the first lag that dips below the threshold. Null when no period between LOW_HZ and HIGH_HZ is clear.
 */
export function yinPitch(frame: ArrayLike<number>, sampleRate: number): PitchEstimate | null {
  const window = frame.length >> 1;
  const minLag = Math.max(2, Math.floor(sampleRate / HIGH_HZ));
  const maxLag = Math.min(window - 1, Math.floor(sampleRate / LOW_HZ));
  if (maxLag <= minLag) return null;
  const difference = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const d = frame[i] - frame[i + lag];
      sum += d * d;
    }
    difference[lag] = sum;
  }
  const normalised = new Float64Array(maxLag + 1);
  normalised[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += difference[lag];
    normalised[lag] = running > 0 ? (difference[lag] * lag) / running : 1;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalised[lag] >= PERIODIC_BELOW) continue;
    // Slide to the bottom of the dip, so the period is the lag of the minimum rather than its first crossing.
    let best = lag;
    while (best + 1 <= maxLag && normalised[best + 1] < normalised[best]) best++;
    return { hz: sampleRate / best, aperiodicity: normalised[best] };
  }
  return null;
}

/** The mean of the channels, at the stem's own rate. */
function monoOf(audio: PcmAudio): Float32Array {
  const length = audio.channels[0]?.length ?? 0;
  const out = new Float32Array(length);
  for (const channel of audio.channels) for (let i = 0; i < length; i++) out[i] += channel[i] / audio.channels.length;
  return out;
}

/** Averages each `factor` samples into one. Bass is far below the new Nyquist, so the box filter is enough. */
function decimate(samples: Float32Array, factor: number): Float32Array {
  const length = Math.floor(samples.length / factor);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k];
    out[i] = sum / factor;
  }
  return out;
}

/** The RMS level of a run of samples. */
function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * The reading of one beat, from the samples between `start` and `end` (in seconds). Each frame that is loud enough is pitch-tracked. The
 * beat's pitch class is the one the most frames agree on, and its confidence is that share of all the frames.
 */
function readBeat(samples: Float32Array, rate: number, start: number, end: number): RawReading {
  const first = Math.round(start * rate);
  const last = Math.min(samples.length, Math.round(end * rate));
  const length = last - first;
  if (length <= 0) return { pc: null, confidence: 0, sounding: false };
  const beat = samples.subarray(first, last);
  if (rmsOf(beat) < QUIET_RMS) return { pc: null, confidence: 0, sounding: false };
  if (length < MIN_WINDOW_SAMPLES) return { pc: null, confidence: 0, sounding: true };
  const size = Math.min(FRAME_SAMPLES, length);
  const frames = length > size ? FRAMES_PER_BEAT : 1;
  const starts = Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : Math.round(((length - size) * i) / (frames - 1))));
  const midis: number[] = [];
  for (const offset of starts) {
    const frame = beat.subarray(offset, offset + size);
    if (rmsOf(frame) < QUIET_RMS) continue;
    const pitch = yinPitch(frame, rate);
    if (pitch) midis.push(69 + 12 * Math.log2(pitch.hz / 440));
  }
  if (midis.length === 0) return { pc: null, confidence: 0, sounding: true };
  const median = [...midis].sort((a, b) => a - b)[Math.floor(midis.length / 2)];
  const pc = pitchClassOfMidi(median);
  const agree = midis.filter((midi) => pitchClassOfMidi(midi) === pc).length;
  return { pc, confidence: agree / frames, sounding: true };
}

/**
 * Smooths the raw readings. A beat whose two neighbours are the same note, with a different note in between, takes that note (a single
 * stray reading). A beat with no clear pitch while the stem still sounds takes the previous beat's note. Smoothed values keep a share of
 * their confidence, so the chain of inherited notes fades out. Quiet beats stay null.
 */
export function smoothBassLine(raw: readonly RawReading[]): { pc: number | null; confidence: number }[] {
  const out = raw.map(({ pc, confidence }) => ({ pc, confidence }));
  for (let i = 1; i + 1 < raw.length; i++) {
    const before = raw[i - 1];
    const after = raw[i + 1];
    if (before.pc === null || before.pc !== after.pc || raw[i].pc === null || raw[i].pc === before.pc) continue;
    out[i] = { pc: before.pc, confidence: Math.min(before.confidence, after.confidence) * SMOOTHED_SHARE };
  }
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].pc !== null || !raw[i].sounding || out[i - 1].pc === null) continue;
    out[i] = { pc: out[i - 1].pc, confidence: out[i - 1].confidence * SMOOTHED_SHARE };
  }
  return out;
}

/**
 * The bass note of each beat of the grid. `beats` are the beat times in seconds of the audio. The last beat is read over the length of the
 * beat before it, since it has no next beat to end at.
 */
export function bassLineOf(bass: PcmAudio, beats: readonly number[]): BassLineBeat[] {
  const factor = Math.max(1, Math.round(bass.sampleRate / ANALYSIS_RATE));
  const rate = bass.sampleRate / factor;
  const samples = decimate(monoOf(bass), factor);
  const lastInterval = beats.length >= 2 ? beats[beats.length - 1] - beats[beats.length - 2] : 0.5;
  const raw = beats.map((time, i) => {
    const next = i + 1 < beats.length ? beats[i + 1] : time + lastInterval;
    return readBeat(samples, rate, time + ATTACK_SECONDS, next - END_MARGIN_SECONDS);
  });
  return smoothBassLine(raw).map(({ pc, confidence }, beat) => ({ beat, pc, confidence }));
}
