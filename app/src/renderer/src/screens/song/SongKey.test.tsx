import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SongKey } from "./SongKey";

const key = "vltn.performance.v1:key-test";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("saves the key the performer chooses and reports it for spelling chords", () => {
  const onSpellingKey = vi.fn();
  render(<SongKey storageKey={key} onSpellingKey={onSpellingKey} />);
  expect(screen.getByText("Song key: Unknown")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Song key override"), { target: { value: "Bb major" } });
  expect(onSpellingKey).toHaveBeenLastCalledWith("Bb major");
  expect(JSON.parse(localStorage.getItem(key + ":options") ?? "{}")).toMatchObject({ songKey: "Bb major" });
});

it("falls back to the library key, and a chosen key wins over it", () => {
  const onSpellingKey = vi.fn();
  render(<SongKey storageKey={key} libraryKey="A minor" onSpellingKey={onSpellingKey} />);
  expect(onSpellingKey).toHaveBeenLastCalledWith("A minor");
  fireEvent.change(screen.getByLabelText("Song key override"), { target: { value: "C major" } });
  expect(onSpellingKey).toHaveBeenLastCalledWith("C major");
});

it("shows the chords' displayed key when the song is transposed", () => {
  render(<SongKey storageKey={key} libraryKey="C major" shift={2} />);
  expect(screen.getByText(/Displayed chords: D major \(\+2 semitones\)/)).toBeTruthy();
});
