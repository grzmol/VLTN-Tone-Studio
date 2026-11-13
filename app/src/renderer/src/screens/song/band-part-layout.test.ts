import { describe, expect, it } from "vitest";
import { fixedBeatGrid } from "@/song/band/beat-grid";
import { CLOSED_HAT, CRASH, KICK, MID_TOM, PEDAL_HAT, SIDE_STICK, SNARE, type NoteEvent } from "@/song/band/note";
import type { ChordAtBeat } from "@/song/band/harmony";
import { barLabel, layoutSection, noteName } from "./band-part-layout";

// 120 BPM in 4/4: a beat is 0.5 s and a bar is 2 s.
const grid = fixedBeatGrid(120, 0, 4, 40);
const drum = (time: number, pitch: number, velocity = 100): NoteEvent => ({ time, pitch, velocity, duration: 0.1 });
const bassNote = (time: number, pitch: number, duration = 0.5, extra: Partial<NoteEvent> = {}): NoteEvent => ({
  time,
  pitch,
  velocity: 90,
  duration,
  ...extra,
});

describe("band part layout", () => {
  it("lays a section of 9 bars out as 4 + 4 + 1, with a heavier line at the end of each phrase", () => {
    const layout = layoutSection({ drums: [], bass: [] }, grid, { start: 0, end: 18 });
    expect(layout.lines.map((line) => line.length)).toEqual([4, 4, 1]);
    expect(layout.bars.map((bar) => bar.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(layout.bars.filter((bar) => bar.phraseEnd).map((bar) => bar.number)).toEqual([4, 8]);
  });

  it("counts bar numbers from the section start", () => {
    const layout = layoutSection({ drums: [], bass: [] }, grid, { start: 8, end: 14 });
    expect(layout.bars.map((bar) => bar.number)).toEqual([1, 2, 3]);
    expect(layout.bars[0].barIndex).toBe(4);
    expect(layout.bars[0].start).toBe(8);
  });

  it("puts a hit at step 6 of bar 2 at the right x", () => {
    // Bar 2 starts at 2 s. Step 6 of 16 is 6/16 of the bar, 0.75 s in.
    const layout = layoutSection({ drums: [drum(2 + 0.75, SNARE)], bass: [] }, grid, { start: 0, end: 8 });
    expect(layout.bars[0].drums).toHaveLength(0);
    expect(layout.bars[1].drums).toHaveLength(1);
    expect(layout.bars[1].drums[0].x).toBeCloseTo(0.375, 5);
    expect(layout.bars[1].drums[0].lane).toBe("snare");
  });

  it("puts the drums on their lanes, hollow for a pedal hat, a cross-stick and a ghost note, and the toms at three heights", () => {
    const hits = [drum(0, KICK), drum(0.25, CLOSED_HAT), drum(0.5, PEDAL_HAT), drum(1, SIDE_STICK), drum(1.5, SNARE, 30), drum(1.75, MID_TOM)];
    const dots = layoutSection({ drums: hits, bass: [] }, grid, { start: 0, end: 2 }).bars[0].drums;
    expect(dots.map((dot) => [dot.lane, dot.hollow])).toEqual([
      ["kick", false],
      ["hat", false],
      ["hat", true],
      ["snare", true],
      ["snare", true],
      ["toms", false],
    ]);
    expect(dots[4].ghost).toBe(true);
    expect(dots[5].height).toBe(1);
  });

  it("marks a fill bar and a crash on the downbeat", () => {
    const fill = [drum(2 + 1.25, MID_TOM), drum(2 + 1.5, MID_TOM), drum(2 + 1.75, MID_TOM), drum(4, CRASH)];
    const layout = layoutSection({ drums: fill, bass: [] }, grid, { start: 0, end: 6 });
    expect(layout.bars.map((bar) => bar.fill)).toEqual([false, true, false]);
    expect(layout.bars.map((bar) => bar.crashOnOne)).toEqual([false, false, true]);
  });

  it("gives each bar a screen reader label of its drum counts", () => {
    const hits = [drum(0, KICK), drum(0, CLOSED_HAT), drum(0.5, CLOSED_HAT), drum(1, SNARE), drum(1, KICK), drum(1.5, CLOSED_HAT)];
    const layout = layoutSection({ drums: hits, bass: [] }, grid, { start: 0, end: 4 });
    expect(layout.bars[0].label).toBe("Bar 1: kick 2, snare 1, hats 3");
    expect(layout.bars[1].label).toBe("Bar 2: no drums");
    expect(barLabel(4, [], true)).toBe("Bar 4: fill");
  });

  it("scales the bass from its lowest to its highest note and names the notes", () => {
    const bass = [bassNote(0, 28), bassNote(0.5, 33), bassNote(2, 38), bassNote(2.5, 29)];
    const { bassScale } = layoutSection({ drums: [], bass }, grid, { start: 0, end: 4 });
    expect(bassScale).toMatchObject({ low: 28, high: 38 });
    expect(bassScale?.labels.map((label) => label.name)).toEqual(["E1", "A1", "D2"]);
    expect(layoutSection({ drums: [], bass: [] }, grid, { start: 0, end: 4 }).bassScale).toBeNull();
  });

  it("never labels two notes a semitone apart", () => {
    const { bassScale } = layoutSection({ drums: [], bass: [bassNote(0, 28), bassNote(1, 29), bassNote(2, 30)] }, grid, { start: 0, end: 4 });
    expect(bassScale?.labels.map((label) => label.name)).toEqual(["E1", "F#1"]);
  });

  it("places bass notes with their length, cut at the bar's end, and their kinds", () => {
    const bass = [bassNote(0.5, 28, 0.5), bassNote(1.5, 33, 5, { dead: true }), bassNote(1, 28, 0.25, { slideFrom: 2 })];
    const blocks = layoutSection({ drums: [], bass }, grid, { start: 0, end: 2 }).bars[0].bass;
    expect(blocks[0]).toMatchObject({ x: 0.25, width: 0.25, dead: false, slide: false });
    expect(blocks[1]).toMatchObject({ x: 0.75, width: 0.25, dead: true });
    expect(blocks[2].slide).toBe(true);
  });

  it("marks a bass note the performer set by hand and lists the chords above the bar", () => {
    const harmony: ChordAtBeat[] = grid.beats.slice(0, 8).map((time, beat) => ({
      beat,
      time,
      chord: { name: beat < 2 ? "E" : "A", bass: 4, quality: "major", byHand: beat === 4 } as never,
    }));
    const layout = layoutSection({ drums: [], bass: [bassNote(0, 28), bassNote(2, 33)] }, grid, { start: 0, end: 4 }, harmony);
    expect(layout.bars[0].chords).toEqual([
      { x: 0, name: "E" },
      { x: 0.5, name: "A" },
    ]);
    expect(layout.bars[0].bass[0].byHand).toBe(false);
    expect(layout.bars[1].bass[0].byHand).toBe(true);
  });

  it("names notes from E1", () => {
    expect([28, 33, 38, 40, 21].map(noteName)).toEqual(["E1", "A1", "D2", "E2", "A0"]);
  });
});
