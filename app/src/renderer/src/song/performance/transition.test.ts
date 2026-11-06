import { describe, expect, it } from "vitest";
import { HANDOVER_LEAD_S, audibleRange, clampCrossfade, equalPowerCurve, planTransition, playRange } from "./transition";

describe("clampCrossfade", () => {
  it("keeps the setting between 0 and 10 seconds, and treats junk as no crossfade", () => {
    expect(clampCrossfade(-2)).toBe(0);
    expect(clampCrossfade(4.5)).toBe(4.5);
    expect(clampCrossfade(99)).toBe(10);
    expect(clampCrossfade(Number.NaN)).toBe(0);
  });
});

describe("equalPowerCurve", () => {
  it("runs from silence to full and back, and keeps the power of the two curves at one", () => {
    const out = equalPowerCurve("out");
    const into = equalPowerCurve("in");
    expect(out[0]).toBeCloseTo(1);
    expect(out.at(-1)).toBeCloseTo(0);
    expect(into[0]).toBeCloseTo(0);
    expect(into.at(-1)).toBeCloseTo(1);
    for (let i = 0; i < out.length; i++) expect(out[i] ** 2 + into[i] ** 2).toBeCloseTo(1);
  });
});

describe("playRange", () => {
  it("is the whole file without a trim, and clamps a trim to the file", () => {
    expect(playRange(180, {})).toEqual({ start: 0, end: 180 });
    expect(playRange(180, { trimStart: 4, trimEnd: 120 })).toEqual({ start: 4, end: 120 });
    expect(playRange(180, { trimStart: -3, trimEnd: 999 })).toEqual({ start: 0, end: 180 });
    expect(playRange(180, { trimStart: 300 })).toEqual({ start: 180, end: 180 });
  });
});

describe("audibleRange", () => {
  it("finds the first and last moment above the level, across channels", () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    left[20] = 0.5;
    right[80] = -0.25;
    expect(audibleRange([left, right], 10)).toEqual({ start: 2, end: 8.1 });
  });

  it("ignores audio below -60 dBFS, and reports a silent song as null", () => {
    const quiet = new Float32Array(50).fill(0.0005);
    expect(audibleRange([quiet], 10)).toBeNull();
    expect(audibleRange([new Float32Array(0)], 10)).toBeNull();
  });
});

describe("planTransition", () => {
  const base = { now: 100, songEnd: 110, ready: true, countIn: false };

  it("joins gaplessly at the outgoing song's end when there is no crossfade", () => {
    expect(planTransition({ ...base, crossfade: 0 })).toEqual({ kind: "gapless", startAt: 110, fadeLength: 0, stopAt: 110 });
  });

  it("starts the incoming song early so the crossfade ends with the outgoing song", () => {
    expect(planTransition({ ...base, crossfade: 4 })).toEqual({ kind: "crossfade", startAt: 106, fadeLength: 4, stopAt: 110 });
  });

  it("turns the crossfade off for a count-in, which begins at the outgoing song's end", () => {
    expect(planTransition({ ...base, crossfade: 4, countIn: true })).toEqual({ kind: "countIn", startAt: 110, fadeLength: 0, stopAt: 110 });
  });

  it("starts a manual crossfade now, and the outgoing song stops when the crossfade ends", () => {
    expect(planTransition({ ...base, crossfade: 3, manual: true })).toEqual({
      kind: "crossfade",
      startAt: 100 + HANDOVER_LEAD_S,
      fadeLength: 3,
      stopAt: 103.5,
    });
  });

  it("falls back to a gap when the next song is not ready", () => {
    expect(planTransition({ ...base, crossfade: 0, ready: false })).toMatchObject({ kind: "gap" });
  });

  it("falls back to a gap when the join cannot be scheduled in time", () => {
    expect(planTransition({ ...base, now: 109.9, crossfade: 0 })).toMatchObject({ kind: "gap" });
    expect(planTransition({ ...base, crossfade: 9.9 })).toMatchObject({ kind: "gap" });
  });
});
