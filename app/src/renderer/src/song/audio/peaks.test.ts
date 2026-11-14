import { beforeEach, expect, it } from "vitest";
import { cachedPeaks, clearPeakCache, peakBuckets, scaledToOwnPeak } from "./peaks";

beforeEach(clearPeakCache);

it("finds the peaks of a known ramp", () => {
  const ramp = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
  const out = cachedPeaks("ramp", [ramp], 200);
  expect(out.length).toBe(200);
  expect(out[0]).toBeCloseTo(4 / 1000, 5);
  expect(out[199]).toBeCloseTo(999 / 1000, 5);
  for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
});

it("takes the larger side of a stereo pair, in absolute value", () => {
  const out = cachedPeaks("stereo", [Float32Array.from([0.1, 0.1]), Float32Array.from([-0.5, 0.2])], 200);
  expect(out[0]).toBeCloseTo(0.5, 5);
});

it("keeps the peaks per song and width bucket", () => {
  const audio = [new Float32Array(1000)];
  const a = cachedPeaks("a", audio, 600);
  expect(cachedPeaks("a", audio, 590)).toBe(a);
  expect(cachedPeaks("b", audio, 600)).not.toBe(a);
  expect(peakBuckets(1)).toBe(200);
  expect(peakBuckets(601)).toBe(800);
  expect(peakBuckets(99999)).toBe(2000);
});

it("scales a track to its own peak and leaves silence flat", () => {
  expect(Array.from(scaledToOwnPeak(Float32Array.from([0.1, 0.05, 0.025])))).toEqual([1, 0.5, 0.25].map((v) => expect.closeTo(v, 5)));
  expect(Array.from(scaledToOwnPeak(Float32Array.from([0.001, 0.002])))).toEqual([0, 0]);
  expect(scaledToOwnPeak(new Float32Array(0)).length).toBe(0);
});
