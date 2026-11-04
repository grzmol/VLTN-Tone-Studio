import { describe, expect, it } from "vitest";
import { audioSeconds, clampRange, MIN_RANGE_SECONDS, sliceAudio } from "./range";
import type { PcmAudio } from "./types";

const ramp = (n: number, rate = 10): PcmAudio => ({ sampleRate: rate, channels: [Float32Array.from({ length: n }, (_, i) => i), Float32Array.from({ length: n }, (_, i) => -i)] });

describe("song range", () => {
  it("keeps a part inside the song", () => {
    expect(clampRange({ start: 30, end: 90 }, 200)).toEqual({ start: 30, end: 90 });
    expect(clampRange({ start: -4, end: 60 }, 200)).toEqual({ start: 0, end: 60 });
    expect(clampRange({ start: 150, end: 260 }, 200)).toEqual({ start: 150, end: 200 });
  });

  it("makes a part at least MIN_RANGE_SECONDS long", () => {
    expect(clampRange({ start: 40, end: 41 }, 200)).toEqual({ start: 40, end: 40 + MIN_RANGE_SECONDS });
    expect(clampRange({ start: 199, end: 200 }, 200)).toEqual({ start: 200 - MIN_RANGE_SECONDS, end: 200 });
  });

  it("is null for the whole song, or a song shorter than the shortest part", () => {
    expect(clampRange(null, 200)).toBeNull();
    expect(clampRange({ start: 0, end: 200 }, 200)).toBeNull();
    expect(clampRange({ start: -1, end: 300 }, 200)).toBeNull();
    expect(clampRange({ start: 1, end: 2 }, 3)).toBeNull();
  });

  it("slices the part's samples from every channel, without copying", () => {
    const audio = ramp(100);
    const part = sliceAudio(audio, { start: 2, end: 4.5 });
    expect(part.sampleRate).toBe(10);
    expect(Array.from(part.channels[0])).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44]);
    expect(part.channels[1][0]).toBe(-20);
    expect(part.channels[0].buffer).toBe(audio.channels[0].buffer);
    expect(audioSeconds(part)).toBe(2.5);
  });

  it("gives back the whole song for no range", () => {
    const audio = ramp(10);
    expect(sliceAudio(audio, null)).toBe(audio);
    expect(audioSeconds(audio)).toBe(1);
  });
});
