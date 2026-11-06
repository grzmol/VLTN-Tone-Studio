// Reads the bass note the song's bass stem plays on each beat (spec 86). For every beat, the stem's spectrum over the beat (after the
// attack) is summed over harmonics: each pitch class takes its best fundamental, and the beat takes the class with the highest sum. The
// stem's tuning is read first from the beats that are clear, so the notes are judged against the stem's own A, not A440. YIN on a few
// frames of the beat is a second opinion. Pure: the beats and the stem come in as values, and the result is plain data.

import { fft, hann } from "../tonematch/fft";
import type { PcmAudio } from "../types";

/** The bass note of one beat: a pitch class (0 is C) or null when the stem is quiet, and how sure the reading is. */
export interface BassLineBeat {
  /** Index into the beat grid. */
  beat: number;
  pc: number | null;
  /** From 0 to 1, after smoothing and the second opinion. */
  confidence: number;
}

/** The bass line of a song: the beats' notes, and the stem's tuning against A440 in cents (clamped to ±50, zero when none was clear). */
export interface BassLine {
  tuningCents: number;
  beats: BassLineBeat[];
}

/** A bass note is used for the generated bass only at or above this confidence. Below it the chord's own bass is kept. */
export const BASS_LINE_CONFIDENT = 0.6;

/** The first part of each beat is skipped, since the pluck of the attack is not a pitch. */
const ATTACK_SECONDS = 0.05;
/** The last part of each beat is skipped, so the next note's attack is not read as this one's pitch. */
const END_MARGIN_SECONDS = 0.02;
/** The bass is read at this rate. Bass fundamentals are below 260 Hz, so 11 kHz is far above what the pitch needs. */
const ANALYSIS_RATE = 11025;
/** The spectrum of a beat is one FFT of this many points (about 1.5 s at 11 kHz), zero-padded after the window. */
const SPECTRUM_FFT = 16384;
/** The lowest and highest fundamentals a class can take. */
const FUNDAMENTAL_LOW_HZ = 30;
const FUNDAMENTAL_HIGH_HZ = 260;
/** The harmonics summed for each candidate fundamental, with their weights. Harmonics above the fifth add little for a bass. */
const HARMONIC_WEIGHTS = [1, 0.8, 0.6, 0.4, 0.3];
/** The highest frequency the harmonics reach, with a little room, so the spectrum is kept up to it. */
const HARMONIC_TOP_HZ = HARMONIC_WEIGHTS.length * FUNDAMENTAL_HIGH_HZ * 1.02;
/** A beat's level sets how far its margin counts: silent beats near −60 dBFS count for nothing, beats at −40 dBFS or more for all of it. */
const LEVEL_SILENT_DB = -60;
const LEVEL_FULL_DB = -40;
/** A reading that YIN agrees with gets this much more confidence, capped at 1. */
export const SECOND_OPINION_BONUS = 0.2;
/** The tuning is read from the beats whose reading reaches this confidence. */
const TUNING_MIN_CONFIDENCE = 0.4;
/** The tuning is searched from −50 to +50 cents, and needs at least this many clear beats to be read. */
const TUNING_MIN_BEATS = 3;
/** The smoothed values keep this share of the confidence they came from, so a smoothed beat is never as sure as a read one. */
const SMOOTHED_SHARE = 0.8;

/** The YIN frames of a beat: the frame length, and the frames across the beat. */
const FRAME_SAMPLES = 4096;
const MIN_WINDOW_SAMPLES = 768;
const FRAMES_PER_BEAT = 3;
/** YIN's pitch range, and its threshold: a lag whose cumulative difference is below it is a period. */
const LOW_HZ = 35;
const HIGH_HZ = 260;
const PERIODIC_BELOW = 0.3;
/** A frame or beat quieter than this RMS (−60 dBFS) has no bass in it. A separated bass often sits between −55 and −62 dBFS. */
const QUIET_RMS = 10 ** (-60 / 20);

/** One beat's reading before smoothing. `sounding` is false only for a quiet beat. */
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

/** A beat's spectrum: its level, and the magnitudes of the bins up to the harmonics' top (null when the beat is quiet or too short). */
interface BeatSpectrum {
  rms: number;
  magnitude: Float32Array | null;
}

/** A pitch class's reading from its spectrum: the class, its margin over the next class, and the refined frequency of its fundamental. */
export interface ClassReading {
  pc: number;
  margin: number;
  hz: number;
}

/** The pitch class (0 to 11) of a MIDI note number. */
export function pitchClassOfMidi(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/** The MIDI note number of a frequency, without rounding. */
function midiOf(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
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

/** The FFT of the Hann-windowed samples of one beat, as magnitudes up to the harmonics' top. Null when the beat is quiet or too short. */
function spectrumOf(samples: Float32Array, rate: number, start: number, end: number, scratch: { re: Float64Array; im: Float64Array }): BeatSpectrum {
  const first = Math.round(start * rate);
  const last = Math.min(samples.length, Math.round(end * rate));
  const beat = last > first ? samples.subarray(first, last) : new Float32Array(0);
  const rms = rmsOf(beat);
  if (rms < QUIET_RMS || beat.length < MIN_WINDOW_SAMPLES) return { rms, magnitude: null };
  const n = Math.min(beat.length, SPECTRUM_FFT);
  const window = hann(n);
  scratch.re.fill(0);
  scratch.im.fill(0);
  for (let i = 0; i < n; i++) scratch.re[i] = beat[i] * window[i];
  fft(scratch.re, scratch.im);
  const top = Math.min(SPECTRUM_FFT / 2, Math.ceil((HARMONIC_TOP_HZ * SPECTRUM_FFT) / rate) + 2);
  const magnitude = new Float32Array(top + 1);
  for (let k = 0; k <= top; k++) magnitude[k] = Math.hypot(scratch.re[k], scratch.im[k]);
  return { rms, magnitude };
}

/** The candidate fundamentals of the bass: every note from FUNDAMENTAL_LOW_HZ to FUNDAMENTAL_HIGH_HZ, on the stem's own tuning. */
function candidatesAt(offsetSemitones: number): { pc: number; hz: number }[] {
  const out: { pc: number; hz: number }[] = [];
  for (let midi = 15; midi <= 90; midi++) {
    const hz = 440 * 2 ** ((midi + offsetSemitones - 69) / 12);
    if (hz >= FUNDAMENTAL_LOW_HZ && hz <= FUNDAMENTAL_HIGH_HZ) out.push({ pc: pitchClassOfMidi(midi), hz });
  }
  return out;
}

/** The largest magnitude within one bin of `bin`. */
function peakNear(magnitude: Float32Array, bin: number): number {
  const k = Math.round(bin);
  if (k < 1 || k + 1 >= magnitude.length) return 0;
  return Math.max(magnitude[k - 1], magnitude[k], magnitude[k + 1]);
}

/** The frequency of a spectral peak, by parabolic interpolation of its magnitudes, finer than one bin. */
function refinedHz(magnitude: Float32Array, rate: number, hz: number): number {
  const binHz = rate / SPECTRUM_FFT;
  let k = Math.round(hz / binHz);
  if (k < 1 || k + 1 >= magnitude.length) return hz;
  for (const j of [k - 1, k + 1]) if (magnitude[j] > magnitude[k]) k = j;
  const a = magnitude[k - 1],
    b = magnitude[k],
    c = magnitude[k + 1];
  const curvature = a - 2 * b + c;
  if (curvature >= 0 || k < 2 || k + 2 >= magnitude.length) return k * binHz;
  return (k + (0.5 * (a - c)) / curvature) * binHz;
}

/**
 * The pitch class a spectrum sounds: each class takes its best candidate fundamental, scored by the weighted sum of its harmonics, and the
 * class with the highest score wins. The margin is how far the winner stands above the runner-up, as a share of the winner.
 */
export function strongestClass(magnitude: Float32Array, rate: number, offsetSemitones: number): ClassReading {
  const scores = new Float64Array(12);
  const bestHz = new Float64Array(12);
  for (const candidate of candidatesAt(offsetSemitones)) {
    let score = 0;
    HARMONIC_WEIGHTS.forEach((weight, h) => {
      score += weight * peakNear(magnitude, ((h + 1) * candidate.hz * SPECTRUM_FFT) / rate);
    });
    if (score > scores[candidate.pc]) {
      scores[candidate.pc] = score;
      bestHz[candidate.pc] = candidate.hz;
    }
  }
  const order = [...Array(12).keys()].sort((a, b) => scores[b] - scores[a]);
  const top = scores[order[0]];
  const margin = top > 0 ? (top - scores[order[1]]) / top : 0;
  return { pc: order[0], margin, hz: refinedHz(magnitude, rate, bestHz[order[0]]) };
}

/** How much a beat's level counts: 0 at −60 dBFS and below, 1 at −40 dBFS and above. */
export function levelFactor(rms: number): number {
  const db = 20 * Math.log10(rms + 1e-12);
  return Math.max(0, Math.min(1, (db - LEVEL_SILENT_DB) / (LEVEL_FULL_DB - LEVEL_SILENT_DB)));
}

/** The confidence after the second opinion: a reading YIN agrees with gains SECOND_OPINION_BONUS, capped at 1. A disagreement or no YIN reading changes nothing. */
export function withSecondOpinion(confidence: number, pc: number, yinPc: number | null): number {
  return yinPc === pc ? Math.min(1, confidence + SECOND_OPINION_BONUS) : confidence;
}

/** The strongest harmonic sum of a spectrum on one tuning, over every candidate fundamental. */
function bestScore(magnitude: Float32Array, rate: number, offsetSemitones: number): number {
  let best = 0;
  for (const candidate of candidatesAt(offsetSemitones)) {
    let score = 0;
    HARMONIC_WEIGHTS.forEach((weight, h) => {
      score += weight * peakNear(magnitude, ((h + 1) * candidate.hz * SPECTRUM_FFT) / rate);
    });
    best = Math.max(best, score);
  }
  return best;
}

/**
 * The stem's tuning in cents against A440: the offset from −50 to +50 cents at which the clear beats' harmonic sums are strongest. Each
 * beat counts for its own peak, so a loud beat does not decide it alone. Zero when too few beats are clear.
 */
export function tuningCentsOf(clear: readonly { magnitude: Float32Array; rate: number }[]): number {
  if (clear.length < TUNING_MIN_BEATS) return 0;
  const peaks = clear.map(({ magnitude }) => Math.max(...magnitude) || 1);
  let best = 0,
    bestTotal = -1;
  for (let cents = -50; cents <= 50; cents++) {
    let total = 0;
    clear.forEach(({ magnitude, rate }, i) => (total += bestScore(magnitude, rate, cents / 100) / peaks[i]));
    if (total > bestTotal) {
      bestTotal = total;
      best = cents;
    }
  }
  return best;
}

/** The YIN pitch class of a beat: the median of its clear frames' notes, with the share of frames that agree on it. Null when none is clear. */
function yinPcOf(samples: Float32Array, rate: number, start: number, end: number): number | null {
  const first = Math.round(start * rate);
  const last = Math.min(samples.length, Math.round(end * rate));
  const length = last - first;
  if (length < MIN_WINDOW_SAMPLES) return null;
  const size = Math.min(FRAME_SAMPLES, length);
  const frames = length > size ? FRAMES_PER_BEAT : 1;
  const midis: number[] = [];
  for (let i = 0; i < frames; i++) {
    const offset = frames === 1 ? 0 : Math.round(((length - size) * i) / (frames - 1));
    const frame = samples.subarray(first + offset, first + offset + size);
    if (rmsOf(frame) < QUIET_RMS) continue;
    const pitch = yinPitch(frame, rate);
    if (pitch) midis.push(midiOf(pitch.hz));
  }
  if (midis.length === 0) return null;
  const median = [...midis].sort((a, b) => a - b)[Math.floor(midis.length / 2)];
  return pitchClassOfMidi(median);
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
 * The bass line of each beat of the grid, with the stem's tuning. `beats` are the beat times in seconds of the audio. The last beat is read
 * over the length of the beat before it, since it has no next beat to end at. Two passes: the tuning is read from the clear beats, then
 * every beat is read on that tuning.
 */
export function bassLineOf(bass: PcmAudio, beats: readonly number[]): BassLine {
  const factor = Math.max(1, Math.round(bass.sampleRate / ANALYSIS_RATE));
  const rate = bass.sampleRate / factor;
  const samples = decimate(monoOf(bass), factor);
  const lastInterval = beats.length >= 2 ? beats[beats.length - 1] - beats[beats.length - 2] : 0.5;
  const spans = beats.map((time, i) => ({
    start: time + ATTACK_SECONDS,
    end: (i + 1 < beats.length ? beats[i + 1] : time + lastInterval) - END_MARGIN_SECONDS,
  }));
  const scratch = { re: new Float64Array(SPECTRUM_FFT), im: new Float64Array(SPECTRUM_FFT) };
  const spectra = spans.map(({ start, end }) => spectrumOf(samples, rate, start, end, scratch));

  // First pass: the tuning, from the beats whose class is clear on the stem's own A440.
  const clear: { magnitude: Float32Array; rate: number }[] = [];
  for (const spectrum of spectra) {
    if (!spectrum.magnitude) continue;
    const reading = strongestClass(spectrum.magnitude, rate, 0);
    if (reading.margin * levelFactor(spectrum.rms) >= TUNING_MIN_CONFIDENCE) clear.push({ magnitude: spectrum.magnitude, rate });
  }
  const tuningCents = tuningCentsOf(clear);
  const offset = tuningCents / 100;

  // Second pass: each beat's class on the tuning, with YIN as a second opinion.
  const raw: RawReading[] = spectra.map((spectrum, i) => {
    if (spectrum.rms < QUIET_RMS) return { pc: null, confidence: 0, sounding: false };
    if (!spectrum.magnitude) return { pc: null, confidence: 0, sounding: true };
    const reading = strongestClass(spectrum.magnitude, rate, offset);
    const confidence = reading.margin * levelFactor(spectrum.rms);
    const yinPc = yinPcOf(samples, rate, spans[i].start, spans[i].end);
    return { pc: reading.pc, confidence: withSecondOpinion(confidence, reading.pc, yinPc), sounding: true };
  });
  const beatsOut = smoothBassLine(raw).map(({ pc, confidence }, beat) => ({ beat, pc, confidence }));
  return { tuningCents, beats: beatsOut };
}
