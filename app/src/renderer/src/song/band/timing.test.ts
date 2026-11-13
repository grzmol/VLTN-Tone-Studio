import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, type SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateDrums } from "./drums";
import { KICK, SNARE } from "./note";
import { findStyle } from "./styles";
import { stepAt, stepsForBar } from "./timing";

/** A grid of `count` beats, half a second apart, with three beats to the bar. */
const grid: BeatGrid = { beatsPerBar: 3, beats: Array.from({ length: 30 }, (_, i) => i * 0.5), downbeat: 0, bpm: 120, steady: null };
const rock = findStyle("rock")!;

describe("stepAt on a grid whose bar has another number of beats", () => {
  it("counts a bar's steps from the style's steps per beat", () => {
    expect(stepsForBar(rock, 3)).toBe(12);
    expect(stepsForBar(findStyle("six-eight")!, 2)).toBe(6);
  });

  it("puts step 4 of a sixteenth style exactly on beat 2, whatever the grid's bar length", () => {
    expect(stepAt(grid.beats, rock, 0, 4, 3, 0)).toEqual({ beat: 1, time: 0.5 });
    expect(stepAt(grid.beats, rock, 3, 6, 3, 0).time).toBeCloseTo(1.5 + 0.5 + 0.25, 9);
  });

  it("plays rock on a three-beat grid with the snare on beat 2 and no hit after beat 3", () => {
    const plan: SectionPlan = {
      sectionId: null,
      start: 0,
      end: 15,
      style: "rock",
      energy: 3,
      loud: 3,
      busy: 3,
      name: "",
      bassPart: "groove",
      bassRamp: false,
      octave: 0,
      fills: 0,
      hitTheOne: false,
      slides: false,
      deadNotes: false,
      pickups: true,
      fill: false,
      play: { drums: true, bass: true },
    };
    const notes = generateDrums(grid, [{ ...plan, energy: 2 }], { ...DEFAULT_BAND_SETTINGS, complexity: 1, swing: 0, crashOnSections: false }, 3);
    // A bar is 1.5 s. Rock's snare on step 4 is beat index 1 of each bar; the pattern's second backbeat (step 12) falls after beat 3 and is cut.
    for (let bar = 0; bar < 8; bar++) {
      const inBar = notes.filter((note) => note.time >= bar * 1.5 && note.time < (bar + 1) * 1.5);
      expect(inBar.some((note) => note.pitch === SNARE && note.time === bar * 1.5 + 0.5)).toBe(true);
      expect(inBar.some((note) => note.pitch === KICK && note.time === bar * 1.5)).toBe(true);
    }
    expect(notes.every((note) => note.time < 15)).toBe(true);
  });
});
