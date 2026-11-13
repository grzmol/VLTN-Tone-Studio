import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnalysisCard, isFailure } from "./AnalysisCard";

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
