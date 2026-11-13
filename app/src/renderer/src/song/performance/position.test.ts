import { describe, expect, it } from "vitest";
import type { BeatGrid } from "../band/beat-grid";
import type { Cue } from "./chart";
import { barAndBeat, barsUntil, patchCues, patchNext, patchNow, patchText, steadyGrid } from "./position";

/** 120 BPM in 4/4: a bar every 2 s, 40 beats (20 s). */
const grid: BeatGrid = { beatsPerBar: 4, beats: Array.from({ length: 40 }, (_, i) => i * 0.5), downbeat: 0, bpm: 120, steady: null };

describe("barsUntil", () => {
  it("is 8 at the start of a section of 8 bars", () => {
    expect(barsUntil(grid, 0, 16)).toBe(8);
  });

  it("counts down on each bar and is 1 one beat before the end", () => {
    expect(barsUntil(grid, 1.9, 16)).toBe(8);
    expect(barsUntil(grid, 2, 16)).toBe(7);
    expect(barsUntil(grid, 14, 16)).toBe(1);
    expect(barsUntil(grid, 15.5, 16)).toBe(1);
  });

  it("counts a section that ends part way into a bar as one more bar", () => {
    expect(barsUntil(grid, 0, 17)).toBe(9);
  });

  it("follows bar lines that move", () => {
    // Beats 0, 4, 7 and 11 start bars: bar lines at 0 s, 2 s, 3.5 s and 5.5 s.
    const moving = { ...grid, barStarts: [0, 4, 7, 11] };
    expect(barsUntil(moving, 0, 5.5)).toBe(3);
    expect(barsUntil(moving, 2, 5.5)).toBe(2);
    expect(barsUntil(moving, 3.5, 5.5)).toBe(1);
  });

  it("is null without a grid", () => {
    expect(barsUntil(null, 0, 16)).toBeNull();
    expect(barsUntil({ ...grid, beats: [] }, 0, 16)).toBeNull();
  });
});

describe("barAndBeat", () => {
  it("counts bars and beats from 1", () => {
    expect(barAndBeat(grid, 0)).toEqual({ bar: 1, beat: 1 });
    expect(barAndBeat(grid, 5.2)).toEqual({ bar: 3, beat: 3 });
  });

  it("is null before the first beat and without a grid", () => {
    expect(barAndBeat({ ...grid, beats: grid.beats.map((b) => b + 1) }, 0.5)).toBeNull();
    expect(barAndBeat(null, 3)).toBeNull();
  });
});

describe("steadyGrid", () => {
  it("lays beats from the first beat to the end of the song", () => {
    const steady = steadyGrid(120, 4, 0.25, 4)!;
    expect(steady.beats.slice(0, 3)).toEqual([0.25, 0.75, 1.25]);
    expect(barsUntil(steady, 0.25, 4.25)).toBe(2);
  });

  it("is null without a tempo or a length", () => {
    expect(steadyGrid(0, 4, 0, 10)).toBeNull();
    expect(steadyGrid(120, 4, 0, 0)).toBeNull();
  });
});

describe("patch cues", () => {
  const recall = (time: number, slot: number, label?: string): Cue => ({
    time,
    text: "",
    label,
    messages: [
      [0xbf, 0, 0],
      [0xcf, slot],
    ],
  });
  const cues = [recall(30, 13, "GP-180: 014 Lead"), recall(5, 10, "GP-180: 011 Crunch"), recall(50, 20), { time: 8, text: "", messages: [[0xb0, 7, 100]] }];
  const patches = patchCues(cues);

  it("keeps only memory recalls, in time order", () => {
    expect(patches.map((p) => p.time)).toEqual([5, 30, 50]);
  });

  it("finds the memory the pedal is on and the one to come", () => {
    expect(patchNow(patches, 4)).toBeNull();
    expect(patchText(patchNow(patches, 10)!)).toBe("011 Crunch");
    expect(patchText(patchNext(patches, 10)!)).toBe("014 Lead");
    expect(patchNext(patches, 60)).toBeNull();
  });

  it("shows only the number when the cue has no name", () => {
    expect(patchText(patches[2])).toBe("021");
  });
});
