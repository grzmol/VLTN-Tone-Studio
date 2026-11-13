import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore } from "zustand/vanilla";
import { useSongLibrary } from "@/song/library";
import { useResumeOffer } from "@/song/performance/resume-offer";
import { RESUME_POINT_KEY, clearResumePoint, loadResumePoint, saveResumePoint, type ResumePoint } from "@/song/performance/resume-point";
import type { PerformanceSession } from "@/song/performance/session";
import { ResumeBanner } from "./ResumeBanner";

const point: ResumePoint = {
  version: 1,
  savedAt: Date.now(),
  playlistId: "set-1",
  queue: ["a", "b", "c"],
  position: 1,
  songId: "b",
  songTime: 134,
  playing: true,
  sendCues: true,
  stageMode: true,
};

function fakeSession() {
  const store = createStore(() => ({ player: {} }));
  const calls = { seek: vi.fn(async () => {}), startPlayback: vi.fn(), playFromBeginning: vi.fn(async () => {}) };
  return { session: { store, ...calls } as unknown as PerformanceSession, ...calls };
}

beforeEach(() => {
  clearResumePoint();
  saveResumePoint(point);
  useResumeOffer.setState({ point });
  useSongLibrary.setState({ queue: point.queue, position: 1, busy: false });
});
afterEach(() => {
  cleanup();
  clearResumePoint();
  useResumeOffer.setState({ point: null });
});

describe("ResumeBanner", () => {
  it("moves the song to the lost place without playing, then Resume plays once and brings stage mode back", async () => {
    const { session, seek, startPlayback } = fakeSession();
    const setStage = vi.fn();
    render(<ResumeBanner session={session} setStage={setStage} />);
    await waitFor(() => expect(seek).toHaveBeenCalledWith(134));
    expect(startPlayback).not.toHaveBeenCalled();
    expect(setStage).not.toHaveBeenCalled();
    const resume = await screen.findByText("Resume at 2:14");
    await waitFor(() => expect((resume as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(resume);
    expect(startPlayback).toHaveBeenCalledTimes(1);
    expect(setStage).toHaveBeenCalledWith(true);
    expect(useResumeOffer.getState().point).toBeNull();
  });

  it("Dismiss clears the point and plays nothing", async () => {
    const { session, startPlayback } = fakeSession();
    render(<ResumeBanner session={session} setStage={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Dismiss"));
    });
    expect(startPlayback).not.toHaveBeenCalled();
    expect(localStorage.getItem(RESUME_POINT_KEY)).toBeNull();
    expect(loadResumePoint(Date.now())).toBeNull();
    expect(screen.queryByText(/Resume at/)).toBeNull();
  });

  it("waits for the right song before moving it", async () => {
    useSongLibrary.setState({ position: 0 });
    const { session, seek } = fakeSession();
    render(<ResumeBanner session={session} setStage={vi.fn()} />);
    await act(async () => {});
    expect(seek).not.toHaveBeenCalled();
    expect((screen.getByText("Resume at 2:14") as HTMLButtonElement).disabled).toBe(true);
  });
});
