import { describe, expect, it } from "vitest";
import { dropShortRuns, frameLevels, hangover, ownedSpans, singingRegions, transcriptionWindows, voicedFrames, voicedRegions } from "./vocal-activity";

const RATE = 16000;

/** `seconds` of a sine at `amplitude`, or silence when amplitude is 0. */
function tone(seconds: number, amplitude: number): number[] {
  return Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE));
}

describe("frameLevels", () => {
  it("reads silence as very quiet and a sine at 0.5 as about -9 dBFS", () => {
    const levels = frameLevels(Float32Array.from([...tone(0.05, 0), ...tone(0.05, 0.5)]), RATE);
    expect(levels[0]).toBeLessThan(-150);
    expect(levels[1]).toBeCloseTo(-9.03, 0);
  });
});

describe("voicedFrames", () => {
  it("needs a frame to clear the floor and sit within the range of the stem's loud level", () => {
    expect(voicedFrames([-60, -20, -30, -50])).toEqual([false, true, true, false]);
    expect(voicedFrames([-10, -40])).toEqual([true, false]);
  });

  it("is not set by one loud transient: quiet singing around it is still voiced", () => {
    const verse = Array(99).fill(-35);
    expect(voicedFrames([...verse, -1]).every(Boolean)).toBe(true);
  });
});

describe("hangover", () => {
  it("holds each voiced run for the given number of frames", () => {
    expect(hangover([true, false, false, false, false], 3)).toEqual([true, true, true, false, false]);
  });
});

describe("dropShortRuns and voicedRegions", () => {
  it("drops islands shorter than the minimum and keeps the rest", () => {
    const frames = [...Array(10).fill(true), false, false, ...Array(5).fill(true)];
    expect(dropShortRuns(frames, 8).slice(10)).toEqual([false, false, false, false, false, false, false]);
    expect(voicedRegions(frames, 8)).toHaveLength(1);
  });

  it("gives times in seconds", () => {
    const [region] = voicedRegions([false, ...Array(10).fill(true)], 8);
    expect(region.start).toBeCloseTo(0.05);
    expect(region.end).toBeCloseTo(0.55);
  });
});

describe("singingRegions", () => {
  it("finds one sung phrase, held a little past its end, and ignores a click shorter than the minimum", () => {
    const samples = Float32Array.from([
      ...tone(2, 0),
      ...tone(3, 0.3),
      ...tone(2, 0),
      ...tone(0.2, 0.3),
      ...tone(2, 0),
    ]);
    const regions = singingRegions(samples, RATE);
    expect(regions).toHaveLength(1);
    expect(regions[0].start).toBeCloseTo(2, 1);
    expect(regions[0].end).toBeGreaterThan(5);
    expect(regions[0].end).toBeLessThan(5.5);
  });

  it("finds nothing in silence", () => {
    expect(singingRegions(Float32Array.from(tone(3, 0)), RATE)).toEqual([]);
  });
});

describe("transcriptionWindows", () => {
  it("pads each region and joins neighbours while the window stays within 30 s", () => {
    expect(
      transcriptionWindows(
        [
          { start: 0, end: 5 },
          { start: 6, end: 8 },
        ],
        20,
      ),
    ).toEqual([{ start: 0, end: 8.3 }]);
  });

  it("keeps far-apart regions in separate windows", () => {
    const windows = transcriptionWindows(
      [
        { start: 0, end: 5 },
        { start: 40, end: 45 },
      ],
      50,
    );
    expect(windows).toEqual([
      { start: 0, end: 5.3 },
      { start: 39.7, end: 45.3 },
    ]);
  });

  it("splits a region longer than 30 s with a 2 s overlap, and never runs past the song", () => {
    expect(transcriptionWindows([{ start: 0, end: 40 }], 40)).toEqual([
      { start: 0, end: 30 },
      { start: 28, end: 40 },
    ]);
    expect(transcriptionWindows([{ start: 9, end: 10 }], 10)).toEqual([{ start: 8.7, end: 10 }]);
  });
});

describe("ownedSpans", () => {
  it("splits each overlap at its midpoint, so every time belongs to exactly one window", () => {
    expect(
      ownedSpans([
        { start: 0, end: 30 },
        { start: 28, end: 40 },
        { start: 38, end: 50 },
      ]),
    ).toEqual([
      { start: -Infinity, end: 29 },
      { start: 29, end: 39 },
      { start: 39, end: Infinity },
    ]);
  });
});
