import { afterEach, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setClockPosition, startPlaybackClock, useActiveIndex, useCountInBeats, usePlaybackClock } from "./playback-clock";

afterEach(() => {
  vi.useRealTimers();
  setClockPosition(0);
});

it("mirrors the audio position once per frame and stops when cancelled", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let position = 1.5;
  const stop = startPlaybackClock(() => position);
  expect(usePlaybackClock.getState().playing).toBe(true);
  frames.shift()?.(0);
  expect(usePlaybackClock.getState().position).toBe(1.5);
  position = -1;
  frames.shift()?.(16);
  expect(usePlaybackClock.getState().position).toBe(0);
  stop();
  expect(usePlaybackClock.getState().playing).toBe(false);
  vi.unstubAllGlobals();
});

it("re-renders an active-index subscriber only when the line changes", () => {
  let renders = 0;
  const times = [0, 10, 20];
  const { result } = renderHook(() => {
    renders++;
    return useActiveIndex(times);
  });
  expect(result.current).toBe(0);
  const initial = renders;
  for (const position of [1, 2, 3, 4, 9.9]) act(() => setClockPosition(position));
  expect(renders).toBe(initial);
  act(() => setClockPosition(10));
  expect(result.current).toBe(1);
  expect(renders).toBe(initial + 1);
});

it("keeps the displayed position at zero during a count-in and counts the lead-in beats down", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let position = -2;
  const stop = startPlaybackClock(() => position);
  frames.shift()?.(0);
  expect(usePlaybackClock.getState().position).toBe(0);
  expect(usePlaybackClock.getState().leadIn).toBe(2);
  const { result } = renderHook(() => useCountInBeats(120));
  expect(result.current).toBe(4);
  position = -0.4;
  act(() => frames.shift()?.(16));
  expect(usePlaybackClock.getState().leadIn).toBeCloseTo(0.4);
  expect(result.current).toBe(1);
  stop();
  expect(usePlaybackClock.getState().leadIn).toBe(0);
  vi.unstubAllGlobals();
});
