import { describe, expect, it } from "vitest";
import { estimateOffset, offsetOf, pingSample, roundTripOf, type PingSample } from "./clock-offset";

/**
 * A ping sent at `t0` on the follower's clock, to a server whose clock runs `skew` ms ahead. Each way takes `out` and `back` ms, and the
 * server answers at once.
 */
function sample(t0: number, skew: number, out: number, back: number): PingSample {
  const t1 = t0 + out + skew;
  const t2 = t1;
  return { t0, t1, t2, t3: t2 - skew + back };
}

describe("clock offset", () => {
  it("is exact when the two ways take the same time", () => {
    const s = sample(1000, 250, 20, 20);
    expect(offsetOf(s)).toBe(250);
    expect(roundTripOf(s)).toBe(40);
  });

  it("is off by half the difference when the ways are uneven", () => {
    const s = sample(0, 0, 10, 90);
    expect(offsetOf(s)).toBe(-40);
    expect(roundTripOf(s)).toBe(100);
  });

  it("builds a sample from a pong and the arrival time", () => {
    expect(pingSample({ t0: 5, t1: 25, t2: 26 }, 45)).toEqual({ t0: 5, t1: 25, t2: 26, t3: 45 });
  });

  it("is null when there are no samples", () => {
    expect(estimateOffset([])).toBeNull();
  });

  it("finds the skew through jitter, from the fastest replies", () => {
    const skew = 1200;
    const samples = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => sample(i * 200, skew, 15 + i, 15 + i));
    const estimate = estimateOffset(samples);
    expect(estimate?.offset).toBeCloseTo(skew, 6);
    expect(estimate?.rtt).toBe(30);
    expect(estimate?.samples).toBe(8);
  });

  it("ignores slow, lopsided replies: they are not among the fastest", () => {
    const skew = 500;
    const good = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => sample(i * 200, skew, 10, 10));
    // Slow replies with a badly skewed one-way delay would pull a plain average far off.
    const slow = [0, 1, 2, 3].map((i) => sample(2000 + i * 200, skew, 300, 5));
    const estimate = estimateOffset([...slow, ...good]);
    expect(estimate?.offset).toBeCloseTo(skew, 6);
  });

  it("takes the median, so one odd sample among the fastest does not move it", () => {
    const skew = 800;
    const fast = [0, 1, 2, 3, 4, 5, 6].map((i) => sample(i * 100, skew, 10, 10));
    // An eighth fast sample with a wrong skew: the median still follows the seven that agree.
    const odd = sample(900, skew + 300, 10, 10);
    expect(roundTripOf(odd)).toBe(20);
    expect(offsetOf(odd)).toBe(skew + 300);
    const estimate = estimateOffset([...fast, odd]);
    expect(estimate?.offset).toBeCloseTo(skew, 6);
  });

  it("uses only the fastest samples given by `keep`", () => {
    const samples = [sample(0, 100, 50, 50), sample(10, 100, 5, 5), sample(20, 100, 5, 5), sample(30, 100, 60, 60)];
    const estimate = estimateOffset(samples, 2);
    expect(estimate?.samples).toBe(2);
    expect(estimate?.rtt).toBe(10);
  });

  it("drops a sample whose round trip is negative, such as a clock that went back", () => {
    const backwards: PingSample = { t0: 100, t1: 90, t2: 200, t3: 100 };
    expect(roundTripOf(backwards)).toBeLessThan(0);
    expect(estimateOffset([backwards])).toBeNull();
    const estimate = estimateOffset([backwards, sample(0, 40, 10, 10)]);
    expect(estimate?.offset).toBe(40);
  });

  it("drops a sample with a time that is not a finite number", () => {
    expect(estimateOffset([{ t0: 0, t1: Number.NaN, t2: 0, t3: 10 }])).toBeNull();
  });
});
