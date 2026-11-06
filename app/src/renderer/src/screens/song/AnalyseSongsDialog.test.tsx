import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalyseSongsDialog } from "./AnalyseSongsDialog";
import { runLibraryAnalysis } from "@/song/analysis/library-batch";
import { setSongPlaying } from "@/song/performance/playing-state";
import { useSongLibrary } from "@/song/library";
import { ANALYSIS_VERSION } from "@/song/analysis/song-analysis";
import { useAnalysisJob } from "@/song/analysis/analysis-job";
import type { BatchOutcome, BatchSong } from "@/song/analysis/batch";

vi.mock("@/host", () => ({ host: { song: {} } }));
vi.mock("@/song/stems/engine", () => ({ separateStems: vi.fn() }));
vi.mock("@/song/analysis/library-batch", () => ({ runLibraryAnalysis: vi.fn() }));
const run = vi.mocked(runLibraryAnalysis);

// Alpha has no tempo of its own, so it needs analysing. Bravo's tempo was set by hand and its analysis is current, so it does not.
const alpha: BatchSong = { id: "a", title: "Alpha", settings: { ":bpm": "120", ":options": "{}" } };
const bravo: BatchSong = {
  id: "b",
  title: "Bravo",
  settings: { ":bpm": "95", ":options": JSON.stringify({ tempoSource: "manual", analysis: { audioId: "x", version: ANALYSIS_VERSION } }) },
};

beforeEach(() => {
  vi.clearAllMocks();
  useSongLibrary.setState({ playlistPlaying: false });
});
// The job is one store for the app, so each test lets its run end and clears it before the next starts.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  useAnalysisJob.getState().dismiss();
  setSongPlaying(false);
  cleanup();
});

const open = (songs: BatchSong[]) => render(<AnalyseSongsDialog open songs={songs} onOpenChange={vi.fn()} />);

it("says how many songs will run, leaving out the ones that are already analysed", () => {
  open([alpha, bravo]);
  expect(screen.getByText(/2 songs in the selection\. 1 will be analysed\./)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Analyse 1 song" })).toBeTruthy();
});

it("says before the run what the lyrics step will do, and does not start when no song qualifies", () => {
  const before2: BatchSong = { id: "o", title: "Old", settings: { ":bpm": "120", ":options": "{}", ":lyrics": "[00:01.00] Words from before" } };
  open([before2]);
  for (const name of ["Tempo and meter", "Key", "Chords", "Loudness", "Drums and bass", "Silence", "Sections"]) {
    fireEvent.click(screen.getByRole("checkbox", { name }));
  }
  fireEvent.click(screen.getByRole("checkbox", { name: "Lyrics" }));
  fireEvent.click(screen.getByLabelText("Songs whose lyrics Tone Studio made"));
  expect(screen.getByText("Lyrics: 0 of 1 song will get new lyrics. Skipped: 1 from before 0.9.2. Tick the box above to include them.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Analyse 0 songs" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Include lyrics from before version 0.9.2" }));
  expect((screen.getByRole("button", { name: "Analyse 1 song" }) as HTMLButtonElement).disabled).toBe(false);
});

it("refuses to start while a song plays, and does not run the batch", () => {
  setSongPlaying(true);
  open([alpha]);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  expect(run).not.toHaveBeenCalled();
  expect(screen.getByText(/Stop playback before analysing songs/)).toBeTruthy();
});

it("runs the batch with the choices as they are, and shows the tempos it changed", async () => {
  run.mockResolvedValue([{ id: "a", title: "Alpha", status: "analysed", tempoChange: { from: 120, to: 98 }, noBeat: false, lyrics: null }]);
  open([alpha, bravo]);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  expect(run).toHaveBeenCalledWith(
    [alpha, bravo],
    expect.objectContaining({ onlyNeeded: true, replaceManual: false, openSongId: null }),
    expect.any(AbortSignal),
    expect.objectContaining({ onProgress: expect.any(Function) }),
  );
  expect(await screen.findByText("Analysed 1 song. Tempo changed on 1 (Alpha: 120 → 98).")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
});

it("can leave a step out of the batch", () => {
  run.mockResolvedValue([]);
  open([alpha]);
  fireEvent.click(screen.getByText("Key").closest("label")!.querySelector("button")!);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  expect(run).toHaveBeenCalledWith(
    [alpha],
    expect.objectContaining({ choice: expect.objectContaining({ key: false }) }),
    expect.any(AbortSignal),
    expect.objectContaining({ onProgress: expect.any(Function) }),
  );
});

it("can be closed while a run goes on, and reopening it shows the run as it is", () => {
  let finish!: (outcomes: BatchOutcome[]) => void;
  run.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const onOpenChange = vi.fn();
  const { rerender } = render(<AnalyseSongsDialog open songs={[alpha]} onOpenChange={onOpenChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  fireEvent.click(screen.getByRole("button", { name: "Run in background" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  rerender(<AnalyseSongsDialog open={false} songs={[alpha]} onOpenChange={onOpenChange} />);
  rerender(<AnalyseSongsDialog open songs={[alpha]} onOpenChange={onOpenChange} />);
  expect(screen.getByText(/Song 1 of 1/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  finish([]);
});

it("lists each song as it finishes, and Done clears the summary", async () => {
  let finish!: (outcomes: BatchOutcome[]) => void;
  run.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  open([alpha]);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  act(() =>
    run.mock.calls[0][3]?.onSongDone?.({ id: "a", title: "Alpha", status: "analysed", tempoChange: { from: 120, to: 98 }, noBeat: false, lyrics: null }),
  );
  expect(screen.getByText("Alpha: 120 → 98")).toBeTruthy();
  await act(async () => finish([]));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(useAnalysisJob.getState().phase).toBe("idle");
});

it("stops the run from the dialog", async () => {
  let finish!: (outcomes: BatchOutcome[]) => void;
  run.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  open([alpha]);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(run.mock.calls[0][2].aborted).toBe(true);
  await act(async () => finish([]));
  expect(useAnalysisJob.getState().phase).toBe("stopped");
});
