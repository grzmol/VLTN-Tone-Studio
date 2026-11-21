import { describe, expect, it } from "vitest";
import type { BeatGrid } from "../band/beat-grid";
import { gridAtOctave, needsTempoDetection, readTempoSource, tempoFromGrid, tempoOctaves } from "./tempo-source";
import { halveTempo, doubleTempo } from "../band/beat-grid";

describe("readTempoSource", () => {
  it("reads a recorded source", () => {
    expect(readTempoSource({ tempoSource: "manual" })).toBe("manual");
    expect(readTempoSource({ tempoSource: "detected" })).toBe("detected");
  });

  it("treats anything else as no source", () => {
    expect(readTempoSource({})).toBeNull();
    expect(readTempoSource({ tempoSource: "guess" })).toBeNull();
    expect(readTempoSource({ tempoSource: 120 })).toBeNull();
    expect(readTempoSource(null)).toBeNull();
    expect(readTempoSource("manual")).toBeNull();
  });
});

describe("needsTempoDetection", () => {
  it("detects a song with no saved tempo", () => {
    expect(needsTempoDetection("", null)).toBe(true);
  });

  it("detects the legacy 120 default with no source", () => {
    expect(needsTempoDetection("120", null)).toBe(true);
  });

  it("does not detect a tempo that was saved as a real value", () => {
    expect(needsTempoDetection("98", null)).toBe(false);
  });

  it("does not detect a 120 that the performer set", () => {
    expect(needsTempoDetection("120", "manual")).toBe(false);
    expect(needsTempoDetection("120", "tap")).toBe(false);
  });
});

describe("tempoFromGrid", () => {
  const beats = (count: number, interval: number, first = 0.5) => Array.from({ length: count }, (_, i) => first + i * interval);
  const grid = (over: Partial<BeatGrid>): BeatGrid => ({ beatsPerBar: 4, beats: beats(16, 0.6), downbeat: 0, bpm: 100, steady: null, ...over });

  it("takes the straight-line fit for a steady grid", () => {
    expect(tempoFromGrid(grid({ bpm: 99.7, steady: { bpm: 98.04, firstBeat: 0.5 } }))).toEqual({ bpm: 98, firstBeat: 0.5, steady: true });
  });

  it("uses the median interval and the downbeat for an unsteady grid", () => {
    expect(tempoFromGrid(grid({ bpm: 101.23, downbeat: 2 }))).toEqual({ bpm: 101.2, firstBeat: 0.5 + 2 * 0.6, steady: false });
  });

  it("gives nothing for a grid under eight beats", () => {
    expect(tempoFromGrid(grid({ beats: beats(7, 0.5) }))).toBeNull();
  });

  it("keeps the tempo in the song range", () => {
    expect(tempoFromGrid(grid({ bpm: 350 }))?.bpm).toBe(300);
    expect(tempoFromGrid(grid({ bpm: 12 }))?.bpm).toBe(30);
  });
});

describe("tempoOctaves", () => {
  it("offers the half and the double of a detected tempo", () => {
    expect(tempoOctaves(140)).toEqual([70, 280]);
  });

  it("rounds to 0.1 BPM", () => {
    expect(tempoOctaves(97.3)).toEqual([48.7, 194.6]);
  });

  it("drops a tempo outside the song range", () => {
    expect(tempoOctaves(40)).toEqual([80]);
    expect(tempoOctaves(200)).toEqual([100]);
  });
});

describe("gridAtOctave", () => {
  const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.5);
  const grid: BeatGrid = { beatsPerBar: 4, beats, downbeat: 0, bpm: 120, steady: null };

  it("halves a grid when the tempo goes down, and doubles it when it goes up", () => {
    expect(gridAtOctave(grid, 120, 60)).toEqual(halveTempo(grid));
    expect(gridAtOctave(grid, 120, 240)).toEqual(doubleTempo(grid));
  });

  it("leaves the grid alone for the same tempo", () => {
    expect(gridAtOctave(grid, 120, 120)).toBe(grid);
  });
});
