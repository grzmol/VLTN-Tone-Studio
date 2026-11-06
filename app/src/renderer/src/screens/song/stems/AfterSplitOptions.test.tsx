import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AfterSplitOptions, lyricsCost } from "./AfterSplitOptions";
import { defaultAfterSplit } from "@/song/analysis/after-split";
import { DEFAULT_LYRICS_CHOICE } from "@/song/performance/lyrics-options";

vi.mock("@/host", () => ({ host: { song: { downloadedFiles: vi.fn().mockResolvedValue([]) } } }));

// Radix measures with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

it("starts with every step on, and the lyrics model shown", () => {
  render(<AfterSplitOptions />);
  for (const label of ["Tempo and beat", "Key", "Chords", "Sections", "Loudness and silence", "Drums and bass check", "Lyrics"]) {
    expect(screen.getByLabelText(label).getAttribute("data-state")).toBe("checked");
  }
  expect(screen.getByText(/to download once/)).toBeDefined();
});

it("saves a step that is unticked, and hides the lyrics model with lyrics off", () => {
  render(<AfterSplitOptions />);
  fireEvent.click(screen.getByLabelText("Lyrics"));
  expect(screen.queryByText(/to download once/)).toBeNull();
  const saved = JSON.parse(localStorage.getItem("gp5.song.afterSplit.v1") ?? "{}");
  expect(saved).toEqual({ ...defaultAfterSplit(), lyrics: false, language: "auto" });
});

it("describes the cost of the chosen lyrics model", () => {
  expect(lyricsCost(DEFAULT_LYRICS_CHOICE)).toMatch(/^Lyrics with .+: about \d+ MB to download once/);
  expect(lyricsCost({ model: "nope" as never, quality: "fast" })).toBe("");
});

it("saves the language for a song that does not set its own", () => {
  render(<AfterSplitOptions />);
  fireEvent.change(screen.getByLabelText("Lyrics language"), { target: { value: "german" } });
  expect(JSON.parse(localStorage.getItem("gp5.song.afterSplit.v1") ?? "{}").language).toBe("german");
});
