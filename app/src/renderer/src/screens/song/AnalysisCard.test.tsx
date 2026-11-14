import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnalysisCard, isFailure, withSongSections } from "./AnalysisCard";

afterEach(cleanup);

const idle = { step: null, detecting: false, message: "Tempo 150 BPM. 13 sections", cancel: vi.fn() };

it("shows the analysis line with Analyse again as a card", () => {
  const again = vi.fn();
  render(<AnalysisCard analysis={idle} hasSong analyseDisabled={false} onAnalyseAgain={again} />);
  expect(screen.getByRole("heading", { name: "Analysis" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Analyse again" }));
  expect(again).toHaveBeenCalled();
});

it("stays quiet in the Play view unless the analysis runs or failed", () => {
  const { container, rerender } = render(<AnalysisCard quiet analysis={idle} hasSong analyseDisabled={false} onAnalyseAgain={vi.fn()} />);
  expect(container.textContent).toBe("");
  rerender(<AnalysisCard quiet analysis={{ ...idle, step: "tempo" }} hasSong analyseDisabled={false} onAnalyseAgain={vi.fn()} />);
  expect(screen.getByText("Analysing the song: tempo…")).toBeTruthy();
  rerender(
    <AnalysisCard quiet analysis={{ ...idle, message: "Tempo 150 BPM. Chords failed: no audio" }} hasSong analyseDisabled={false} onAnalyseAgain={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "Analyse again" })).toBeTruthy();
});

it("recognises a failure line", () => {
  expect(isFailure("Chords failed: x")).toBe(true);
  expect(isFailure("Tempo 150 BPM")).toBe(false);
  expect(isFailure(null)).toBe(false);
});

it("shows the song's own section count and keeps the detected count in the details", () => {
  const message = "Tempo 150 BPM. 3 section keys. 39 sections";
  expect(withSongSections(message, 13)).toBe("Tempo 150 BPM. 3 section keys. 13 sections");
  expect(withSongSections("Tempo 150 BPM. 39 sections", 1)).toBe("Tempo 150 BPM. 1 section");
  expect(withSongSections(message, undefined)).toBe(message);
  render(<AnalysisCard analysis={{ ...idle, message }} hasSong analyseDisabled={false} onAnalyseAgain={vi.fn()} sectionCount={13} />);
  expect(screen.getByText("Tempo 150 BPM. 3 section keys. 13 sections")).toBeTruthy();
  expect(screen.getByText(/What the analysis detected: .*39 sections/)).toBeTruthy();
});

it("says the song is not analysed yet when there is no summary", () => {
  render(<AnalysisCard analysis={{ ...idle, message: null }} hasSong analyseDisabled={false} onAnalyseAgain={vi.fn()} />);
  expect(screen.getByText("Not analysed yet.")).toBeTruthy();
});
