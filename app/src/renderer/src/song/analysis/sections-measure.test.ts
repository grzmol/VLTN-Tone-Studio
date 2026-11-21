import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import { detectSongSections, measureUnits, rmsOf, unitChroma } from "./sections-measure";
import { BAR_DETECT } from "./sections";

const RATE = 44100;

/** A constant-level sine of `hz` over `seconds`. */
function tone(hz: number, seconds: number, level = 0.5): PcmAudio {
  const channel = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < channel.length; i++) channel[i] = level * Math.sin((2 * Math.PI * hz * i) / RATE);
  return { sampleRate: RATE, channels: [channel] };
}

/** Two channels: the same signal in both, so the mono sum is the signal. */
function silence(seconds: number): PcmAudio {
  return { sampleRate: RATE, channels: [new Float32Array(Math.round(seconds * RATE))] };
}

describe("rmsOf", () => {
  it("is the RMS of a sine, and zero over an empty range", () => {
    expect(rmsOf(tone(440, 1, 0.5), 0, RATE)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(rmsOf(tone(440, 1), RATE, RATE)).toBe(0);
  });
});

describe("unitChroma", () => {
  it("puts the energy of an A440 tone in the A pitch class", () => {
    const { channels } = tone(440, 1);
    const chroma = unitChroma(channels[0], RATE, 0, RATE);
    expect(chroma.indexOf(Math.max(...chroma))).toBe(9);
  });

  it("puts the energy of a C4 tone in the C pitch class", () => {
    const { channels } = tone(261.63, 1);
    const chroma = unitChroma(channels[0], RATE, 0, RATE);
    expect(chroma.indexOf(Math.max(...chroma))).toBe(0);
  });
});

describe("measureUnits", () => {
  it("counts a unit as vocal only when the vocals stem is near the mix level", () => {
    const mix = tone(440, 4);
    // The vocals are present in the second two seconds only.
    const vocals = { sampleRate: RATE, channels: [new Float32Array(4 * RATE)] };
    vocals.channels[0].set(tone(660, 2, 0.5).channels[0], 2 * RATE);
    const units = measureUnits({
      mix,
      harmony: mix,
      vocals,
      spans: [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ],
      options: BAR_DETECT,
    });
    expect(units.map((u) => u.vocals)).toEqual([false, true]);
    expect(units[0].energy).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("counts every unit as vocal when there is no vocals stem", () => {
    const mix = tone(440, 2);
    const units = measureUnits({ mix, harmony: mix, vocals: null, spans: [{ start: 0, end: 2 }], options: BAR_DETECT });
    expect(units[0].vocals).toBe(true);
  });
});

describe("detectSongSections", () => {
  it("returns nothing for a silent song too short to hold two sections", () => {
    const mix = silence(4);
    expect(detectSongSections({ mix, harmony: mix, vocals: null, spans: [{ start: 0, end: 4 }], options: BAR_DETECT })).toEqual([]);
  });
});
