// Beat tracking for a recording, so generated parts can follow a band that keeps no click. The steps are onset strength (spectral
// flux), tempo (autocorrelation), beats (dynamic programming), the downbeat (bar phase) and a straight-line check for steady songs.
// Everything here is pure: the worker (beat-grid-worker.ts) runs it off the main thread, and no WebAudio or store is touched.

import { hann, powerSpectrum } from "../tonematch/fft";
import type { PcmAudio } from "../types";

/** Samples in one analysis frame. */
export const FFT_SIZE = 2048;
/** Samples between frames. At 44.1 kHz that is about 86 frames a second. The analysis window of frame t is centred on sample (t − 1) × HOP. */
export const HOP = 512;
/** Log-spaced mel bands the onset strength sums over. */
export const MEL_BANDS = 40;
/** Lowest and highest edges of the mel bands, in Hz. */
export const MEL_LOW_HZ = 30;
export const MEL_HIGH_HZ = 16000;
/** Bins below this are averaged into the low-band curve, which carries kick and bass evidence for the downbeat. */
export const LOW_BAND_HZ = 200;
/** Magnitudes are scaled by this before the log, so quiet detail still registers. */
export const LOG_COMPRESSION = 1000;
/** Length, in seconds, of the window whose mean is subtracted from the flux (half before and half after each frame). */
export const LOCAL_MEAN_SECONDS = 1;
/** Tempo search range. Lags outside it are never considered. */
export const TEMPO_MIN_BPM = 50;
export const TEMPO_MAX_BPM = 220;
/** The tempo prior is log-Gaussian, centred on this BPM. Most band music sits near it, so ties go to a tempo near 110. */
export const TEMPO_PRIOR_BPM = 110;
/** Width of the tempo prior, in octaves (its standard deviation on a log2 scale). */
export const TEMPO_PRIOR_OCTAVES = 0.8;
/**
 * Gaussian smoothing of the onset curve before the autocorrelation, in frames. A sharp onset is only correlated at whole-frame lags, so
 * a beat period that falls between frames (150 BPM is 34.45 frames) scored far below its double. Smoothing makes the score almost
 * independent of the fraction.
 */
export const TEMPO_SMOOTH_FRAMES = 1.5;
/** A best tempo below this is checked for its double, because a fast band can show its half as the strongest pulse. */
export const TEMPO_FAST_BPM = 100;
/** The double is taken when its autocorrelation is at least this share of the best one's. */
export const TEMPO_FAST_RATIO = 0.8;
/**
 * Beat tracker penalty for an interval that differs from the period, on a log scale: a 10% stretch costs about 1 unit, roughly the size
 * of one beat's onset peak once the onset is scaled to unit RMS. Tracks drift of a few percent without losing beats.
 */
export const TRACK_PENALTY = 100;
/** Beat intervals the tracker may use, as fractions of the period. Half and double are allowed, so a missed beat can be bridged. */
export const TRACK_MIN_INTERVAL = 0.5;
export const TRACK_MAX_INTERVAL = 2;
/** A chord change this close to a beat (seconds) counts toward that beat's bar phase. */
export const CHORD_WINDOW_SECONDS = 0.07;
/** Weight of chord-change evidence against low-band evidence when choosing the downbeat. Both are scaled to 0 to 1. */
export const CHORD_WEIGHT = 0.5;
/** A song is steady when every beat is this close (seconds) to a straight line through all of them. */
export const STEADY_TOLERANCE_SECONDS = 0.015;
/** A beat at either end of the grid must have an onset peak this close (seconds), or it is trimmed or not added. */
export const EXTEND_PEAK_SECONDS = 0.07;
/**
 * An onset peak counts only when it reaches this share of a typical tracked beat's onset. This keeps the noise floor of a quiet tail
 * from growing a grid across silence.
 */
export const EXTEND_MIN_SHARE = 0.25;
/** The largest shift one nudge may make, in seconds. */
export const NUDGE_MAX_SECONDS = 0.1;

export interface OnsetStrength {
  /** Onset strength per frame, after the local mean is removed. */
  onset: Float64Array;
  /** Low-band flux per frame, on the same frames. */
  low: Float64Array;
  /** Frames a second. */
  frameRate: number;
}

export interface TempoEstimate {
  /** The best tempo, refined to a fraction of a frame. Zero when there is no periodic onset to find. */
  bpm: number;
  /** The best tempo first, then its half and its double, so the user can pick the one that matches the song. */
  candidates: number[];
}

export interface BeatGrid {
  beatsPerBar: number;
  /** Beat times in seconds, from the start of the audio. */
  beats: number[];
  /** Index into `beats` of the first downbeat, in 0 to beatsPerBar − 1. */
  downbeat: number;
  /** The median beat interval as a tempo. Zero when there are fewer than two beats. */
  bpm: number;
  /** Set when every beat fits a straight line; the metronome can then run on `bpm` and `firstBeat`. */
  steady: { bpm: number; firstBeat: number } | null;
  /**
   * Beat indices where bars start, from the first downbeat on, when the bar lines move within the song (see `barStartsFromChords`). A bar
   * between two of them has its own length. Absent, every bar has `beatsPerBar` beats from the downbeat.
   */
  barStarts?: number[];
}

interface MelBand {
  bins: number[];
  weights: number[];
}

/**
 * Sums the sources to one mono track, scaled so its peak is 1. Sources of different lengths are padded with silence. Float32 halves the
 * memory of a long song, and the tracker does not need more precision.
 */
export function monoSum(sources: readonly PcmAudio[]): Float32Array {
  const length = sources.reduce((max, source) => Math.max(max, source.channels[0]?.length ?? 0), 0);
  const mono = new Float32Array(length);
  for (const source of sources) {
    const channels = source.channels;
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / channels.length;
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak > 0) for (let i = 0; i < length; i++) mono[i] /= peak;
  return mono;
}

/** Triangular mel filters over the FFT bins. A band can be empty at the bottom of the range, where a bin is wider than the band. */
function melBands(sampleRate: number): MelBand[] {
  const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
  const toHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
  const low = toMel(MEL_LOW_HZ),
    high = toMel(Math.min(MEL_HIGH_HZ, sampleRate / 2));
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) => (toHz(low + ((high - low) * i) / (MEL_BANDS + 1)) * FFT_SIZE) / sampleRate);
  return Array.from({ length: MEL_BANDS }, (_, m) => {
    const left = edges[m],
      centre = edges[m + 1],
      right = edges[m + 2];
    const band: MelBand = { bins: [], weights: [] };
    for (let k = Math.max(0, Math.floor(left)); k <= Math.min(FFT_SIZE / 2, Math.ceil(right)); k++) {
      const weight = k <= centre ? (k - left) / Math.max(centre - left, 1e-9) : (right - k) / Math.max(right - centre, 1e-9);
      if (weight > 0) {
        band.bins.push(k);
        band.weights.push(Math.min(1, weight));
      }
    }
    return band;
  });
}

/**
 * Half-wave rectified change from the previous frame, summed over the bands. Before the first frame the level is silence, so a sound
 * that is already playing at the start of the audio still counts as an onset.
 */
function spectralFlux(levels: Float64Array, bands: number): Float64Array {
  const frames = levels.length / bands;
  const flux = new Float64Array(frames);
  for (let t = 0; t < frames; t++) {
    let sum = 0;
    for (let b = 0; b < bands; b++) {
      const before = t > 0 ? levels[(t - 1) * bands + b] : 0;
      const rise = levels[t * bands + b] - before;
      if (rise > 0) sum += rise;
    }
    flux[t] = sum;
  }
  return flux;
}

/** Subtracts the mean of the `half` frames either side of each frame, then clips at zero. Steady beats then stand out from the sustained level. */
function removeLocalMean(curve: Float64Array, half: number): Float64Array {
  const n = curve.length,
    prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + curve[i];
  const out = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, t - half),
      hi = Math.min(n, t + half + 1);
    out[t] = Math.max(0, curve[t] - (prefix[hi] - prefix[lo]) / (hi - lo));
  }
  return out;
}

/**
 * Onset strength of the sources, summed to mono. The full curve uses log-compressed mel bands; the low curve uses the bins below
 * LOW_BAND_HZ. Both are spectral flux, half-wave rectified, with the local mean removed.
 */
export function onsetStrength(sources: readonly PcmAudio[], sampleRate: number): OnsetStrength {
  const mono = monoSum(sources);
  const frames = Math.ceil(mono.length / HOP),
    frameRate = sampleRate / HOP;
  const bins = FFT_SIZE / 2 + 1,
    half = FFT_SIZE / 2;
  const window = hann(FFT_SIZE),
    bands = melBands(sampleRate),
    lowBins = Math.min(bins - 1, Math.floor((LOW_BAND_HZ * FFT_SIZE) / sampleRate));
  const re = new Float64Array(FFT_SIZE),
    im = new Float64Array(FFT_SIZE),
    frame = new Float64Array(FFT_SIZE),
    power = new Float64Array(bins),
    amp = new Float64Array(bins);
  const levels = new Float64Array(frames * MEL_BANDS),
    lowLevels = new Float64Array(frames);
  // Scales |X| so a full-scale sine reads about 1, whatever the frame length.
  const scale = 4 / FFT_SIZE;
  for (let t = 0; t < frames; t++) {
    // The rise into frame t is largest while its window is still climbing onto a click, about one hop (FFT_SIZE / 4 samples) before the
    // click. Centring frame t on (t − 1) × HOP, so the rise into it is stored one hop later, puts a click's peak on the click. Measured
    // on single clicks, the peak was 11 ms early with frames centred on t × HOP and is within 2 ms with this.
    const start = (t - 1) * HOP - half;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i;
      frame[i] = s >= 0 && s < mono.length ? mono[s] : 0;
    }
    powerSpectrum(frame, window, re, im, power);
    for (let k = 0; k < bins; k++) amp[k] = Math.sqrt(power[k]) * scale;
    for (let m = 0; m < MEL_BANDS; m++) {
      const band = bands[m];
      let sum = 0;
      for (let j = 0; j < band.bins.length; j++) sum += band.weights[j] * amp[band.bins[j]];
      levels[t * MEL_BANDS + m] = Math.log1p(LOG_COMPRESSION * sum);
    }
    let lowSum = 0;
    for (let k = 1; k <= lowBins; k++) lowSum += amp[k];
    lowLevels[t] = Math.log1p((LOG_COMPRESSION * lowSum) / Math.max(1, lowBins));
  }
  const halfWindow = Math.max(1, Math.round((LOCAL_MEAN_SECONDS * frameRate) / 2));
  return {
    onset: removeLocalMean(spectralFlux(levels, MEL_BANDS), halfWindow),
    low: removeLocalMean(spectralFlux(lowLevels, 1), halfWindow),
    frameRate,
  };
}

/**
 * The tempo by autocorrelation of the onset curve, weighted by a log-Gaussian prior near TEMPO_PRIOR_BPM. The best lag is refined by a
 * parabola through its neighbours. The half and double of the best tempo are returned too, since the autocorrelation of a song with a
 * steady pulse peaks at several multiples.
 */
export function estimateTempo(onset: ArrayLike<number>, frameRate: number): TempoEstimate {
  const n = onset.length;
  const minLag = Math.max(1, Math.floor((60 * frameRate) / TEMPO_MAX_BPM)),
    maxLag = Math.ceil((60 * frameRate) / TEMPO_MIN_BPM);
  if (n <= maxLag + 1) return { bpm: 0, candidates: [] };
  const acf = onsetAutocorrelation(onset, maxLag);
  if (!acf) return { bpm: 0, candidates: [] };
  let best = minLag,
    bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES) ** 2);
    const score = acf[lag] * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (!(acf[best] > 0)) return { bpm: 0, candidates: [] };
  // The prior alone favours a slow tempo: at 170 BPM the 85 BPM lag scores higher. If the best is below TEMPO_FAST_BPM and its faster
  // double is in range with nearly the same autocorrelation, the faster tempo is the pulse the band plays.
  const slowLag = peakLag(acf, best);
  const fasterLag = Math.round(slowLag / 2);
  if ((60 * frameRate) / slowLag < TEMPO_FAST_BPM && fasterLag >= minLag && acf[fasterLag] >= TEMPO_FAST_RATIO * acf[best]) best = fasterLag;
  const bpm = (60 * frameRate) / peakLag(acf, best);
  return { bpm, candidates: [bpm, bpm / 2, bpm * 2] };
}

/**
 * Normalised autocorrelation of the smoothed onset curve, with its mean removed, at lags 0 to maxLag + 1. The curve must be longer than
 * maxLag + 1 frames. Null when the curve has no energy.
 */
function onsetAutocorrelation(onset: ArrayLike<number>, maxLag: number): Float64Array | null {
  const n = onset.length;
  const smooth = smoothCurve(onset, TEMPO_SMOOTH_FRAMES);
  let mean = 0;
  for (let t = 0; t < n; t++) mean += smooth[t];
  mean /= n;
  const x = new Float64Array(n);
  for (let t = 0; t < n; t++) x[t] = smooth[t] - mean;
  // Autocorrelation at each lag, normalised by the energy at lag 0 and by the number of pairs.
  const acf = new Float64Array(maxLag + 2);
  let energy = 0;
  for (let t = 0; t < n; t++) energy += x[t] * x[t];
  if (!(energy > 0)) return null;
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let t = 0; t + lag < n; t++) sum += x[t] * x[t + lag];
    acf[lag] = sum / (n - lag) / (energy / n);
  }
  return acf;
}

/** How far either side of a typed tempo `refineTempo` searches, as a share of it. */
export const TEMPO_REFINE_SPREAD = 0.04;

/**
 * The tempo near `hint` that the onset curve supports best. The autocorrelation is read every 0.1 BPM within `spread` of the hint, between
 * frames by linear interpolation, and the highest reading wins. Only the hint is refined, so a 98 can come out as 97.6 but never as its
 * double or half. A hint the audio does not support still gets its best reading in the spread. Zero when the curve has no energy.
 */
export function refineTempo(onset: ArrayLike<number>, frameRate: number, hint: number, spread = TEMPO_REFINE_SPREAD): number {
  if (!(hint > 0) || !(frameRate > 0)) return 0;
  const low = hint * (1 - spread),
    high = hint * (1 + spread);
  const maxLag = Math.ceil((60 * frameRate) / low);
  if (onset.length <= maxLag + 1) return 0;
  const acf = onsetAutocorrelation(onset, maxLag);
  if (!acf) return 0;
  let best = 0,
    bestScore = -Infinity;
  for (let tenths = Math.ceil(low * 10); tenths <= Math.floor(high * 10); tenths++) {
    const lag = (60 * frameRate * 10) / tenths;
    const whole = Math.floor(lag),
      share = lag - whole;
    const score = acf[whole] * (1 - share) + acf[whole + 1] * share;
    if (score > bestScore) {
      bestScore = score;
      best = tenths / 10;
    }
  }
  return best;
}

/** Where the beats fall within one beat interval, in seconds from 0 to `interval`: the circular mean of their positions. Zero for no beats. */
function beatPhase(beats: readonly number[], interval: number): number {
  if (!beats.length) return 0;
  let x = 0,
    y = 0;
  for (const beat of beats) {
    const angle = (2 * Math.PI * beat) / interval;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  const angle = Math.atan2(y, x);
  return ((angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI)) * interval;
}

/** The autocorrelation peak at `lag`, refined by a parabola through its neighbours, in frames. Needs `acf` to cover lag + 1. */
function peakLag(acf: Float64Array, lag: number): number {
  const a = acf[lag - 1],
    b = acf[lag],
    c = acf[lag + 1];
  const denominator = a - 2 * b + c;
  return denominator < 0 ? lag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator)) : lag;
}

/** Gaussian smoothing over `sigma` frames. Near the ends it averages over the samples that exist. */
function smoothCurve(curve: ArrayLike<number>, sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const n = curve.length,
    out = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    let sum = 0,
      weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const u = t + k;
      if (u >= 0 && u < n) {
        sum += curve[u] * kernel[k + radius];
        weight += kernel[k + radius];
      }
    }
    out[t] = sum / weight;
  }
  return out;
}

/**
 * Beat times from dynamic programming. Each frame's score is its onset plus the best score of an earlier frame one beat-interval away,
 * minus the tempo penalty for that interval. The path with the highest score is traced back. Beat times are refined to a sub-frame peak.
 */
export function trackBeats(onset: ArrayLike<number>, frameRate: number, bpm: number): number[] {
  const n = onset.length;
  if (!(bpm > 0) || !(frameRate > 0) || n === 0) return [];
  let energy = 0;
  for (let t = 0; t < n; t++) energy += onset[t] * onset[t];
  const rms = Math.sqrt(energy / n);
  if (!(rms > 0)) return [];
  const period = (60 * frameRate) / bpm;
  const minLag = Math.max(1, Math.round(period * TRACK_MIN_INTERVAL)),
    maxLag = Math.max(minLag, Math.round(period * TRACK_MAX_INTERVAL));
  const penalty = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) penalty[lag] = TRACK_PENALTY * Math.log(lag / period) ** 2;
  const score = new Float64Array(n),
    previous = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const here = onset[t] / rms;
    let best = -Infinity,
      from = -1;
    for (let lag = minLag; lag <= maxLag && t - lag >= 0; lag++) {
      const candidate = score[t - lag] - penalty[lag];
      if (candidate > best) {
        best = candidate;
        from = t - lag;
      }
    }
    // Continuing a path only pays when its score is positive. Otherwise this frame starts a new path.
    if (from >= 0 && best > 0) {
      score[t] = here + best;
      previous[t] = from;
    } else score[t] = here;
  }
  let end = 0;
  for (let t = 1; t < n; t++) if (score[t] > score[end]) end = t;
  const frames: number[] = [];
  for (let t = end; t !== -1; t = previous[t]) frames.push(t);
  return frames.reverse().map((t) => {
    let offset = 0;
    if (t > 0 && t < n - 1) {
      const a = onset[t - 1] / rms,
        b = onset[t] / rms,
        c = onset[t + 1] / rms;
      const denominator = a - 2 * b + c;
      if (denominator < 0) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator));
    }
    return (t + offset) / frameRate;
  });
}

/**
 * The score of each bar phase, as an index into `beats`. Each phase scores its low-band onset, scaled to 0 to 1 by the strongest phase,
 * plus CHORD_WEIGHT times its share of the chord changes that fall within CHORD_WINDOW_SECONDS of one of its beats.
 */
export function phaseScores(
  beats: readonly number[],
  lowOnset: ArrayLike<number>,
  frameRate: number,
  beatsPerBar: number,
  chordChanges: readonly number[] = [],
): number[] {
  const bar = Math.max(1, Math.floor(beatsPerBar));
  const lowSum = new Float64Array(bar),
    chordHits = new Float64Array(bar);
  beats.forEach((beat, i) => {
    const frame = Math.round(beat * frameRate);
    let level = 0;
    for (let f = frame - 1; f <= frame + 1; f++) if (f >= 0 && f < lowOnset.length) level = Math.max(level, lowOnset[f]);
    lowSum[i % bar] += level;
  });
  for (const change of chordChanges) {
    let nearest = -1,
      gap = Infinity;
    beats.forEach((beat, i) => {
      if (Math.abs(beat - change) < gap) {
        gap = Math.abs(beat - change);
        nearest = i;
      }
    });
    if (nearest >= 0 && gap <= CHORD_WINDOW_SECONDS) chordHits[nearest % bar]++;
  }
  const lowMax = Math.max(...lowSum),
    hitTotal = chordHits.reduce((a, b) => a + b, 0);
  return Array.from(lowSum, (low, p) => (lowMax > 0 ? low / lowMax : 0) + CHORD_WEIGHT * (chordHits[p] / Math.max(1, hitTotal)));
}

/**
 * The bar phase, as an index into `beats`: the phase with the highest score (see `phaseScores`). Ties go to the earlier beat.
 */
export function pickDownbeat(
  beats: readonly number[],
  lowOnset: ArrayLike<number>,
  frameRate: number,
  beatsPerBar: number,
  chordChanges: readonly number[] = [],
): number {
  if (!beats.length) return 0;
  const scores = phaseScores(beats, lowOnset, frameRate, beatsPerBar, chordChanges);
  let bestPhase = 0;
  scores.forEach((score, p) => {
    if (score > scores[bestPhase]) bestPhase = p;
  });
  return bestPhase;
}

/**
 * The bar phase the chord changes point to, as an index into `beats`. A change counts for the beat within CHORD_WINDOW_SECONDS of it.
 * The phase with the most hits takes the downbeat only when it has more hits than `current` and holds most of them; otherwise `current`
 * stays. With no change near a beat, `current` stays.
 */
export function downbeatFromChordChanges(beats: readonly number[], changes: readonly number[], beatsPerBar: number, current: number): number {
  const bar = Math.max(1, Math.floor(beatsPerBar));
  const hits = new Float64Array(bar);
  let total = 0;
  for (const change of changes) {
    let nearest = -1,
      gap = Infinity;
    beats.forEach((beat, i) => {
      if (Math.abs(beat - change) < gap) {
        gap = Math.abs(beat - change);
        nearest = i;
      }
    });
    if (nearest >= 0 && gap <= CHORD_WINDOW_SECONDS) {
      hits[nearest % bar]++;
      total++;
    }
  }
  if (!total) return current;
  let best = 0;
  for (let p = 1; p < bar; p++) if (hits[p] > hits[best]) best = p;
  return hits[best] > hits[current] && hits[best] * 2 > total ? best : current;
}

/**
 * The times where a chord list changes name, for `downbeatFromChordChanges`. The first chord never counts, since nothing comes before it.
 */
export function chordChangeTimesOf(chords: readonly { time: number; name: string }[]): number[] {
  const times: number[] = [];
  chords.forEach((chord, i) => {
    if (i > 0 && chord.name !== chords[i - 1].name) times.push(chord.time);
  });
  return times;
}

/** Bars of chord changes read together to decide which bar phase the changes fall on. */
export const PHASE_RUN_BARS = 4;
/** The share of a window's chord-change weight one phase needs before the bar lines may move to it. */
export const PHASE_SHARE = 0.6;
/** The most a bar line may move, in beats, when the bar lines move to another phase. A bridging bar is this much shorter or longer. */
export const PHASE_SHIFT_MAX = 3;

/**
 * Bar starts for a song whose bar lines move. Each chord change counts by how long its chord lasts (up to a bar), so a one-beat passing
 * chord barely counts. The changes are read in windows of PHASE_RUN_BARS bars: a window takes the bar phase that holds at least
 * PHASE_SHARE of its weight. When two windows in a row agree on a phase other than the current one, the bar lines move to it at the next
 * bar, through one bridging bar 1 to PHASE_SHIFT_MAX beats shorter or longer than the rest. Returns null when the bar lines never move,
 * so the grid keeps one bar length.
 */
export function barStartsFromChords(beats: readonly number[], changes: readonly number[], beatsPerBar: number, downbeat: number): number[] | null {
  const bar = Math.max(1, Math.floor(beatsPerBar));
  if (bar < 2 || beats.length <= downbeat) return null;
  // The beat each change falls on, once each, in order.
  const changeBeats: number[] = [];
  for (const change of changes) {
    let nearest = -1,
      gap = Infinity;
    beats.forEach((beat, i) => {
      if (Math.abs(beat - change) < gap) {
        gap = Math.abs(beat - change);
        nearest = i;
      }
    });
    if (nearest >= downbeat && gap <= CHORD_WINDOW_SECONDS && nearest !== changeBeats[changeBeats.length - 1]) changeBeats.push(nearest);
  }
  changeBeats.sort((a, b) => a - b);
  const phaseAt = (beat: number) => (((beat - downbeat) % bar) + bar) % bar;
  // The weight of each phase in each nominal bar.
  const bars = Math.ceil((beats.length - downbeat) / bar);
  const weights = Array.from({ length: bars }, () => new Float64Array(bar));
  changeBeats.forEach((beat, i) => {
    const next = changeBeats[i + 1] ?? beat + bar;
    weights[Math.floor((beat - downbeat) / bar)][phaseAt(beat)] += Math.min(bar, next - beat);
  });
  // The phase each window of bars agrees on, or null when no phase holds enough of it.
  const windowPhase: Array<number | null> = [];
  for (let k = 0; k < bars; k++) {
    const sum = new Float64Array(bar);
    for (let j = k; j < Math.min(bars, k + PHASE_RUN_BARS); j++) for (let p = 0; p < bar; p++) sum[p] += weights[j][p];
    let total = 0,
      best = 0;
    for (let p = 0; p < bar; p++) {
      total += sum[p];
      if (sum[p] > sum[best]) best = p;
    }
    windowPhase.push(total > 0 && sum[best] >= PHASE_SHARE * total ? best : null);
  }
  const starts = [downbeat];
  let cursor = downbeat,
    moved = false;
  for (let next = cursor + bar; next < beats.length; next = cursor + bar) {
    const k = Math.floor((next - downbeat) / bar);
    const want = windowPhase[k] ?? null;
    let line = next;
    // The bar itself must lean to the new phase too, so the lines move where the chords move and not a window early.
    const own = weights[k] ? weights[k].indexOf(Math.max(...weights[k])) : -1;
    const ownAgrees = !!weights[k] && weights[k][own] > 0 && own === want;
    // A chord that still changes on the old bar line keeps that line: the move comes at the bar after it.
    const oldLineHolds = changeBeats.includes(next);
    if (want !== null && want !== phaseAt(cursor) && windowPhase[k + 1] === want && ownAgrees && !oldLineHolds) {
      // The bridging bar ends where the first chord change of the new phase is, when one is in reach; otherwise on the line of the new
      // phase nearest a bar's length from the cursor.
      let best = changeBeats.find((beat) => beat > cursor && beat - cursor <= bar + PHASE_SHIFT_MAX && phaseAt(beat) === want) ?? -1;
      for (let d = bar - PHASE_SHIFT_MAX; d <= bar + PHASE_SHIFT_MAX; d++) {
        const candidate = cursor + d;
        if (best >= 0) break;
        if (d >= 1 && candidate < beats.length && phaseAt(candidate) === want && (best < 0 || Math.abs(d - bar) < Math.abs(best - cursor - bar)))
          best = candidate;
      }
      if (best >= 0) {
        line = best;
        moved = true;
      }
    }
    starts.push(line);
    cursor = line;
  }
  return moved ? starts : null;
}

/**
 * The grid with its downbeat moved to the phase the chord changes point to (see `downbeatFromChordChanges`), and with its bar starts
 * read from the same changes (see `barStartsFromChords`). The grid is returned as it is when neither changes. A locked grid keeps its
 * steady first beat on the downbeat, so that moves with it.
 */
export function withChordDownbeat(grid: BeatGrid, changes: readonly number[]): BeatGrid {
  const downbeat = downbeatFromChordChanges(grid.beats, changes, grid.beatsPerBar, grid.downbeat);
  const moved = downbeat !== grid.downbeat;
  const onDownbeat = grid.beats[grid.downbeat];
  const steady = moved && grid.steady && grid.steady.firstBeat === onDownbeat ? { ...grid.steady, firstBeat: grid.beats[downbeat] ?? onDownbeat } : grid.steady;
  const base: BeatGrid = moved ? { ...grid, downbeat, steady } : grid;
  const starts = barStartsFromChords(base.beats, changes, base.beatsPerBar, base.downbeat);
  if (!moved && !starts && !grid.barStarts) return grid;
  const next: BeatGrid = { ...base };
  if (starts) next.barStarts = starts;
  else delete next.barStarts;
  return next;
}

/** The meters `estimateMeter` chooses between. Six and other compound meters are not detected, so they keep the default. */
export const METER_CANDIDATES = [3, 4] as const;

export interface MeterEstimate {
  beatsPerBar: 3 | 4;
  /** How much the chosen meter stands out from the other, from 0 to 1. Zero when the beats cannot tell them apart. */
  confidence: number;
}

/** The fewest beats a meter estimate is made from. Fewer than this and every meter fits the beats equally well. */
export const METER_MIN_BEATS = 12;

/**
 * Which of 3 or 4 beats a bar the beats fall into. A real bar has one strong beat, so the phases of the right meter differ more in onset
 * and chord changes than the phases of the wrong one do. Each candidate scores its contrast (the top phase above the mean, as a share of
 * the top); the stronger contrast wins, and confidence is the share by which it beats the other. Too few beats give 4 with no confidence.
 */
export function estimateMeter(
  beats: readonly number[],
  lowOnset: ArrayLike<number>,
  frameRate: number,
  chordChanges: readonly number[] = [],
): MeterEstimate {
  if (beats.length < METER_MIN_BEATS) return { beatsPerBar: 4, confidence: 0 };
  const contrast = (bar: number) => {
    const scores = phaseScores(beats, lowOnset, frameRate, bar, chordChanges);
    const top = Math.max(...scores);
    return top > 0 ? (top - scores.reduce((a, b) => a + b, 0) / scores.length) / top : 0;
  };
  const [three, four] = METER_CANDIDATES.map(contrast);
  if (three > four) return { beatsPerBar: 3, confidence: (three - four) / Math.max(three, 1e-9) };
  return { beatsPerBar: 4, confidence: Math.max(0, (four - three) / Math.max(four, 1e-9)) };
}

/** Least-squares line through beats[i] at each index i in `indices`. Null when the indices do not spread out. */
function fitLine(beats: readonly number[], indices: readonly number[]): { slope: number; intercept: number } | null {
  const n = indices.length;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const i of indices) {
    sx += i;
    sy += beats[i];
    sxx += i * i;
    sxy += i * beats[i];
  }
  const denominator = n * sxx - sx * sx;
  if (!(denominator > 0)) return null;
  const slope = (n * sxy - sx * sy) / denominator;
  return { slope, intercept: (sy - slope * sx) / n };
}

/**
 * A straight line through the beats, if the beats fit it. The line is fitted to every beat first. The first and the last beat may be
 * dropped, but only when each one alone is off the line by more than STEADY_TOLERANCE_SECONDS, because a tracker can end on a stray
 * beat. The line is then refitted, and every beat that is kept must be within tolerance. Needs at least four beats.
 */
export function fitSteady(beats: readonly number[]): { bpm: number; firstBeat: number } | null {
  const n = beats.length;
  if (n < 4) return null;
  const all = beats.map((_, i) => i);
  const line = fitLine(beats, all);
  if (!line) return null;
  const off = (fit: { slope: number; intercept: number }, i: number) => Math.abs(beats[i] - (fit.intercept + fit.slope * i)) > STEADY_TOLERANCE_SECONDS;
  const outliers = all.filter((i) => off(line, i));
  if (outliers.some((i) => i !== 0 && i !== n - 1)) return null;
  const kept = all.filter((i) => !outliers.includes(i));
  const fit = outliers.length ? fitLine(beats, kept) : line;
  if (!fit || kept.length < 4 || !(fit.slope > 0)) return null;
  if (kept.some((i) => off(fit, i))) return null;
  return { bpm: 60 / fit.slope, firstBeat: fit.intercept };
}

/** Median beat interval as a tempo. Zero when there are fewer than two beats. */
function medianBpm(beats: readonly number[]): number {
  if (beats.length < 2) return 0;
  const intervals = beats
    .slice(1)
    .map((beat, i) => beat - beats[i])
    .sort((a, b) => a - b);
  const middle = intervals[Math.floor(intervals.length / 2)];
  return middle > 0 ? 60 / middle : 0;
}

function makeGrid(beatsPerBar: number, beats: number[], downbeat: number): BeatGrid {
  return { beatsPerBar, beats, downbeat, bpm: medianBpm(beats), steady: fitSteady(beats) };
}

/** Median of a list of numbers. Zero for an empty list. */
function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Whether the onset curve has a local peak at or above `threshold` within EXTEND_PEAK_SECONDS of `time`. */
function hasOnsetPeak(onset: Float64Array, time: number, frameRate: number, threshold: number): boolean {
  const centre = Math.round(time * frameRate),
    reach = Math.ceil(EXTEND_PEAK_SECONDS * frameRate);
  for (let f = Math.max(0, centre - reach); f <= Math.min(onset.length - 1, centre + reach); f++) {
    const before = f > 0 ? onset[f - 1] : 0,
      after = f + 1 < onset.length ? onset[f + 1] : 0;
    if (onset[f] >= threshold && onset[f] > 0 && onset[f] >= before && onset[f] > after) return true;
  }
  return false;
}

/**
 * Trims the tracked beats at either end that have no onset peak, then adds beats before the first and after the last, one local period
 * at a time, up to the end of the audio. The tracker can carry its path across silence after the last onset, so trimming is needed as
 * well as adding. A stretch before the start stops at a quarter period, and a beat in it is moved to 0, so a song whose first click is
 * at 0 keeps that click.
 */
function extendBeats(beats: readonly number[], onset: Float64Array, frameRate: number, duration: number): number[] {
  if (beats.length < 2) return [...beats];
  const typical = median(beats.map((beat) => Math.max(...[-1, 0, 1].map((d) => onset[Math.round(beat * frameRate) + d] ?? 0))));
  const threshold = EXTEND_MIN_SHARE * typical;
  const supported = (time: number) => hasOnsetPeak(onset, time, frameRate, threshold);
  let first = 0,
    last = beats.length - 1;
  while (first < last && !supported(beats[first])) first++;
  while (last > first && !supported(beats[last])) last--;
  const core = beats.slice(first, last + 1);
  if (core.length < 2) return core;
  const intervals = core.slice(1).map((beat, i) => beat - core[i]);
  const startPeriod = median(intervals.slice(0, 4)),
    endPeriod = median(intervals.slice(-4));
  const front: number[] = [];
  let time = core[0];
  while (time > 0 && time - startPeriod >= -startPeriod / 4) {
    const candidate = Math.max(0, time - startPeriod);
    if (!supported(candidate)) break;
    front.unshift(candidate);
    time = candidate;
  }
  const back: number[] = [];
  for (let next = core[core.length - 1] + endPeriod; next <= duration && supported(next); next += endPeriod) back.push(next);
  return [...front, ...core, ...back];
}

/** How far either side of a tracked beat the attack is searched for, in seconds. Frame-based onsets are only good to a few milliseconds. */
export const ATTACK_SEARCH_SECONDS = 0.012;
/** Length of the envelope the attack is read from, in samples. About 0.7 ms at 44.1 kHz, short enough to find the start of a click. */
const ATTACK_ENVELOPE_SAMPLES = 32;

/**
 * Moves each beat to the attack of the audio near it. The attack is the first sample whose short envelope reaches half of the envelope's
 * peak inside the search window. A frame-based onset puts the peak in a frame, which is only good to a few milliseconds; the attack is
 * read from the samples themselves.
 */
export function snapToAttack(mono: ArrayLike<number>, sampleRate: number, beats: readonly number[]): number[] {
  const reach = Math.round(ATTACK_SEARCH_SECONDS * sampleRate);
  return beats.map((beat) => {
    const centre = Math.round(beat * sampleRate);
    const from = Math.max(0, centre - reach),
      to = Math.min(mono.length - ATTACK_ENVELOPE_SAMPLES, centre + reach);
    if (to <= from) return beat;
    const env: number[] = [];
    let peak = 0;
    for (let i = from; i <= to; i++) {
      let sum = 0;
      for (let k = 0; k < ATTACK_ENVELOPE_SAMPLES; k++) sum += Math.abs(mono[i + k]);
      env.push(sum / ATTACK_ENVELOPE_SAMPLES);
      peak = Math.max(peak, env[env.length - 1]);
    }
    if (!(peak > 0)) return beat;
    const half = env.findIndex((v) => v >= 0.5 * peak);
    // The envelope is read forward, so its half-way point lags the attack by half its length.
    return (from + half + ATTACK_ENVELOPE_SAMPLES / 2) / sampleRate;
  });
}

/** What the performer said about the tempo before the beats are tracked. Without it, the tracker picks its own tempo. */
export interface TempoHintOptions {
  /** The tempo the performer typed, in BPM. The tracker refines it within TEMPO_REFINE_SPREAD rather than picking another. */
  tempoHint?: number;
  /** Use `tempoHint` exactly, and find only where the beats fall and which one is the downbeat. */
  lockTempo?: boolean;
}

/** The whole pipeline: onset strength, tempo, beats, the grid's ends, then the downbeat. Chord changes are optional and in seconds. */
export function detectBeatGrid(
  sources: readonly PcmAudio[],
  sampleRate: number,
  beatsPerBar: number,
  chordChanges: readonly number[] = [],
  options: TempoHintOptions = {},
): BeatGrid {
  return analyseBeats(sources, sampleRate, beatsPerBar, chordChanges, options).grid;
}

/**
 * The beat grid and the meter the beats fall into, from one pass over the audio. The grid is laid out for `beatsPerBar`; the meter is
 * estimated from the beats alone, so it does not depend on the meter the caller guessed. With a locked tempo the beats sit on an exact
 * grid at that tempo, and the tracker only decides where it starts and which beat is the downbeat.
 */
export function analyseBeats(
  sources: readonly PcmAudio[],
  sampleRate: number,
  beatsPerBar: number,
  chordChanges: readonly number[] = [],
  options: TempoHintOptions = {},
): { grid: BeatGrid; meter: MeterEstimate } {
  const { onset, low, frameRate } = onsetStrength(sources, sampleRate);
  const hint = options.tempoHint && options.tempoHint > 0 ? options.tempoHint : 0;
  // A locked tempo is tracked as typed, so the beats it finds are the phase of that exact grid.
  const bpm = hint ? (options.lockTempo ? hint : refineTempo(onset, frameRate, hint)) : estimateTempo(onset, frameRate).bpm;
  const tracked = trackBeats(onset, frameRate, bpm);
  const duration = sources.reduce((max, source) => Math.max(max, (source.channels[0]?.length ?? 0) / sampleRate), 0);
  const beats = snapToAttack(monoSum(sources), sampleRate, extendBeats(tracked, onset, frameRate, duration));
  if (hint && options.lockTempo) {
    const interval = 60 / hint;
    const locked = fixedBeatGrid(hint, beatPhase(beats, interval), beatsPerBar, duration);
    const downbeat = pickDownbeat(locked.beats, low, frameRate, beatsPerBar, chordChanges);
    // The fit of an exact grid is the tempo the performer set. Its first beat is the downbeat, as tempoFromGrid reads it for a grid that is not steady.
    const grid: BeatGrid = { ...locked, downbeat, steady: { bpm: hint, firstBeat: locked.beats[downbeat] ?? 0 } };
    return { grid, meter: estimateMeter(grid.beats, low, frameRate, chordChanges) };
  }
  const downbeat = pickDownbeat(beats, low, frameRate, beatsPerBar, chordChanges);
  const grid = makeGrid(beatsPerBar, beats, downbeat);
  return { grid, meter: estimateMeter(grid.beats, low, frameRate, chordChanges) };
}

/** The most beats in a bar the stored grid may have. Anything larger is not a meter the engine knows. */
const MAX_BEATS_PER_BAR = 12;

/**
 * Reads a beat grid saved in a song's options. Anything that is not a grid of finite, non-negative, strictly increasing beat times, with
 * a whole number of beats per bar and a downbeat inside that bar, gives null, so the song simply has no grid. The tempo and the steady fit
 * are worked out again from the beats rather than trusted from storage.
 */
export function parseBeatGrid(value: unknown): BeatGrid | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  const beatsPerBar = saved.beatsPerBar as number,
    downbeat = saved.downbeat as number;
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > MAX_BEATS_PER_BAR) return null;
  if (!Number.isInteger(downbeat) || downbeat < 0 || downbeat >= beatsPerBar) return null;
  if (!Array.isArray(saved.beats) || saved.beats.length === 0) return null;
  const beats = saved.beats as unknown[];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (typeof beat !== "number" || !Number.isFinite(beat) || beat < 0) return null;
    if (i > 0 && !(beat > (beats[i - 1] as number))) return null;
  }
  const grid = makeGrid(beatsPerBar, beats as number[], downbeat);
  const starts = parseBarStarts(saved.barStarts, downbeat, beatsPerBar, beats.length);
  return starts ? { ...grid, barStarts: starts } : grid;
}

/**
 * Saved bar starts, kept when they make sense for the grid: whole beat indices that rise from the downbeat, inside the grid, each bar 1 to
 * twice `beatsPerBar` beats long. Anything else is left out, so the grid falls back to bars of one length.
 */
function parseBarStarts(value: unknown, downbeat: number, beatsPerBar: number, beatCount: number): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value[0] !== downbeat) return null;
  for (let i = 0; i < value.length; i++) {
    const start = value[i];
    if (!Number.isInteger(start) || start < 0 || start >= beatCount) return null;
    if (i > 0) {
      const length = start - (value[i - 1] as number);
      if (length < 1 || length > 2 * beatsPerBar) return null;
    }
  }
  return value as number[];
}

/**
 * A grid that follows the song's fixed tempo: a beat every 60 / bpm seconds, on the metronome's first beat, from the start of the song to
 * its end. `firstBeat` is a beat of the grid, so the bar phase is the one the metronome counts. Returns an empty grid for a tempo that
 * cannot be used.
 */
export function fixedBeatGrid(bpm: number, firstBeat: number, beatsPerBar: number, songEnd: number): BeatGrid {
  const bar = Math.max(1, Math.floor(beatsPerBar));
  if (!(bpm > 0) || !(songEnd > 0) || !Number.isFinite(firstBeat) || firstBeat < 0) return makeGrid(bar, [], 0);
  const interval = 60 / bpm;
  const count = Math.floor(firstBeat / interval);
  const start = Math.max(0, firstBeat - count * interval);
  const beats: number[] = [];
  for (let i = 0; start + i * interval < songEnd; i++) beats.push(start + i * interval);
  return makeGrid(bar, beats, count % bar);
}

/** Keeps every other beat, starting with the downbeat's beat, so the tempo halves and the bar keeps its beats per bar. */
export function halveTempo(grid: BeatGrid): BeatGrid {
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  const keep = grid.downbeat % 2;
  const beats = grid.beats.filter((_, i) => i % 2 === keep);
  return makeGrid(grid.beatsPerBar, beats, Math.floor(grid.downbeat / 2) % bar);
}

/** Adds the midpoint between each pair of beats, so the tempo doubles and the downbeat stays on the same beat in time. */
export function doubleTempo(grid: BeatGrid): BeatGrid {
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  const beats: number[] = [];
  grid.beats.forEach((beat, i) => {
    beats.push(beat);
    if (i + 1 < grid.beats.length) beats.push((beat + grid.beats[i + 1]) / 2);
  });
  return makeGrid(grid.beatsPerBar, beats, (2 * grid.downbeat) % bar);
}

/** Moves the downbeat by `step` beats, wrapping within the bar. */
export function shiftDownbeat(grid: BeatGrid, step: number): BeatGrid {
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  // The performer has set the bar phase by hand, so the bar lines are one length again.
  const { barStarts: _moved, ...rest } = grid;
  return { ...rest, downbeat: (((grid.downbeat + step) % bar) + bar) % bar };
}

/**
 * Moves every beat by the same amount, at most NUDGE_MAX_SECONDS per call. A beat that would fall before the start is dropped, and the
 * downbeat moves back by the number dropped, so it stays on the same beat in time.
 */
export function nudgeGrid(grid: BeatGrid, seconds: number): BeatGrid {
  const shift = Math.max(-NUDGE_MAX_SECONDS, Math.min(NUDGE_MAX_SECONDS, Number.isFinite(seconds) ? seconds : 0));
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  const kept = grid.beats.map((beat) => beat + shift).filter((beat) => beat >= 0);
  const dropped = grid.beats.length - kept.length;
  const nudged = makeGrid(grid.beatsPerBar, kept, (((grid.downbeat - dropped) % bar) + bar) % bar);
  return grid.barStarts ? { ...nudged, barStarts: grid.barStarts.map((beat) => beat - dropped).filter((beat) => beat >= 0) } : nudged;
}
