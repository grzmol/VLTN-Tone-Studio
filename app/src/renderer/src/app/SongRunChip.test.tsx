import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SongRunChip } from "./SongRunChip";
import { songRunner } from "@/song/analysis/song-runner-app";

afterEach(() => {
  cleanup();
  songRunner.state.setState({ running: false, waiting: false, endedAt: null, step: null, title: null, message: null });
});

it("shows the open song's step and its place in the run", () => {
  songRunner.state.setState({ running: true, title: "Song title", step: "chords", stepIndex: 2, steps: 8 });
  render(<SongRunChip />);
  expect(screen.getByText("Analysing Song title: chords (3 of 8)")).toBeDefined();
});

it("shows nothing when no run is going and none ended recently", () => {
  const { container } = render(<SongRunChip />);
  expect(container.textContent).toBe("");
});

it("shows the summary for a while after a run ends", () => {
  songRunner.state.setState({ running: false, title: "Song title", message: "Tempo 98 BPM", endedAt: Date.now() });
  render(<SongRunChip />);
  expect(screen.getByText("Song title analysed: Tempo 98 BPM")).toBeDefined();
});
