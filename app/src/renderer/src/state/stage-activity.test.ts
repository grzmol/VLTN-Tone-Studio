import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STAGE_IDLE_DEBOUNCE_MS, setStageBusy, useStageActivity } from "./stage-activity";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  setStageBusy(false);
  vi.runAllTimers();
  vi.useRealTimers();
});

it("goes busy at once and idle only after the debounce", () => {
  setStageBusy(true);
  expect(useStageActivity.getState().busy).toBe(true);
  setStageBusy(false);
  vi.advanceTimersByTime(STAGE_IDLE_DEBOUNCE_MS - 1);
  expect(useStageActivity.getState().busy).toBe(true);
  vi.advanceTimersByTime(1);
  expect(useStageActivity.getState().busy).toBe(false);
});

it("stays busy when a new busy report arrives inside the debounce", () => {
  setStageBusy(true);
  setStageBusy(false);
  vi.advanceTimersByTime(STAGE_IDLE_DEBOUNCE_MS / 2);
  setStageBusy(true);
  vi.advanceTimersByTime(STAGE_IDLE_DEBOUNCE_MS * 2);
  expect(useStageActivity.getState().busy).toBe(true);
});

it("is not cleared by an old owner ending after a new owner started", () => {
  const first = {};
  const second = {};
  setStageBusy(true, first);
  setStageBusy(true, second);
  setStageBusy(false, first);
  vi.advanceTimersByTime(STAGE_IDLE_DEBOUNCE_MS * 2);
  expect(useStageActivity.getState().busy).toBe(true);
  setStageBusy(false, second);
  vi.advanceTimersByTime(STAGE_IDLE_DEBOUNCE_MS);
  expect(useStageActivity.getState().busy).toBe(false);
});
