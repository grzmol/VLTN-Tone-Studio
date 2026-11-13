// "Standard, heavier" (spec 133): the second drum kit is the standard kit's recordings, voiced heavier here, so it makes no claim to be
// another kit. The kick gets a low sine thump and a short click, and the snare a bright shelf. The toms are transposed in map.json, and the
// kit's room is set by its `roomScale` (band-job.ts). Pure functions of the audio, run once when the kit loads.

import type { PcmAudio } from "../types";

/** The kick's added thump: a sine at this pitch that decays with this time constant, at this share of the sample's own peak. */
export const THUMP_HZ = 60;
export const THUMP_DECAY_SECONDS = 0.04;
export const THUMP_LEVEL = 0.5;
/** The kick's added click: a short burst at this pitch, for the beater's attack. */
export const CLICK_HZ = 3000;
export const CLICK_DECAY_SECONDS = 0.002;
export const CLICK_LEVEL = 0.25;
/** The thump needs this long to ring out, so a short kick sample is made at least this long. */
const MIN_KICK_SECONDS = 0.25;

/** The snare's shelf: this many dB more above this frequency. */
export const SNARE_SHELF_HZ = 4000;

function peakOf(audio: PcmAudio): number {
  let peak = 0;
  for (const channel of audio.channels) for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  return peak;
}

/** The kick with a 60 Hz thump (40 ms decay) and a 3 kHz click added to every channel, each scaled to the sample's own peak. */
export function thumpKick(audio: PcmAudio): PcmAudio {
  const rate = audio.sampleRate;
  const peak = peakOf(audio);
  const frames = Math.max(audio.channels[0]?.length ?? 0, Math.round(MIN_KICK_SECONDS * rate));
  const channels = audio.channels.map((channel) => {
    const out = new Float32Array(frames);
    out.set(channel);
    for (let i = 0; i < frames; i++) {
      const t = i / rate;
      out[i] += peak * THUMP_LEVEL * Math.sin(2 * Math.PI * THUMP_HZ * t) * Math.exp(-t / THUMP_DECAY_SECONDS);
      out[i] += peak * CLICK_LEVEL * Math.sin(2 * Math.PI * CLICK_HZ * t) * Math.exp(-t / CLICK_DECAY_SECONDS);
    }
    return out;
  });
  return { sampleRate: rate, channels };
}

/** A high shelf (RBJ cookbook, slope 1) as one biquad: normalised coefficients [b0, b1, b2, a1, a2]. */
function highShelf(gainDb: number, hz: number, rate: number): [number, number, number, number, number] {
  const a = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.SQRT2;
  const root = 2 * Math.sqrt(a) * alpha;
  const a0 = a + 1 - (a - 1) * cos + root;
  return [
    (a * (a + 1 + (a - 1) * cos + root)) / a0,
    (-2 * a * (a - 1 + (a + 1) * cos)) / a0,
    (a * (a + 1 + (a - 1) * cos - root)) / a0,
    (2 * (a - 1 - (a + 1) * cos)) / a0,
    (a + 1 - (a - 1) * cos - root) / a0,
  ];
}

/** The audio with its highs above `hz` raised by `gainDb`. */
export function brightSnare(audio: PcmAudio, gainDb: number, hz = SNARE_SHELF_HZ): PcmAudio {
  const [b0, b1, b2, a1, a2] = highShelf(gainDb, hz, audio.sampleRate);
  const channels = audio.channels.map((channel) => {
    const out = new Float32Array(channel.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < channel.length; i++) {
      const x = channel[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
    }
    return out;
  });
  return { sampleRate: audio.sampleRate, channels };
}
