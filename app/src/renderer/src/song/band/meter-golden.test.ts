import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections, type BandSettings } from "./arrangement";
import { generateBass } from "./bass";
import type { BeatGrid } from "./beat-grid";
import { generateDrums } from "./drums";
import { parseChordName, type ChordAtBeat } from "./harmony";
import type { StyleId } from "./styles/types";
import type { Section } from "../performance/sections";
import golden from "./meter-golden.snapshot.json";

// Golden notes for styles whose meter differs from the grid's: six-eight (two dotted beats, six steps) on a four-beat and a two-beat grid,
// and shuffle (three steps to the beat) on a four-beat grid. They pin what these songs played before spec 131, so a change to how a style
// is fitted to a bar cannot move them. Run with UPDATE_GOLDEN=1 to write the file again; only do that for a change meant to alter them.

const BARS = 16;

function gridOf(beatsPerBar: number): BeatGrid {
  const beats = Array.from({ length: BARS * beatsPerBar }, (_, i) => i * 0.5);
  return { beatsPerBar, beats, downbeat: 0, bpm: 120, steady: null };
}

function notesFor(style: StyleId, beatsPerBar: number) {
  const grid = gridOf(beatsPerBar);
  const bar = beatsPerBar * 0.5;
  const sections: Section[] = [
    { id: "a", name: "Verse", start: 0, end: 8 * bar, mode: "continue" },
    { id: "b", name: "Chorus", start: 8 * bar, end: BARS * bar, mode: "continue" },
  ];
  const settings: BandSettings = {
    ...DEFAULT_BAND_SETTINGS,
    style,
    complexity: 1,
    swing: 0,
    ghostNotes: true,
    crashOnSections: true,
    lockToKick: false,
    sections: { a: { fill: true }, b: { energy: 4 } },
  };
  const plans = planSections(sections, BARS * bar, settings);
  const names = ["C", "Am", "F", "G"];
  const harmony: ChordAtBeat[] = grid.beats.map((time, beat) => ({ beat, time, chord: parseChordName(names[Math.floor(beat / beatsPerBar) % 4]) }));
  return { drums: generateDrums(grid, plans, settings, 11), bass: generateBass(grid, harmony, plans, settings, [], 11) };
}

const CASES: [StyleId, number][] = [
  ["six-eight", 4],
  ["six-eight", 2],
  ["shuffle", 4],
];

describe("notes of styles whose meter differs from the grid's", () => {
  const actual = Object.fromEntries(CASES.map(([style, beats]) => [`${style} on ${beats} beats`, notesFor(style, beats)]));

  it("matches the golden notes", () => {
    if (process.env.UPDATE_GOLDEN) writeFileSync(join(__dirname, "meter-golden.snapshot.json"), JSON.stringify(actual));
    expect(JSON.parse(JSON.stringify(actual))).toEqual(golden);
  });
});
