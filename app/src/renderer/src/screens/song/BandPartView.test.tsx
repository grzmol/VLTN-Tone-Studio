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
  const props: BandPartViewProps = {
    notes: NOTES,
    grid,
    harmony: [],
    sections: SECTIONS,
    selected: 0,
    onSelect: vi.fn(),
    onPlayFrom: vi.fn(),
    marks: [],
    ...patch,
  };
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

  it("opens a menu with the eight marks when a bar is clicked, and a Stop puts a mark at the bar's time", () => {
    const onMarks = vi.fn();
    const props = view({ selected: 1, onMarks });
    // The chorus starts at 4 s, so its second bar starts at 6 s.
    fireEvent.click(screen.getAllByRole("button", { name: /^Bar/ })[1]);
    const menu = screen.getByRole("group", { name: "Marks for Bar 2" });
    for (const name of ["Fill", "No fill", "Stop", "Crash", "No crash", "Drums out", "Bass out", "Hit"]) {
      expect(within(menu).getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(within(menu).getByRole("button", { name: "Stop" }));
    expect(onMarks).toHaveBeenCalledWith([{ time: 6, kind: "stop" }]);
    expect(props.onPlayFrom).not.toHaveBeenCalled();
  });

  it("puts the chosen length on a stop, and takes a mark off when it is chosen again", () => {
    const onMarks = vi.fn();
    view({ selected: 1, onMarks, marks: [{ time: 6, kind: "crash" }] });
    fireEvent.click(screen.getAllByRole("button", { name: /^Bar 2/ })[0]);
    const menu = screen.getByRole("group", { name: "Marks for Bar 2" });
    fireEvent.click(within(menu).getByRole("button", { name: "4" }));
    fireEvent.click(within(menu).getByRole("button", { name: "Stop" }));
    expect(onMarks).toHaveBeenLastCalledWith([
      { time: 6, kind: "crash" },
      { time: 6, kind: "stop", beats: 4 },
    ]);
    fireEvent.click(within(menu).getByRole("button", { name: "Crash" }));
    expect(onMarks).toHaveBeenLastCalledWith([]);
  });

  it("marks a bar by its time even when the mark was saved a little off the bar line, and moves it onto the line when it changes", () => {
    const onMarks = vi.fn();
    view({ selected: 1, onMarks, marks: [{ time: 6.1, kind: "crash" }] });
    fireEvent.click(screen.getAllByRole("button", { name: /^Bar 2/ })[0]);
    fireEvent.click(within(screen.getByRole("group", { name: "Marks for Bar 2" })).getByRole("button", { name: "Hit" }));
    expect(onMarks).toHaveBeenCalledWith([
      { time: 6, kind: "crash" },
      { time: 6, kind: "hit" },
    ]);
  });

  it("lists the marks with where they are, and removes one or all", () => {
    const onMarks = vi.fn();
    const marks = [
      { time: 6, kind: "stop" as const, beats: 2 },
      { time: 4, kind: "fill" as const },
    ];
    view({ selected: 1, onMarks, marks });
    const list = screen.getByRole("region", { name: "Your marks" });
    expect(within(list).getByText("Your marks (2)")).toBeTruthy();
    expect(within(list).getByText("Chorus, bar 1: Fill, 2 beats")).toBeTruthy();
    expect(within(list).getByText("Chorus, bar 2: Stop, 2 beats")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Remove Fill, 2 beats at Chorus, bar 1" }));
    expect(onMarks).toHaveBeenLastCalledWith([marks[0]]);
    fireEvent.click(within(list).getByRole("button", { name: "Remove all" }));
    expect(onMarks).toHaveBeenLastCalledWith([]);
  });

  it("says a mark that is on no bar is not on the song, and can still remove it", () => {
    view({ selected: 1, onMarks: vi.fn(), marks: [{ time: 900, kind: "fill" }] });
    expect(screen.getByText("Not on a bar of this song: Fill, 2 beats")).toBeTruthy();
  });

  it("leaves the marks alone while the band is busy", () => {
    view({ selected: 1, onMarks: vi.fn(), disabled: true });
    fireEvent.click(screen.getAllByRole("button", { name: /^Bar/ })[0]);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does nothing when a bar is clicked where the song cannot be played from, as in stage mode", () => {
    view({ selected: 1, onPlayFrom: undefined });
    expect((screen.getAllByRole("button", { name: /^Bar/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
