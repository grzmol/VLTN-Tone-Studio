import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGE_IDLE_DEBOUNCE_MS, resetStageActivity, setStageBusy } from "@/state/stage-activity";

const setShowRunning = vi.hoisted(() => vi.fn(async (_running: boolean) => {}));
vi.mock("@/host", () => ({ host: { app: { setShowRunning } } }));

import { useShowGuard } from "./show-guard";

beforeEach(() => {
  vi.useFakeTimers();
  resetStageActivity();
  setShowRunning.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useShowGuard", () => {
  it("reports a show while something plays, and clears it after the idle debounce", () => {
    renderHook(() => useShowGuard());
    setShowRunning.mockClear();
    setStageBusy(true, "song");
    expect(setShowRunning).toHaveBeenLastCalledWith(true);
    setStageBusy(false, "song");
    expect(setShowRunning).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STAGE_IDLE_DEBOUNCE_MS);
    expect(setShowRunning).toHaveBeenLastCalledWith(false);
  });

  it("keeps the show running across a hand-over between playlist songs", () => {
    renderHook(() => useShowGuard());
    setShowRunning.mockClear();
    setStageBusy(true, "first");
    setStageBusy(false, "first");
    setStageBusy(true, "second");
    vi.advanceTimersByTime(STAGE_IDLE_DEBOUNCE_MS * 2);
    expect(setShowRunning).toHaveBeenCalledTimes(1);
    expect(setShowRunning).toHaveBeenLastCalledWith(true);
  });

  it("tells main nothing plays when the shell mounts idle or unmounts", () => {
    const { unmount } = renderHook(() => useShowGuard());
    expect(setShowRunning).toHaveBeenLastCalledWith(false);
    setStageBusy(true, "song");
    unmount();
    expect(setShowRunning).toHaveBeenLastCalledWith(false);
  });

  it("reports a show that was already running when the shell mounted", () => {
    setStageBusy(true, "song");
    renderHook(() => useShowGuard());
    expect(setShowRunning).toHaveBeenCalledWith(true);
  });
});
