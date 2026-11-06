import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSCROLL_HOLD_MS,
  autoscrollTarget,
  clampLinesPerMinute,
  fitLinesPerMinute,
  holdAutoscroll,
  isAutoscrollHeld,
  isAutoscrollMode,
  onAutoscrollResume,
  scrollTopFor,
  useAutoscroll,
  type ScrollRow,
} from "./autoscroll";

/** Four rows of 100 px each. Rows 0 and 2 are timed at 2 s and 10 s; rows 1 and 3 are untimed. */
const mixed: ScrollRow[] = [
  { time: 2, top: 0 },
  { time: NaN, top: 100 },
  { time: 10, top: 200 },
  { time: NaN, top: 300 },
];
/** Every row timed, one every four seconds, 100 px apart. */
const timed: ScrollRow[] = [0, 1, 2, 3].map((i) => ({ time: i * 4, top: i * 100 }));

describe("line mode", () => {
  it.each([
    [1, null],
    [2, 0],
    [5, 0],
    [9.9, 0],
    [10, 200],
    [60, 200],
  ])("at %d s the target is %s", (position, target) => {
    expect(autoscrollTarget("line", position, mixed, 0)).toBe(target);
  });
  it("keeps to the last started line when rows are out of order", () => {
    const shuffled = [timed[2], timed[0], timed[3], timed[1]];
    expect(autoscrollTarget("line", 9, shuffled, 0)).toBe(200);
  });
});

describe("continuous mode", () => {
  it.each([
    [0, 0],
    [2, 0],
    [6, 100],
    [7, 125],
    [10, 200],
    [11, 200],
  ])("between timed lines, at %d s the target is %d px", (position, target) => {
    expect(autoscrollTarget("continuous", position, mixed, 0)).toBe(target);
  });
  it("is at the top before the first timed line and needs a timed line at all", () => {
    expect(autoscrollTarget("continuous", 0.5, mixed, 0)).toBe(0);
    expect(autoscrollTarget("continuous", 5, [{ time: NaN, top: 0 }], 0)).toBeNull();
  });
  it("moves on evenly across a gap with two lines at one time", () => {
    const stacked = [
      { time: 4, top: 100 },
      { time: 4, top: 120 },
      { time: 8, top: 200 },
    ];
    expect(autoscrollTarget("continuous", 6, stacked, 0)).toBe(160);
  });
});

describe("constant speed", () => {
  it("moves one line each 10 seconds at 6 lines per minute", () => {
    expect(autoscrollTarget("constant", 0, timed, 6)).toBe(0);
    expect(autoscrollTarget("constant", 10, timed, 6)).toBe(100);
    expect(autoscrollTarget("constant", 5, timed, 6)).toBe(50);
  });
  it("is at the last row once the song has passed it, and never beyond", () => {
    expect(autoscrollTarget("constant", 9999, timed, 6)).toBe(300);
  });
  it("follows untimed rows too, which the other styles cannot", () => {
    expect(autoscrollTarget("constant", 30, mixed, 6)).toBe(300);
    expect(autoscrollTarget("constant", 5, mixed, 6)).toBe(50);
  });
  it("is at the top for a position before the song and is never negative", () => {
    expect(autoscrollTarget("constant", -3, timed, 6)).toBe(0);
  });
  it("takes a speed change into account because the song position is what it follows", () => {
    // At 3 lines a minute the second line (100 px) is reached at 20 s, where 6 lines a minute reaches it at 10 s.
    expect(autoscrollTarget("constant", 20, timed, 3)).toBe(100);
    expect(autoscrollTarget("constant", 10, timed, 3)).toBe(50);
  });
  it("is null when there are no rows", () => {
    expect(autoscrollTarget("constant", 3, [], 6)).toBeNull();
  });
});

describe("speed and position helpers", () => {
  it.each([
    [0, 1],
    [-4, 1],
    [1.4, 1],
    [6, 6],
    [500, 240],
    [NaN, 6],
  ])("clampLinesPerMinute(%d) is %d", (value, expected) => {
    expect(clampLinesPerMinute(value)).toBe(expected);
  });
  it("fits the song's length to the lines, so the last line lands at the end", () => {
    // 61 lines over 3 minutes: 60 gaps in 180 s, a third of a line every second, which is 20 lines a minute.
    expect(fitLinesPerMinute(61, 180)).toBe(20);
    expect(fitLinesPerMinute(2, 60)).toBe(1);
  });
  it("cannot fit without a duration or with one line", () => {
    expect(fitLinesPerMinute(10, 0)).toBeNull();
    expect(fitLinesPerMinute(10, NaN)).toBeNull();
    expect(fitLinesPerMinute(1, 60)).toBeNull();
  });
  it("keeps the reading line a third of the way down and never above the top", () => {
    expect(scrollTopFor(500, 300)).toBe(410);
    expect(scrollTopFor(50, 300)).toBe(0);
  });
});

describe("holding autoscroll after a manual scroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("holds for the hold time and then ends, telling the listeners", () => {
    const resume = vi.fn();
    const stop = onAutoscrollResume(resume);
    const start = performance.now();
    holdAutoscroll(start);
    expect(isAutoscrollHeld(start + AUTOSCROLL_HOLD_MS - 1)).toBe(true);
    expect(isAutoscrollHeld(start + AUTOSCROLL_HOLD_MS)).toBe(false);
    vi.advanceTimersByTime(AUTOSCROLL_HOLD_MS + 5);
    expect(resume).toHaveBeenCalledTimes(1);
    stop();
  });
  it("extends the hold when the performer scrolls again before it ends", () => {
    const resume = vi.fn();
    const stop = onAutoscrollResume(resume);
    holdAutoscroll();
    vi.advanceTimersByTime(AUTOSCROLL_HOLD_MS - 1000);
    holdAutoscroll();
    vi.advanceTimersByTime(2000);
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AUTOSCROLL_HOLD_MS);
    expect(resume).toHaveBeenCalledTimes(1);
    stop();
  });
  it("stops telling a listener that has stopped listening", () => {
    const resume = vi.fn();
    onAutoscrollResume(resume)();
    holdAutoscroll();
    vi.advanceTimersByTime(AUTOSCROLL_HOLD_MS + 5);
    expect(resume).not.toHaveBeenCalled();
  });
});

describe("the stored autoscroll choice", () => {
  it("recognises the three styles and nothing else", () => {
    expect(["line", "continuous", "constant"].every(isAutoscrollMode)).toBe(true);
    expect(isAutoscrollMode("bounce")).toBe(false);
  });
  it("writes the mode and speed, and clamps the speed", () => {
    useAutoscroll.getState().update({ mode: "constant", linesPerMinute: 900 });
    expect(useAutoscroll.getState()).toMatchObject({ mode: "constant", linesPerMinute: 240 });
    expect(JSON.parse(localStorage.getItem("vltn.performance.autoscroll.v1") ?? "{}")).toEqual({ mode: "constant", linesPerMinute: 240 });
  });
  it("ignores a mode it does not know", () => {
    useAutoscroll.getState().update({ mode: "bounce" as never });
    expect(useAutoscroll.getState().mode).toBe("constant");
  });
});
