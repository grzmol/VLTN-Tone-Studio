// Closed-loop refinement on the pedal: the proposal is played on the pedal, the player records a few seconds through the
// pedal's USB audio, and what came out is compared with the song's guitar (loss.ts). The knobs that can be fixed from a
// recording are corrected and the loop runs again:
//  - the five Guitar EQ bands are linear, so the spectral gap (stem minus recording, levelled at 200 Hz-4 kHz like
//    irdesign.ts and capture-match.ts) maps straight onto them, damped so a wrong dB-per-step scale can't overshoot;
//  - the amp's Gain is one number, moved with a secant step on the gain score (gain.ts).
// Playing is never the same twice, so only statistics of the texture are compared (the same distance the offline
// refinement uses); a round needs enough playing (MIN_PLAYING_S in ir-store.ts).
// Pure: the store (pedal-refine-store.ts) drives the pedal and the recording.
import type { GuitarAnalysis } from "./analyse";
import { estimateGain } from "./gain";
import { describeTexture, textureDistance } from "./loss";
import { bandMean, BAND_CENTERS, ltas } from "./ltas";
import { EQ_CENTERS_HZ, EQ_RANGE_DB } from "./refine-offline";

/** The most recording rounds one refinement takes (each is a take of the player). */
export const MAX_ROUNDS = 6;
/** A round that improves the best distance by less than this (steps, loss.ts) doesn't count as progress. */
export const MIN_GAIN_STEPS = 0.15;
/** Rounds without progress before it stops. */
export const PATIENCE = 2;
/** Share of the measured EQ gap corrected per round. */
const DAMPING = 0.7;
/** Amp Gain params go 0-100; the first guess of how far the gain score moves per unit. */
const SLOPE_GUESS = 0.01;
const MAX_GAIN_STEP = 30;

export interface Knobs {
  /** The amp's Gain param (0-100) */
  gain: number;
  /** The five Guitar EQ bands (EQ_CENTERS_HZ), dB */
  eqDb: number[];
}

export interface Measure {
  /** textureDistance of the recording from the stem's texture, in "steps" (1 step ≈ a difference you can hear) */
  distance: number;
  gainScore: number;
  /** Stem minus recording at the five EQ centres, dB, both levelled at 200 Hz-4 kHz */
  gapDb: number[];
}

export interface Round {
  knobs: Knobs;
  measure: Measure;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Compare one recording (mono, `rate` Hz) with the song's guitar. */
export function measure(recording: Float32Array, rate: number, target: GuitarAnalysis): Measure {
  const heard = ltas(recording, rate);
  const levelOf = (c: { centers: readonly number[]; db: ArrayLike<number> }) => bandMean(c, 200, 4000);
  const stemMean = levelOf(target.ltas);
  const heardMean = levelOf(heard);
  const gap = { centers: BAND_CENTERS, db: Float64Array.from(BAND_CENTERS, (_, i) => target.ltas.db[i] - stemMean - (heard.db[i] - heardMean)) };
  // half an octave either side of each band: one 1/3-octave band of a single performance is too noisy to follow
  const gapDb = EQ_CENTERS_HZ.map((f) => {
    const g = bandMean(gap, f / 2 ** 0.5, f * 2 ** 0.5);
    return Number.isFinite(g) ? g : 0;
  });
  return {
    distance: textureDistance(target.texture, describeTexture(recording, rate)).distance,
    gainScore: estimateGain(recording, rate).score,
    gapDb,
  };
}

/** The knobs for the next round, from the last round and the one before it (for the gain's slope). */
export function nextKnobs(history: readonly Round[], target: GuitarAnalysis): Knobs {
  const last = history[history.length - 1];
  const eqDb = last.knobs.eqDb.map((g, i) => clamp(g + DAMPING * last.measure.gapDb[i], -EQ_RANGE_DB, EQ_RANGE_DB));
  const before = history[history.length - 2];
  let slope = SLOPE_GUESS;
  if (before && Math.abs(last.knobs.gain - before.knobs.gain) >= 1) {
    const s = (last.measure.gainScore - before.measure.gainScore) / (last.knobs.gain - before.knobs.gain);
    // a measured slope that points the wrong way or is flat says the score is noise: keep the guess
    if (s > 0.0015) slope = Math.min(s, 0.03);
  }
  const step = clamp((0.8 * (target.gain.score - last.measure.gainScore)) / slope, -MAX_GAIN_STEP, MAX_GAIN_STEP);
  return { gain: Math.round(clamp(last.knobs.gain + step, 0, 100)), eqDb };
}

/** The round with the smallest distance; never later than the start unless it really is closer. */
export const bestRound = (history: readonly Round[]): Round => history.reduce((b, r) => (r.measure.distance < b.measure.distance ? r : b));

/** Done when the rounds are used up, or the best hasn't improved for PATIENCE rounds. */
export function isDone(history: readonly Round[]): boolean {
  if (history.length >= MAX_ROUNDS) return true;
  let best = Infinity;
  let sinceProgress = 0;
  for (const r of history) {
    if (r.measure.distance < best - MIN_GAIN_STEPS) sinceProgress = 0;
    else sinceProgress++;
    best = Math.min(best, r.measure.distance);
  }
  return history.length > 1 && sinceProgress >= PATIENCE;
}
