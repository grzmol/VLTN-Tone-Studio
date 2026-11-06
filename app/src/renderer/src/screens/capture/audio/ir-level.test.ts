import { describe, expect, it } from "vitest";
import { IR_LEVEL_LIMIT_DB, irLevelGain, rms } from "./ir-level";

const RATE = 48000;

/** Direct convolution, the same maths the convolver does, for the test's own IRs. */
function convolve(signal: Float32Array, ir: Float32Array): Float32Array {
  const out = new Float32Array(signal.length);
  for (let n = 0; n < signal.length; n++) {
    let sum = 0;
    for (let k = 0; k < ir.length && k <= n; k++) sum += ir[k] * signal[n - k];
    out[n] = sum;
  }
  return out;
}

/** A 55 Hz bass note with a second harmonic, `frames` long. */
function bassNote(frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = 0.4 * Math.sin((2 * Math.PI * 55 * i) / RATE) + 0.15 * Math.sin((2 * Math.PI * 110 * i) / RATE);
  return out;
}

/** A seeded noise IR that decays over `length` samples: a stand-in for a cab's response, not a real recording. */
function decayingNoiseIr(length: number, seed = 7): Float32Array {
  let state = seed;
  const ir = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const noise = state / 0xffffffff - 0.5;
    ir[i] = noise * Math.exp(-i / (length / 6));
  }
  return ir;
}

const dbOf = (ratio: number) => 20 * Math.log10(ratio);
const levelDiffDb = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.abs(dbOf(rms(a) / rms(b)));

/** The output of the IR path: the convolved signal scaled by the level-match gain, as the offline render does it. */
function matched(signal: Float32Array, ir: Float32Array): { wet: Float32Array; out: Float32Array } {
  const wet = convolve(signal, ir);
  const gain = irLevelGain(signal, wet);
  return { wet, out: wet.map((v) => v * gain) };
}

describe("irLevelGain", () => {
  it("leaves the level within 0.5 dB for a unit impulse, the IR that changes nothing", () => {
    const dry = bassNote(RATE / 4);
    const impulse = new Float32Array(1024);
    impulse[0] = 1;
    const { out } = matched(dry, impulse);
    expect(levelDiffDb(out, dry)).toBeLessThan(0.5);
  });

  it("brings a quiet IR back to the input's level, within the limit", () => {
    const dry = bassNote(RATE / 4);
    const quiet = new Float32Array(1024);
    quiet[0] = 10 ** (-20 / 20);
    const { wet, out } = matched(dry, quiet);
    expect(levelDiffDb(wet, dry)).toBeGreaterThan(15);
    expect(levelDiffDb(out, dry)).toBeLessThan(0.5);
  });

  it("stops at the limit for an IR that is quieter than the limit allows", () => {
    const dry = bassNote(RATE / 4);
    const very = new Float32Array(1024);
    very[0] = 10 ** (-29 / 20);
    const { wet, out } = matched(dry, very);
    expect(levelDiffDb(out, dry)).toBeCloseTo(29 - IR_LEVEL_LIMIT_DB, 0);
    expect(levelDiffDb(wet, dry)).toBeCloseTo(29, 0);
  });

  it("keeps the RMS within 1 dB for a decaying-noise IR, and the same IR without matching is well off", () => {
    const dry = bassNote(RATE / 2);
    const ir = decayingNoiseIr(1024);
    const { wet, out } = matched(dry, ir);
    expect(levelDiffDb(out, dry)).toBeLessThan(1);
    expect(levelDiffDb(wet, dry)).toBeGreaterThan(1);
  });

  it("is 1 when the input is silent, so an IR over silence changes nothing", () => {
    const silent = new Float32Array(4800);
    expect(irLevelGain(silent, decayingNoiseIr(256))).toBe(1);
    expect(irLevelGain(bassNote(4800), new Float32Array(4800))).toBe(1);
  });

  it("clamps the correction to the limit either way", () => {
    const limit = 10 ** (IR_LEVEL_LIMIT_DB / 20);
    const loud = new Float32Array(100).fill(0.5);
    const faint = new Float32Array(100).fill(1e-4);
    expect(irLevelGain(loud, faint)).toBeCloseTo(limit, 6);
    expect(irLevelGain(faint, loud)).toBeCloseTo(1 / limit, 6);
  });

  it("measures RMS over every sample", () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 6);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});
