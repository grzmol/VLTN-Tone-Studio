import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings, type SectionPlan } from "./arrangement";
import { generateBass } from "./bass";
import { barStartsFromChords, parseBeatGrid, type BeatGrid } from "./beat-grid";
import { generateDrums } from "./drums";
import type { ChordAtBeat } from "./harmony";
import { parseChordName } from "./harmony";
import { barSpans, beatInBar, barStarts, fitStepsToBar } from "./timing";

// Bar lines that move: a song with a short bar in the middle, where the chord changes move to another beat of the bar.

/** A grid with a beat every 0.5 s. */
function gridOf(count: number, downbeat = 0, starts?: number[]): BeatGrid {
  const grid: BeatGrid = { beatsPerBar: 4, beats: Array.from({ length: count }, (_, i) => i * 0.5), downbeat, bpm: 120, steady: null };
  return starts ? { ...grid, barStarts: starts } : grid;
}

/** Bars of 4 beats from beat 0 to 16, one bar of 2 beats, then bars of 4 again: the bar lines move by 2 beats at beat 16. */
const SHIFTED = [0, 4, 8, 12, 16, 18, 22, 26, 30];

function plan(endBeat: number, overrides: Partial<SectionPlan> = {}): SectionPlan {
  return {
    sectionId: null,
    start: 0,
    end: endBeat * 0.5,
    style: "rock",
    energy: 3,
    loud: 3,
    busy: 2,
    name: "",
    bassPart: "ring",
    bassRamp: false,
    octave: 0,
    fills: 0,
    hitTheOne: false,
    slides: false,
    deadNotes: false,
    pickups: false,
    fill: false,
    play: { drums: true, bass: true },
    ...overrides,
  };
}

function settingsFor(overrides: Partial<BandSettings> = {}): BandSettings {
  return {
    ...DEFAULT_BAND_SETTINGS,
    complexity: 1,
    swing: 0,
    ghostNotes: true,
    crashOnSections: false,
    lockToKick: false,
    humanise: { amount: 0, feel: "style" },
    ...overrides,
  };
}

/** One chord a bar, changing on the shifted bar lines. */
function harmonyOn(starts: readonly number[], count: number): ChordAtBeat[] {
  const names = ["A", "D", "E", "F#m"];
  return Array.from({ length: count }, (_, beat) => {
    let bar = 0;
    starts.forEach((start, k) => {
      if (start <= beat) bar = k;
    });
    return { beat, time: beat * 0.5, chord: parseChordName(names[bar % names.length]) };
  });
}

describe("fitStepsToBar", () => {
  const hits = [0, 4, 8, 12].map((step) => ({ step }));
  it("keeps a bar of the usual length as it is", () => {
    expect(fitStepsToBar(hits, 16, 4, 4)).toEqual(hits);
  });
  it("plays only the steps that fit a short bar", () => {
    expect(fitStepsToBar(hits, 16, 4, 2).map((hit) => hit.step)).toEqual([0, 4]);
  });
  it("starts the pattern again for the extra beats of a long bar", () => {
    expect(fitStepsToBar(hits, 16, 4, 6).map((hit) => hit.step)).toEqual([0, 4, 8, 12, 16, 20]);
  });
});

describe("bar spans and positions", () => {
  it("gives each bar its own length when the bar lines move", () => {
    const spans = barSpans(gridOf(34, 0, SHIFTED));
    expect(spans.map((span) => span.beats)).toEqual([4, 4, 4, 4, 2, 4, 4, 4, 4]);
  });
  it("counts beats from the bar's own start", () => {
    const grid = gridOf(34, 0, SHIFTED);
    expect(beatInBar(grid, 17)).toBe(1);
    expect(beatInBar(grid, 18)).toBe(0);
    expect(beatInBar(grid, 21)).toBe(3);
  });
  it("keeps bars of one length on a grid without bar starts", () => {
    const grid = gridOf(16, 1);
    expect(barStarts(grid)).toEqual([1, 5, 9, 13]);
    expect(beatInBar(grid, 6)).toBe(1);
  });
});

describe("barStartsFromChords", () => {
  const beats = Array.from({ length: 48 }, (_, i) => i * 0.5);
  it("moves the bar lines where the chord changes move, through one short bar", () => {
    // Changes every 4 beats from beat 0, then every 4 beats from beat 18 on (2 beats later).
    const changes = [0, 4, 8, 12, 16, 18, 22, 26, 30, 34, 38, 42, 46].map((beat) => beat * 0.5);
    const starts = barStartsFromChords(beats, changes, 4, 0);
    expect(starts).not.toBeNull();
    expect(starts!.slice(0, 7)).toEqual([0, 4, 8, 12, 16, 18, 22]);
  });
  it("returns null when the chord changes stay on one bar phase", () => {
    const changes = Array.from({ length: 12 }, (_, i) => i * 2);
    expect(barStartsFromChords(beats, changes, 4, 0)).toBeNull();
  });
  it("does not move the bar lines for a short run of changes on another phase", () => {
    const changes = [0, 4, 8, 12, 18, 20, 24, 28, 32, 36, 40, 44].map((beat) => beat * 0.5);
    expect(barStartsFromChords(beats, changes, 4, 0)).toBeNull();
  });
});

describe("saved bar starts", () => {
  const saved = { beatsPerBar: 4, downbeat: 0, beats: Array.from({ length: 34 }, (_, i) => i * 0.5) };
  it("keeps valid bar starts when a grid is read back", () => {
    expect(parseBeatGrid({ ...saved, barStarts: SHIFTED })?.barStarts).toEqual(SHIFTED);
  });
  it("drops bar starts that don't fit the grid, and keeps the grid", () => {
    for (const barStarts of [[1, 5], [0, 4, 3], [0, 20], [0, 4, 99], "no"]) {
      const grid = parseBeatGrid({ ...saved, barStarts });
      expect(grid).not.toBeNull();
      expect(grid?.barStarts).toBeUndefined();
    }
  });
});

describe("parts on a grid whose bar lines move", () => {
  const grid = gridOf(34, 0, SHIFTED);
  const harmony = harmonyOn(SHIFTED, 34);

  it("strikes a ringing bass note on every moved bar line, and no second note a beat later", () => {
    const notes = generateBass(grid, harmony, [plan(34)], settingsFor(), [], 1).filter((note) => !note.dead);
    const starts = new Set(notes.map((note) => Math.round(note.time * 2)));
    for (const start of SHIFTED.slice(0, -1)) expect(starts.has(start)).toBe(true);
    // Before the fix, bars stayed on the old phase, so a note followed each chord change one or two beats later.
    for (const start of SHIFTED) {
      expect(starts.has(start + 1)).toBe(false);
      expect(starts.has(start + 2) && !SHIFTED.includes(start + 2)).toBe(false);
    }
  });

  it("ends a held note at the short bar's own end", () => {
    const notes = generateBass(grid, harmony, [plan(34)], settingsFor(), [], 1).filter((note) => !note.dead);
    const short = notes.find((note) => Math.round(note.time * 2) === 16)!;
    expect(short.time + short.duration).toBeLessThanOrEqual(9 + 1e-6);
  });

  it("plays only two beats of the drum groove in the short bar, and a full bar after it", () => {
    const drums = generateDrums(grid, [plan(34)], settingsFor(), 1);
    const inShort = drums.filter((note) => note.time >= 8 - 1e-6 && note.time < 9 - 1e-6);
    const inNext = drums.filter((note) => note.time >= 9 - 1e-6 && note.time < 11 - 1e-6);
    expect(inShort.length).toBeGreaterThan(0);
    expect(inNext.length).toBeGreaterThan(inShort.length);
    expect(drums.some((note) => note.pitch === 36 && Math.abs(note.time - 9) < 1e-6)).toBe(true);
  });

  it("plays the same as before on a grid without bar starts", () => {
    const plain = gridOf(32);
    const chords = harmonyOn([0, 4, 8, 12, 16, 20, 24, 28], 32);
    const notes = generateBass(plain, chords, [plan(32)], settingsFor(), [], 1);
    expect(notes.filter((note) => !note.dead).every((note) => Math.round(note.time * 2) % 4 === 0)).toBe(true);
  });
});
