import { describe, expect, it } from "vitest";
import { highPass, normalisePeak } from "./lyrics-input";

const RATE = 16000;

/** RMS of the second half of `samples`, so the filter's start-up is left out. */
function settledRms(samples: Float32Array): number {
  const half = samples.subarray(samples.length / 2);
  return Math.sqrt(half.reduce((sum, x) => sum + x * x, 0) / half.length);
}

function sine(hz: number): Float32Array {
  return Float32Array.from({ length: RATE * 2 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / RATE));
}

describe("highPass", () => {
  it("removes rumble well below 80 Hz and keeps voice-range tone", () => {
    expect(settledRms(highPass(sine(30), RATE))).toBeLessThan(0.1);
    expect(settledRms(highPass(sine(440), RATE))).toBeGreaterThan(0.6);
  });

  it("returns a new array and leaves the input alone", () => {
    const input = sine(440);
    const copy = Float32Array.from(input);
    const out = highPass(input, RATE);
    expect(out).not.toBe(input);
    expect(input).toEqual(copy);
  });
});

describe("normalisePeak", () => {
  it("scales the loudest sample to -1 dBFS", () => {
    const out = normalisePeak(Float32Array.from([0.1, -0.5, 0.25]));
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(10 ** (-1 / 20), 5);
    expect(out[0]).toBeCloseTo(0.1 * (10 ** (-1 / 20) / 0.5), 5);
  });

  it("leaves silence as silence", () => {
    expect(Array.from(normalisePeak(new Float32Array(4)))).toEqual([0, 0, 0, 0]);
  });
});
