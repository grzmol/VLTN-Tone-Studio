import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { ChartImport } from "./ChartImport";

afterEach(() => {
  cleanup();
  usePlaybackClock.setState({ playing: false });
});

const chordPro = "{title: Test Song}\n{tempo: 96}\n{textfont: Serif}\n{soc}\n[G]Hold the [C]line\n{eoc}";

it("summarises a ChordPro paste, lists what was not taken as written, and replaces the chart with it", () => {
  const onImport = vi.fn();
  render(<ChartImport chart="" onImport={onImport} />);
  fireEvent.change(screen.getByLabelText("Text to import"), { target: { value: chordPro } });
  const summary = screen.getByLabelText("Import summary");
  expect(summary.textContent).toContain("ChordPro");
  expect(summary.textContent).toContain("Title: Test Song");
  expect(summary.textContent).toContain("Tempo: 96");
  expect(summary.textContent).toContain("Line 3: {textfont: Serif} is not supported");
  fireEvent.click(screen.getByRole("button", { name: "Replace chart with this import" }));
  expect(onImport).toHaveBeenCalledWith("// textfont: Serif\n# Chorus\n[G]Hold the [C]line", { title: "Test Song", tempo: 96 });
});

it("shows a chord sheet's format and does not allow an import that does not parse", () => {
  render(<ChartImport chart="" onImport={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Text to import"), { target: { value: "[00:01] {midi:wrong command}" } });
  expect(screen.getByRole("alert").textContent).toContain("does not parse as a chart");
  expect((screen.getByRole("button", { name: "Replace chart with this import" }) as HTMLButtonElement).disabled).toBe(true);
});

it("refuses to replace the chart while the song is playing, and says why", () => {
  usePlaybackClock.setState({ playing: true });
  render(<ChartImport chart="" onImport={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Text to import"), { target: { value: chordPro } });
  expect(screen.getByRole("status").textContent).toContain("Stop playback");
  expect((screen.getByRole("button", { name: "Replace chart with this import" }) as HTMLButtonElement).disabled).toBe(true);
});

it("refuses to drop MIDI commands that the current chart holds", () => {
  render(<ChartImport chart="[00:01] {midi:pc 1 5}" onImport={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Text to import"), { target: { value: chordPro } });
  expect(screen.getByRole("status").textContent).toContain("MIDI commands or triggers");
  expect((screen.getByRole("button", { name: "Replace chart with this import" }) as HTMLButtonElement).disabled).toBe(true);
});

it("reads the native chart format as it is, without a list of notes", () => {
  render(<ChartImport chart="" onImport={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Text to import"), { target: { value: "[00:01.00] [Am]Words {midi:pc 1 5}" } });
  expect(screen.getByLabelText("Import summary").textContent).toContain("The app's chart format");
  expect(screen.queryByText(/Not taken as written/)).toBeNull();
});
