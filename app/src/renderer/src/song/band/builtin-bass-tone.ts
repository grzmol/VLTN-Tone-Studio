// The built-in bass tone, "Warm" (spec 136): a fixed chain in code, so a bass that needs no download is more than a bare DI. In order:
// a 35 Hz high-pass, a soft-knee compressor (4:1, 10 ms attack, 120 ms release, about 6 dB of gain reduction on loud notes), a gentle tanh
// saturation, a 3 dB dip at 400 Hz and a 4.5 kHz low-pass. Pure DSP on the samples as they are: nothing is looked ahead, so it adds no latency,
// and the same audio always gives the same result.

import type { PcmAudio } from "../types";

export const HIGH_PASS_HZ = 35;
export const LOW_PASS_HZ = 4500;
export const DIP_HZ = 400;
export const DIP_DB = -3;
const COMPRESSOR = { ratio: 4, thresholdDb: -12, kneeDb: 6, attackS: 0.01, releaseS: 0.12 };
/** Saturation drive. tanh(drive × x) / drive leaves small signals at their own level and rounds off the loud ones. */
const DRIVE = 1.5;
const BUTTERWORTH_Q = Math.SQRT1_2;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** A biquad from the Audio EQ Cookbook, with its coefficients divided by a0. */
function biquad(kind: "highpass" | "lowpass" | "peaking", rate: number, hz: number, q: number, gainDb = 0): Biquad {
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a = 10 ** (gainDb / 40);
  let b: [number, number, number];
  let denominator: [number, number, number];
  if (kind === "peaking") {
    b = [1 + alpha * a, -2 * cos, 1 - alpha * a];
    denominator = [1 + alpha / a, -2 * cos, 1 - alpha / a];
  } else {
    b = kind === "highpass" ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    denominator = [1 + alpha, -2 * cos, 1 - alpha];
  }
  return {
    b0: b[0] / denominator[0],
    b1: b[1] / denominator[0],
    b2: b[2] / denominator[0],
    a1: denominator[1] / denominator[0],
    a2: denominator[2] / denominator[0],
  };
}

/** One channel through a biquad (direct form 1, in double precision). */
function filter(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** Gain reduction in dB for a level in dB: none below the knee, the full ratio above it, and a smooth bend between. */
function reductionDb(levelDb: number): number {
  const { ratio, thresholdDb, kneeDb } = COMPRESSOR;
  const over = levelDb - thresholdDb;
  const slope = 1 - 1 / ratio;
  if (2 * over < -kneeDb) return 0;
  if (2 * over > kneeDb) return slope * over;
  return (slope * (over + kneeDb / 2) ** 2) / (2 * kneeDb);
}

/**
 * The channel with a feed-forward compressor. The level is the peak of the sample, and the gain falls with the attack time and recovers
 * with the release time. Nothing is delayed, so the first few milliseconds of a note pass before the gain comes down on it, which keeps
 * the note's attack.
 */
function compress(input: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(input.length);
  const attack = Math.exp(-1 / (COMPRESSOR.attackS * rate));
  const release = Math.exp(-1 / (COMPRESSOR.releaseS * rate));
  let reduction = 0;
  for (let i = 0; i < input.length; i++) {
    const level = 20 * Math.log10(Math.max(Math.abs(input[i]), 1e-9));
    const wanted = reductionDb(level);
    const coefficient = wanted > reduction ? attack : release;
    reduction = coefficient * reduction + (1 - coefficient) * wanted;
    out[i] = input[i] * 10 ** (-reduction / 20);
  }
  return out;
}

function saturate(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = Math.tanh(DRIVE * input[i]) / DRIVE;
  return out;
}

/** The bass through the Warm chain. The result has the same rate, channels and length. */
export function warmBassTone(audio: PcmAudio): PcmAudio {
  const rate = audio.sampleRate;
  const highPass = biquad("highpass", rate, HIGH_PASS_HZ, BUTTERWORTH_Q);
  const dip = biquad("peaking", rate, DIP_HZ, 1, DIP_DB);
  const lowPass = biquad("lowpass", rate, LOW_PASS_HZ, BUTTERWORTH_Q);
  const channels = audio.channels.map((channel) => filter(filter(saturate(compress(filter(channel, highPass), rate)), dip), lowPass));
  return { sampleRate: rate, channels };
}
