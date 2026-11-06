import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalysisChip, SUMMARY_MS } from "./AnalysisChip";
import { jobLine, useAnalysisJob, type AnalysisJobState } from "@/song/analysis/analysis-job";
import { useNav } from "@/state/nav";

vi.mock("@/song/analysis/library-batch", () => ({ runLibraryAnalysis: vi.fn() }));

const idle = {
  phase: "idle" as const,
  total: 0,
  done: 0,
  current: null,
  startedAt: null,
  endedAt: null,
  outcomes: [],
  summary: null,
  error: null,
  waitingFor: null,
  openRequested: false,
};

beforeEach(() => {
  useAnalysisJob.setState(idle);
  useNav.setState({ screen: "rig", param: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const job = (over: Partial<AnalysisJobState>) => ({ ...idle, ...over }) as AnalysisJobState;

it("says nothing while no run is going and no summary is fresh", () => {
  const { container } = render(<AnalysisChip />);
  expect(container.textContent).toBe("");
});

it("shows the song, the step and the time left while a run goes on", () => {
  const now = Date.now();
  useAnalysisJob.setState({
    phase: "analysing",
    total: 12,
    done: 2,
    current: { title: "Title", step: "tempo", stepIndex: 3, steps: 7 },
    startedAt: now - 120_000,
  });
  render(<AnalysisChip />);
  expect(screen.getByText("Analysing songs 3/12 · Title (tempo) · about 10 min left")).toBeTruthy();
  expect(screen.getByRole("progressbar")).toBeTruthy();
});

it("says it is waiting for playback, and loading a song, while it is held", () => {
  useAnalysisJob.setState({ phase: "waiting", total: 3, waitingFor: "song", current: { title: "Title", step: null, stepIndex: 0, steps: 0 } });
  const { unmount } = render(<AnalysisChip />);
  expect(screen.getByText("Analysing songs: waiting for playback to stop")).toBeTruthy();
  unmount();
  useAnalysisJob.setState({ phase: "loading", current: { title: "Title", step: null, stepIndex: 0, steps: 0 } });
  render(<AnalysisChip />);
  expect(screen.getByText("Analysing songs: loading Title…")).toBeTruthy();
});

it("names the playlist when the playlist, not a song, is what it waits for", () => {
  expect(jobLine(job({ phase: "waiting", total: 2, waitingFor: "playlist" }), Date.now())).toBe("Analysing songs: waiting for the playlist to stop");
});

it("opens the Library's Analyse dialog on the run when clicked", () => {
  useAnalysisJob.setState({ phase: "analysing", total: 2, current: { title: "A", step: null, stepIndex: 0, steps: 0 }, startedAt: Date.now() });
  render(<AnalysisChip />);
  fireEvent.click(screen.getByRole("button"));
  expect(useNav.getState()).toMatchObject({ screen: "song", param: "songs" });
  expect(useAnalysisJob.getState().openRequested).toBe(true);
});

it("shows the summary after a run ends, and drops it after a while", () => {
  vi.useFakeTimers();
  useAnalysisJob.setState({ phase: "finished", total: 1, endedAt: Date.now(), summary: "Analysed 1 song." });
  render(<AnalysisChip />);
  expect(screen.getByText("Analysed 1 song.")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(SUMMARY_MS);
  });
  expect(screen.queryByText("Analysed 1 song.")).toBeNull();
});

it("shows a failed run with its message", () => {
  useAnalysisJob.setState({ phase: "failed", error: "Disk full", endedAt: Date.now() });
  render(<AnalysisChip />);
  expect(screen.getByText("Analysis failed: Disk full")).toBeTruthy();
});
