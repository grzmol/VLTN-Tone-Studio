// The original drummer's timing (spec 107). The beat grid spaces steps evenly between beats, but a real drummer plays the offbeat hits a
// little early or late. This reads the hits of the original drums stem, one list per kind of piece, and moves the generated drum notes onto
// them, so the guitar and vocals that were played with the real drummer still line up with the generated one. Pure: the band job calls it.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, PEDAL_HAT, RIDE, SIDE_STICK, SNARE, type NoteEvent } from "./note";
import type { PcmAudio } from "../types";

/** Which band of the drum stem a piece is read from. */
export type DrumBand = "kick" | "mid" | "high";

/** The time of each hit of the original drums, in seconds and in order, by band. */
export type DrumOnsets = Record<DrumBand, number[]>;

/** The band edges, in Hz: the kick is below KICK_BELOW, the snare and toms between MID_FROM and MID_TO, the hats, ride and crash above HIGH_ABOVE. */
const KICK_BELOW = 120;
const MID_FROM = 1000;
const MID_TO = 4000;
const HIGH_ABOVE = 8000;

/** A hit is a frame whose energy is this many times the average of the 10 ms before it. */
const JUMP_RATIO = 2.5;
const BEFORE_FRAMES = 10;
/** A band's hits must reach this share of its loud level (the 99th percentile of its frames), so room noise and leakage are not read as hits. */
const FLOOR_SHARE = 0.3;
/** After a hit, no other is read for this long. A 16th note at 200 BPM is 75 ms, so no real hit is lost. */
const REFRACTORY_SECONDS = 0.025;
/** How far past the first rising frame the hit's peak is looked for, and how far back the attack is looked for, in frames of 1 ms. */
const PEAK_FRAMES = 8;
const LOOK_BACK_FRAMES = 5;
/** The short envelope the attack is read from, in seconds: the same as the beat grid's 32 samples at 44.1 kHz. */
const ENVELOPE_SECONDS = 0.0007;

/** How far a generated note moves to meet a hit of the original, in seconds. A note with no hit in reach stays where it is. */
export const SNAP_REACH_SECONDS = 0.04;
/** A bass note this close to a kick (before the snap) is locked to it and moves with it, in seconds. */
export const BASS_LOCK_SECONDS = 0.005;

/** The band a drum pitch is read from. */
export function bandOf(pitch: number): DrumBand {
  if (pitch === KICK) return "kick";
  if ([SNARE, SIDE_STICK, LOW_TOM, MID_TOM, HIGH_TOM].includes(pitch)) return "mid";
  if ([CLOSED_HAT, PEDAL_HAT, OPEN_HAT, RIDE, CRASH].includes(pitch)) return "high";
  return "mid";
}

/** The mono average of the channels. */
function average(audio: PcmAudio): Float32Array {
  const [first, ...rest] = audio.channels;
  if (!first) return new Float32Array(0);
  if (rest.length === 0) return first;
  const out = new Float32Array(first.length);
  for (const channel of audio.channels) for (let i = 0; i < out.length; i++) out[i] += channel[i] / audio.channels.length;
  return out;
}

/**
 * A one-pole low-pass. Run backward as well it does not delay the signal, so the middle of an edge stays where the edge is; the kick's band
 * needs that, because its cutoff is low enough to delay an attack by a millisecond. The higher cutoffs delay by well under 0.1 ms.
 */
function lowPass(input: Float32Array, cutoff: number, sampleRate: number, bothWays = false): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  const out = new Float32Array(input.length);
  let state = 0;
  for (let i = 0; i < input.length; i++) {
    state += a * (input[i] - state);
    out[i] = state;
  }
  if (!bothWays) return out;
  state = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    state += a * (out[i] - state);
    out[i] = state;
  }
  return out;
}

function subtract(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

/** The kick band is slow, so it is read from the stem averaged down by this much, which keeps the work small. */
const KICK_DECIMATION = 8;

/** The stem limited to one band, and the rate that signal runs at. */
function bandSignal(mono: Float32Array, band: DrumBand, sampleRate: number): { signal: Float32Array; rate: number } {
  if (band === "kick") {
    const rate = sampleRate / KICK_DECIMATION;
    const slow = new Float32Array(Math.floor(mono.length / KICK_DECIMATION));
    for (let j = 0; j < slow.length; j++) {
      let sum = 0;
      for (let k = 0; k < KICK_DECIMATION; k++) sum += mono[j * KICK_DECIMATION + k];
      slow[j] = sum / KICK_DECIMATION;
    }
    return { signal: lowPass(lowPass(slow, KICK_BELOW, rate, true), KICK_BELOW, rate, true), rate };
  }
  if (band === "high") return { signal: subtract(mono, lowPass(mono, HIGH_ABOVE, sampleRate)), rate: sampleRate };
  return { signal: lowPass(subtract(mono, lowPass(mono, MID_FROM, sampleRate)), MID_TO, sampleRate), rate: sampleRate };
}

/** The mean absolute value of each 1 ms frame. */
function frameEnergy(signal: Float32Array, frame: number): Float32Array {
  const frames = Math.floor(signal.length / frame);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * frame, end = i + frame; i < end; i++) sum += Math.abs(signal[i]);
    out[f] = sum / frame;
  }
  return out;
}

/** The attack inside a span of samples: the first sample whose short forward envelope reaches half of the span's peak, as snapToAttack reads it. */
function attackIn(signal: Float32Array, from: number, to: number, length: number): number | null {
  const last = Math.min(to, signal.length - length);
  const first = Math.max(0, from);
  if (last <= first) return null;
  const env: number[] = [];
  let peak = 0;
  for (let i = first; i <= last; i++) {
    let sum = 0;
    for (let k = 0; k < length; k++) sum += Math.abs(signal[i + k]);
    env.push(sum / length);
    peak = Math.max(peak, env[env.length - 1]);
  }
  if (!(peak > 0)) return null;
  // The envelope is read forward, so its half-way point lags the attack by half its length.
  return first + env.findIndex((value) => value >= 0.5 * peak) + length / 2;
}

/** The hits of one band, in seconds. */
function bandOnsets(mono: Float32Array, band: DrumBand, sampleRate: number): number[] {
  const { signal, rate } = bandSignal(mono, band, sampleRate);
  const frame = Math.max(1, Math.round(rate / 1000));
  const energy = frameEnergy(signal, frame);
  if (energy.length <= BEFORE_FRAMES) return [];
  const loud = Float32Array.from(energy).sort()[Math.floor(energy.length * 0.99)];
  const floor = FLOOR_SHARE * loud;
  const refractory = Math.round(REFRACTORY_SECONDS * 1000);
  const onsets: number[] = [];
  let before = 0;
  for (let i = 0; i < BEFORE_FRAMES; i++) before += energy[i];
  let allowedFrom = BEFORE_FRAMES;
  for (let i = BEFORE_FRAMES; i < energy.length; i++) {
    const rising = energy[i] >= floor && energy[i] > JUMP_RATIO * (before / BEFORE_FRAMES) && energy[i] >= energy[i - 1];
    if (rising && i >= allowedFrom) {
      let peakFrame = i;
      for (let f = i; f <= Math.min(energy.length - 1, i + PEAK_FRAMES); f++) if (energy[f] > energy[peakFrame]) peakFrame = f;
      const attack = attackIn(signal, (i - LOOK_BACK_FRAMES) * frame, (peakFrame + 1) * frame, Math.max(2, Math.round(ENVELOPE_SECONDS * rate)));
      onsets.push((attack ?? i * frame) / rate);
      allowedFrom = peakFrame + refractory;
    }
    before += energy[i] - energy[i - BEFORE_FRAMES];
  }
  // Two hits that read the same attack are one hit.
  return onsets.filter((time, index) => index === 0 || time > onsets[index - 1]);
}

/**
 * The hits of an original drums stem, by band: kicks from the low band, snare and toms from the middle one and hats, ride and crash from the
 * high one. Each is placed on the sample where its attack starts. A stem of several channels is averaged first.
 */
export function drumOnsets(drums: PcmAudio): DrumOnsets {
  const mono = average(drums);
  return {
    kick: bandOnsets(mono, "kick", drums.sampleRate),
    mid: bandOnsets(mono, "mid", drums.sampleRate),
    high: bandOnsets(mono, "high", drums.sampleRate),
  };
}

/** The index of the first value in a sorted list that is at least `value`. */
function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The time each note moves to. A note takes the nearest hit of its band within SNAP_REACH_SECONDS. Simultaneous notes in the same band share a hit.
 * Pairs are settled nearest first; distinct times compete for each hit.
 */
function snappedTimes(notes: readonly NoteEvent[], onsets: DrumOnsets): number[] {
  const groups = new Map<string, number[]>();
  notes.forEach((note, index) => {
    const key = `${bandOf(note.pitch)}:${note.time}`;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });
  const pairs: { note: number; hit: number; distance: number; band: DrumBand }[] = [];
  notes.forEach((note, index) => {
    const band = bandOf(note.pitch);
    if (groups.get(`${band}:${note.time}`)![0] !== index) return;
    const hits = onsets[band];
    for (let hit = lowerBound(hits, note.time - SNAP_REACH_SECONDS); hit < hits.length && hits[hit] <= note.time + SNAP_REACH_SECONDS; hit++) {
      pairs.push({ note: index, hit, distance: Math.abs(hits[hit] - note.time), band });
    }
  });
  pairs.sort((a, b) => a.distance - b.distance);
  const times = notes.map((note) => note.time);
  const moved = new Set<number>();
  const taken = new Set<string>();
  for (const pair of pairs) {
    const key = `${pair.band}:${pair.hit}`;
    if (moved.has(pair.note) || taken.has(key)) continue;
    moved.add(pair.note);
    taken.add(key);
    for (const index of groups.get(`${pair.band}:${notes[pair.note].time}`)!) times[index] = onsets[pair.band][pair.hit];
  }
  return times;
}

/**
 * Moves the generated drums onto the original drummer's hits, and the bass notes that were locked to a kick by the same amount as that kick.
 * Notes keep their order and their lengths. With no hits nothing moves.
 */
export function followDrummer(drums: readonly NoteEvent[], bass: readonly NoteEvent[], onsets: DrumOnsets): { drums: NoteEvent[]; bass: NoteEvent[] } {
  const times = snappedTimes(drums, onsets);
  const kicks = drums
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => note.pitch === KICK)
    .sort((a, b) => a.note.time - b.note.time);
  const kickTimes = kicks.map(({ note }) => note.time);
  return {
    drums: drums.map((note, index) => (times[index] === note.time ? note : { ...note, time: times[index] })),
    bass: bass.map((note) => {
      // The nearest kick at or after the earliest one that can still be within the lock.
      let lock: number | undefined;
      for (let i = lowerBound(kickTimes, note.time - BASS_LOCK_SECONDS); i < kicks.length && kickTimes[i] <= note.time + BASS_LOCK_SECONDS; i++) {
        if (lock === undefined || Math.abs(kickTimes[i] - note.time) < Math.abs(kickTimes[lock] - note.time)) lock = i;
      }
      if (lock === undefined) return note;
      const shift = times[kicks[lock].index] - kicks[lock].note.time;
      return shift === 0 ? note : { ...note, time: note.time + shift };
    }),
  };
}
