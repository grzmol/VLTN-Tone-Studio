import { describe, expect, it } from "vitest";
import type { BeatGrid } from "./beat-grid";
import { DEFAULT_BAND_SETTINGS, parseBandSettings } from "./arrangement";
import { MAX_BAR_MARKS, marksByBar, parseBarMarks, withMark, withMarkStops, withoutMark, type BarMark } from "./marks";

/** 16 beats of half a second in 4/4: four bars of two seconds. */
const grid: BeatGrid = { beatsPerBar: 4, beats: Array.from({ length: 16 }, (_, i) => i * 0.5), downbeat: 0, bpm: 120, steady: null };
const stop = (time: number, beats?: number): BarMark => ({ time, kind: "stop", ...(beats === undefined ? {} : { beats }) });

describe("marksByBar", () => {
  it("puts a mark 100 ms after a bar line on that bar", () => {
    expect(marksByBar(grid, [stop(2.1)]).byBar.get(1)).toEqual([stop(2.1)]);
  });

  it("puts a mark in the middle of a bar on the nearer bar line", () => {
    // 2.9 s is 0.9 s after the bar at 2 and 1.1 s before the bar at 4.
    const { byBar, dropped } = marksByBar(grid, [stop(2.9), stop(3.2)]);
    expect(byBar.get(1)).toEqual([stop(2.9)]);
    expect(byBar.get(2)).toEqual([stop(3.2)]);
    expect(dropped).toEqual([]);
  });

  it("drops a mark past the song's end, and reports it", () => {
    const { byBar, dropped } = marksByBar(grid, [stop(20)]);
    expect(byBar.size).toBe(0);
    expect(dropped).toEqual([stop(20)]);
  });

  it("keeps the last mark of a kind on a bar", () => {
    const marks: BarMark[] = [
      { time: 2, kind: "fill", beats: 1 },
      { time: 2.05, kind: "fill", beats: 4 },
      { time: 2, kind: "crash" },
    ];
    expect(marksByBar(grid, marks).byBar.get(1)).toEqual([
      { time: 2.05, kind: "fill", beats: 4 },
      { time: 2, kind: "crash" },
    ]);
  });

  it("costs nothing with no marks or no beats", () => {
    expect(marksByBar(grid, []).byBar.size).toBe(0);
    expect(marksByBar({ ...grid, beats: [] }, [stop(0)]).dropped).toHaveLength(1);
  });
});

describe("withMarkStops", () => {
  it("silences the last beats of the bar and makes the next downbeat a hit", () => {
    const feel = withMarkStops(grid, marksByBar(grid, [stop(2, 2)]).byBar);
    expect([...(feel?.stops ?? [])]).toEqual([6, 7]);
    expect([...(feel?.hits ?? [])]).toEqual([8]);
  });

  it("adds to the follow feel and leaves it alone when there are no stop marks", () => {
    const follow = { profiles: [], stops: new Set([1]), hits: new Set([4]) };
    expect(withMarkStops(grid, marksByBar(grid, [{ time: 2, kind: "fill" }]).byBar, follow)).toBe(follow);
    const merged = withMarkStops(grid, marksByBar(grid, [stop(0, 1)]).byBar, follow);
    expect([...(merged?.stops ?? [])].sort()).toEqual([1, 3]);
    expect([...(merged?.hits ?? [])].sort()).toEqual([4]);
  });

  it("makes no hit past the grid's last beat", () => {
    expect([...(withMarkStops(grid, marksByBar(grid, [stop(6)]).byBar)?.hits ?? [])]).toEqual([]);
  });
});

describe("parseBarMarks and the marks list", () => {
  it("keeps valid marks and drops unknown kinds, bad times and bad beats", () => {
    const parsed = parseBarMarks([
      { time: 4, kind: "stop", beats: 2 },
      { time: 4, kind: "stop", beats: 9 },
      { time: -1, kind: "fill" },
      { time: 4, kind: "wobble" },
      { time: "4", kind: "fill" },
      { time: 6, kind: "crash", beats: 3 },
      "mark",
    ]);
    expect(parsed).toEqual([
      { time: 4, kind: "stop", beats: 2 },
      { time: 4, kind: "stop" },
      { time: 6, kind: "crash" },
    ]);
    expect(parseBarMarks("nope")).toEqual([]);
  });

  it("keeps at most 200 marks", () => {
    expect(parseBarMarks(Array.from({ length: 300 }, (_, i) => ({ time: i, kind: "fill" })))).toHaveLength(MAX_BAR_MARKS);
  });

  it("puts a kind on a bar, replacing the same kind and taking away the one it excludes", () => {
    const first = withMark([], 4, "no-fill");
    expect(withMark(first, 4, "fill", 1)).toEqual([{ time: 4, kind: "fill", beats: 1 }]);
    expect(withMark(withMark(first, 4, "stop", 4), 4, "stop", 1)).toEqual([
      { time: 4, kind: "no-fill" },
      { time: 4, kind: "stop", beats: 1 },
    ]);
    expect(withMark(first, 6, "fill")).toHaveLength(2);
  });

  it("removes the marks of a bar, or one kind of them", () => {
    const marks = withMark(withMark(withMark([], 4, "stop"), 4, "crash"), 6, "fill");
    expect(withoutMark(marks, 4, "stop").map((mark) => mark.kind)).toEqual(["crash", "fill"]);
    expect(withoutMark(marks, 4)).toEqual([{ time: 6, kind: "fill" }]);
  });

  it("is saved with the band settings, and an older song has none", () => {
    expect(
      parseBandSettings({
        ...DEFAULT_BAND_SETTINGS,
        marks: [
          { time: 4, kind: "hit" },
          { time: 1, kind: "x" },
        ],
      }).marks,
    ).toEqual([{ time: 4, kind: "hit" }]);
    expect(parseBandSettings({ style: "rock" }).marks).toEqual([]);
  });
});
