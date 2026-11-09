// Renders the notes of a generated part to audio (spec 50, commit 5b). Pure: no WebAudio, so the band worker and the tests run the same
// code. Each note becomes a voice: a sample read at a playback rate, shaped by a short envelope and panned. The voices are added into two
// Float32Arrays. If the sum would clip, the whole part is scaled down, and the factor is returned.
//
// A drum hit is one spot on the kit, so a stereo drum sample is folded to mono before it is panned. Bass is centred. Both use the same
// constant-power pan, so a centred voice sits 3 dB down in each channel.

import type { PcmAudio } from "../types";
import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, PEDAL_HAT, RIDE, SIDE_STICK, SNARE, type NoteEvent } from "./note";
import { ATTACK_ENVELOPE_SAMPLES } from "./beat-grid";
import { pickBassLayers, pickDrumSample, type SampleSet } from "./samples";

/** The sample rate of a rendered part: the song's rate. */
export const RENDER_RATE = 44100;
/** The highest a rendered part may peak: -1 dBFS. */
export const PEAK_LIMIT = 10 ** (-1 / 20);
/** A choke, or a bass note cut by the next note, fades out over this long. */
const CUT_SECONDS = 0.01;
/** A bass note fades out over this long after its duration. */
const BASS_RELEASE_SECONDS = 0.03;
/** A slide rises into its note over this long. */
export const SLIDE_SECONDS = 0.04;
/** A dead note is cut after its duration with this fade, and its one-pole low-pass sits at this frequency so it reads as a muted thump. */
const DEAD_RELEASE_SECONDS = 0.01;
export const DEAD_CUTOFF_HZ = 800;

/** How far into a sample its attack is looked for. */
const ATTACK_WINDOW_SECONDS = 0.06;

/** The attack of each sample buffer, in frames of its own rate, so a sample is measured once however many notes play it. */
const attackCache = new WeakMap<Float32Array, number>();

/**
 * Where a sample's attack is, in frames of its own rate: the first point where a short envelope (the mean of ATTACK_ENVELOPE_SAMPLES
 * absolute values, as the beat grid reads the original drums) reaches half of the sample's peak within its first 60 ms. The envelope looks
 * forward, so its point is moved by half its length, as snapToAttack does. A kick's attack sits 5 ms into its sample, so a note placed on
 * the grid would play 5 ms late if the sample simply started at the note's time.
 */
export function sampleAttack(sample: PcmAudio): number {
  const first = sample.channels[0];
  const cached = attackCache.get(first);
  if (cached !== undefined) return cached;
  const reach = Math.min(first.length, Math.round(ATTACK_WINDOW_SECONDS * sample.sampleRate));
  const envelope: number[] = [];
  let peak = 0;
  for (let i = 0; i + ATTACK_ENVELOPE_SAMPLES <= reach; i++) {
    let sum = 0;
    for (let k = 0; k < ATTACK_ENVELOPE_SAMPLES; k++)
      sum += sample.channels.reduce((total, channel) => total + Math.abs(channel[i + k]), 0) / sample.channels.length;
    envelope.push(sum / ATTACK_ENVELOPE_SAMPLES);
    peak = Math.max(peak, envelope[envelope.length - 1]);
  }
  const half = peak > 0 ? envelope.findIndex((value) => value >= 0.5 * peak) : -1;
  const attack = half < 0 ? 0 : half + ATTACK_ENVELOPE_SAMPLES / 2;
  attackCache.set(first, attack);
  return attack;
}

/**
 * Moves a voice earlier by its sample's attack, so the attack (not the first frame of the sample) lands on the note's time. The start can't
 * go before frame 0, and the hold, release and cut move with it, so the voice still lasts as long as it did.
 */
function onAttack(voice: Voice): Voice {
  const advance = Math.min(Math.max(0, voice.shape.start), Math.round(sampleAttack(voice.sample) / voice.rate));
  if (advance === 0) return voice;
  const { start, holdEnd, release, cutAt, cutFade } = voice.shape;
  return { ...voice, shape: { start: start - advance, holdEnd: holdEnd - advance, release, cutAt: cutAt - advance, cutFade } };
}

/** Where each kit piece sits, from -1 (left) to 1 (right), as a drummer hears it. Pitches not listed are centred. */
export const DRUM_PAN: Readonly<Record<number, number>> = {
  [KICK]: 0,
  [SNARE]: 0,
  [SIDE_STICK]: 0,
  [CLOSED_HAT]: 0.3,
  [PEDAL_HAT]: 0.3,
  [OPEN_HAT]: 0.3,
  [RIDE]: -0.3,
  [CRASH]: -0.2,
  [HIGH_TOM]: 0.2,
  [MID_TOM]: 0,
  [LOW_TOM]: -0.25,
};

export interface RenderedPart {
  audio: PcmAudio;
  /** The factor the whole part was scaled by to keep its peak at or below PEAK_LIMIT. 1 when it did not clip. */
  gain: number;
}

/** Constant-power pan: the left and right gains for a position from -1 (left) to 1 (right). Centre gives 0.707 in each channel. */
export function panGains(position: number): [number, number] {
  const angle = ((position + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

/**
 * How a voice is shaped, in frames of the output. It plays from `start`, at full level until `holdEnd`, then releases linearly over
 * `release` frames. A cut (a choke, or the next bass note) fades it out linearly over `cutFade` frames from `cutAt`.
 */
interface Shape {
  start: number;
  holdEnd: number;
  release: number;
  cutAt: number;
  cutFade: number;
}

interface Voice {
  sample: PcmAudio;
  /** Sample frames read per output frame: the transpose, and the ratio of the sample's rate to the output rate. */
  rate: number;
  gain: number;
  left: number;
  right: number;
  shape: Shape;
  /** A slide: the rate starts `semitones` lower and rises to `rate` over `frames` frames, linearly in semitones. */
  glide?: { semitones: number; frames: number };
  /** A one-pole low-pass coefficient (0 to 1) applied to the voice before it is shaped. Unset for no filter. */
  smoothing?: number;
}

/** Adds one voice into the output. Reads by linear interpolation, and folds a stereo sample to mono. */
function mixVoice(left: Float32Array, right: Float32Array, voice: Voice): void {
  const { sample, rate, gain, shape, glide, smoothing } = voice;
  const first = sample.channels[0];
  const second = sample.channels.length > 1 ? sample.channels[1] : first;
  const last = first.length - 1;
  // The voice stops at the end of its sample, at the end of its release, or once a cut has finished fading, whichever comes first.
  const stop = Math.min(left.length, shape.start + Math.floor(last / rate) + 1, shape.holdEnd + shape.release, shape.cutAt + shape.cutFade);
  // A glide reads the sample at a position that adds up the rate frame by frame, so the pitch can rise. A steady voice multiplies.
  let glided = 0;
  let filtered = 0;
  for (let frame = Math.max(0, shape.start); frame < stop; frame++) {
    const elapsed = frame - shape.start;
    const position = glide ? glided : elapsed * rate;
    const index = Math.floor(position);
    const fraction = position - index;
    const next = index < last ? index + 1 : last;
    const a = first[index] + (first[next] - first[index]) * fraction;
    const b = second[index] + (second[next] - second[index]) * fraction;
    if (glide) {
      const progress = Math.min(1, elapsed / glide.frames);
      glided += rate * 2 ** ((-glide.semitones * (1 - progress)) / 12);
    }
    let raw = (a + b) * 0.5 * gain;
    if (smoothing !== undefined) {
      filtered += smoothing * (raw - filtered);
      raw = filtered;
    }
    let envelope = 1;
    if (frame >= shape.holdEnd) envelope *= 1 - (frame - shape.holdEnd) / shape.release;
    if (frame >= shape.cutAt) envelope *= 1 - (frame - shape.cutAt) / shape.cutFade;
    const value = raw * envelope;
    left[frame] += value * voice.left;
    right[frame] += value * voice.right;
  }
}

/** The first value in a sorted list that is later than `value`, or Infinity when none is. */
function nextAfter(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low < sorted.length ? sorted[low] : Infinity;
}

/** Playback rate for a sample recorded at `sourceRate`, moved by `semitones`, played at `outputRate`. */
function rateOf(semitones: number, sourceRate: number, outputRate: number): number {
  return (2 ** (semitones / 12) * sourceRate) / outputRate;
}

/** One voice per drum hit. A closed or pedal hat chokes any open hat that is still ringing, with a short fade. */
function drumVoices(notes: readonly NoteEvent[], samples: SampleSet, sampleRate: number): Voice[] {
  const chokes: number[] = [];
  for (const note of notes) if (note.pitch === CLOSED_HAT || note.pitch === PEDAL_HAT) chokes.push(Math.round(note.time * sampleRate));
  const cutFade = Math.round(CUT_SECONDS * sampleRate);
  return notes.map((note) => {
    const start = Math.round(note.time * sampleRate);
    const pick = pickDrumSample(samples, note.pitch, note.velocity);
    const [left, right] = panGains(DRUM_PAN[note.pitch] ?? 0);
    const cutAt = note.pitch === OPEN_HAT ? nextAfter(chokes, start) : Infinity;
    return {
      sample: pick.audio,
      rate: rateOf(pick.transpose, pick.audio.sampleRate, sampleRate),
      gain: pick.gain,
      left,
      right,
      shape: { start, holdEnd: Infinity, release: 0, cutAt, cutFade },
    };
  });
}

/**
 * Voices for the bass notes, centred. A note is held for its duration, released, and cut at once if the next note starts first. Between
 * the soft and hard velocities a note is two voices, one per layer, each at its crossfade weight.
 */
function bassVoices(notes: readonly NoteEvent[], samples: SampleSet, sampleRate: number): Voice[] {
  const starts = notes.map((note) => Math.round(note.time * sampleRate));
  const release = Math.round(BASS_RELEASE_SECONDS * sampleRate);
  const deadRelease = Math.round(DEAD_RELEASE_SECONDS * sampleRate);
  const cutFade = Math.round(CUT_SECONDS * sampleRate);
  const [left, right] = panGains(0);
  const smoothing = 1 - Math.exp((-2 * Math.PI * DEAD_CUTOFF_HZ) / sampleRate);
  return notes.flatMap((note, index) => {
    const start = starts[index];
    const next = index + 1 < starts.length ? starts[index + 1] : Infinity;
    const glide = note.slideFrom !== undefined ? { semitones: note.slideFrom, frames: Math.round(SLIDE_SECONDS * sampleRate) } : undefined;
    return pickBassLayers(samples, note.pitch, note.velocity).map(({ pick, weight }) => ({
      sample: pick.audio,
      rate: (pick.playbackRate * pick.audio.sampleRate) / sampleRate,
      gain: weight,
      left,
      right,
      shape: {
        start,
        holdEnd: start + Math.round(note.duration * sampleRate),
        release: note.dead ? deadRelease : release,
        cutAt: next,
        cutFade,
      },
      glide,
      smoothing: note.dead ? smoothing : undefined,
    }));
  });
}

function peakOf(channel: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  return peak;
}

/**
 * Renders notes of one part to stereo audio of exactly `lengthFrames`. Notes past the end are cut off. The part is scaled down as a whole
 * if its peak exceeds -1 dBFS, and the factor is returned, so the caller can tell how much the part was pulled down.
 */
export function renderPart(
  notes: readonly NoteEvent[],
  kind: "drums" | "bass",
  samples: SampleSet,
  lengthFrames: number,
  sampleRate = RENDER_RATE,
): RenderedPart {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const voices = (kind === "drums" ? drumVoices(sorted, samples, sampleRate) : bassVoices(sorted, samples, sampleRate)).map(onAttack);
  const left = new Float32Array(lengthFrames);
  const right = new Float32Array(lengthFrames);
  for (const voice of voices) mixVoice(left, right, voice);
  const peak = Math.max(peakOf(left), peakOf(right));
  const gain = peak > PEAK_LIMIT ? PEAK_LIMIT / peak : 1;
  if (gain < 1) {
    for (let i = 0; i < lengthFrames; i++) {
      left[i] *= gain;
      right[i] *= gain;
    }
  }
  return { audio: { sampleRate, channels: [left, right] }, gain };
}
