import { describe, expect, it } from "vitest";
import { detectPitch, noteOf } from "./tuner-pitch";

const SR = 48000;
const tone = (hz: number, n = 4096) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / SR) + 0.2 * Math.sin((2 * Math.PI * 2 * hz * i) / SR));

describe("detectPitch", () => {
  it.each([82.41, 110, 196, 329.63, 1000])("finds %s Hz", (hz) => {
    expect(detectPitch(tone(hz), SR)).toBeCloseTo(hz, 0);
  });
  it("says nothing for silence", () => {
    expect(detectPitch(new Float32Array(4096), SR)).toBeNull();
  });
});

describe("noteOf", () => {
  it("names the note and the cents off", () => {
    expect(noteOf(440)).toEqual({ name: "A4", cents: 0 });
    expect(noteOf(82.41)).toEqual({ name: "E2", cents: 0 });
    expect(noteOf(446)).toEqual({ name: "A4", cents: 23 });
    expect(noteOf(110, 442).cents).toBeLessThan(0);
  });
});
