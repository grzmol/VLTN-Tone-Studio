import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedBeatGrid } from "@/song/band/beat-grid";
import { CLOSED_HAT, KICK, SNARE, type NoteEvent } from "@/song/band/note";
import { bandNotesOf } from "@/song/band/stored-notes";
import { BandPartView, type BandPartViewProps } from "./BandPartView";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  // jsdom has no canvas: the view skips drawing, and the summary is what a test reads.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as typeof Element.prototype.hasPointerCapture;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// 120 BPM in 4/4: a bar is 2 s. A verse of two bars, then a chorus of four.
const grid = fixedBeatGrid(120, 0, 4, 40);
const drum = (time: number, pitch: number): NoteEvent => ({ time, pitch, velocity: 100, duration: 0.1 });
const NOTES = bandNotesOf(
  {
    drums: [drum(0, KICK), drum(0, CLOSED_HAT), drum(0.5, CLOSED_HAT), drum(1, SNARE), drum(1, KICK), drum(4, KICK)],
    bass: [
      { time: 0, pitch: 28, velocity: 90, duration: 0.5 },
      { time: 1, pitch: 33, velocity: 90, duration: 0.5 },
    ],
  },
  2,
  1,
);
const SECTIONS = [
  { name: "Verse", start: 0, end: 4 },
  { name: "Chorus", start: 4, end: 12 },
];

function view(patch: Partial<BandPartViewProps> = {}) {
  const props: BandPartViewProps = { notes: NOTES, grid, harmony: [], sections: SECTIONS, selected: 0, onSelect: vi.fn(), onPlayFrom: vi.fn(), ...patch };
  render(<BandPartView {...props} />);
  return props;
}

describe("BandPartView", () => {
  it("asks for a Generate when the song has no saved notes", () => {
    view({ notes: null });
    expect(screen.getByText("Generate once to see the parts.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Bar/ })).toBeNull();
  });

  it("renders a summary for each bar of the section, and a hidden table of the bass notes", () => {
    view();
    expect(screen.getByRole("button", { name: "Bar 1: kick 2, snare 1, hats 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bar 2: no drums" })).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Bar 1")).toBeTruthy();
    expect(within(table).getByText("E1 on beat 1, A1 on beat 3")).toBeTruthy();
    expect(within(table).getByText("no bass")).toBeTruthy();
  });

  it("moves between sections with Previous and Next", () => {
    const props = view({ selected: 0 });
    expect((screen.getByRole("button", { name: "Previous section" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(props.onSelect).toHaveBeenCalledWith(1);
  });

  it("starts the song at a bar when the bar is clicked", () => {
    const props = view({ selected: 1 });
    // The chorus starts at 4 s, so its second bar starts at 6 s.
    fireEvent.click(screen.getAllByRole("button", { name: /^Bar/ })[1]);
    expect(props.onPlayFrom).toHaveBeenCalledWith(6);
  });

  it("does nothing when a bar is clicked where the song cannot be played from, as in stage mode", () => {
    view({ selected: 1, onPlayFrom: undefined });
    expect((screen.getAllByRole("button", { name: /^Bar/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
