import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "@/song/band/beat-grid";
import { parseChordName, type ChordAtBeat } from "@/song/band/harmony";
import type { BassOverride } from "@/song/band/bass-overrides";
import type { Section } from "@/song/performance/sections";
import { BassNoteEditor, BassNoteList, type BassNotesContext } from "./BassNotes";

// jsdom has no layout: the Radix select measures with these.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as typeof Element.prototype.hasPointerCapture;
});
afterEach(cleanup);

/** Eight beats of half a second in 4/4: a chorus over beats 0 to 3, a verse over 4 and 5, a second chorus over 6 and 7. */
const grid: BeatGrid = { beatsPerBar: 4, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], downbeat: 0, bpm: 120, steady: null };
const SECTIONS: Section[] = [
  { id: "c1", name: "Chorus", start: 0, end: 2, mode: "continue" },
  { id: "v", name: "Verse", start: 2, end: 3, mode: "continue" },
  { id: "c2", name: "Chorus", start: 3, end: 4, mode: "continue" },
];
const NAMES = ["G", "G", "C", "C", "Am", "Am", "G", "G"];
const harmony: ChordAtBeat[] = NAMES.map((name, beat) => ({ beat, time: grid.beats[beat], chord: parseChordName(name) }));

function context(overrides: BassOverride[] = [], patch: Partial<BassNotesContext> = {}): BassNotesContext {
  return {
    grid,
    harmony,
    overrides,
    sections: SECTIONS,
    songEnd: 4,
    bassLine: null,
    bassFrom: "original",
    disabled: false,
    onChange: vi.fn(),
    onListen: vi.fn(),
    ...patch,
  };
}

/** Picks an option of a shadcn select, opened from its trigger with the keyboard. */
function pick(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("BassNoteEditor", () => {
  it("shows the beat, the chord, the note the bass plays now and where it comes from", () => {
    render(<BassNoteEditor beat={0} context={context()} onClose={vi.fn()} />);
    expect(screen.getByText("Beat 1 at 0.0 s, bar 1")).toBeTruthy();
    expect(screen.getByText("Chord: G")).toBeTruthy();
    expect(screen.getByText("The bass plays G, from the chords.")).toBeTruthy();
  });

  it("says a note the performer set is their own", () => {
    render(<BassNoteEditor beat={0} context={context([{ start: 0, end: 0.5, pc: 4 }])} onClose={vi.fn()} />);
    expect(screen.getByText("The bass plays G, your note.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Bass note" }).textContent).toBe("E");
  });

  it("applies the note to the beat by default, and to the chord in the section when that scope is picked", () => {
    const first = context();
    const { unmount } = render(<BassNoteEditor beat={0} context={first} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(first.onChange).toHaveBeenCalledWith([{ start: 0, end: 0.5, pc: 7 }]);
    unmount();

    const second = context();
    render(<BassNoteEditor beat={0} context={second} onClose={vi.fn()} />);
    pick(screen.getByRole("combobox", { name: "Apply to" }), "This chord everywhere in this section");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // The G of the first chorus and the G of the second; the verse's Am is not in it.
    expect(second.onChange).toHaveBeenCalledWith([
      { start: 0, end: 1, pc: 7 },
      { start: 3, end: 4, pc: 7 },
    ]);
  });

  it("lists Reset only where the beat has a note of its own, and Reset removes it", () => {
    const plain = context();
    const { unmount } = render(<BassNoteEditor beat={0} context={plain} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reset" }).hasAttribute("disabled")).toBe(true);
    unmount();

    const set = context([{ start: 0, end: 0.5, pc: 4 }]);
    render(<BassNoteEditor beat={0} context={set} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(set.onChange).toHaveBeenCalledWith([]);
  });

  it("listens to about two bars from before the beat, with the choice, and saves nothing", () => {
    const listening = context();
    render(<BassNoteEditor beat={5} context={listening} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    // The beat is at 2.5 s and a bar is 2 s long here, so the listen starts at 0.5 s. Beat 6 is an A minor chord, so the note is A (9).
    expect(listening.onListen).toHaveBeenCalledWith(0.5, [{ start: 2.5, end: 3, pc: 9 }]);
    expect(listening.onChange).not.toHaveBeenCalled();
  });

  it("disables the edits while the song plays", () => {
    render(<BassNoteEditor beat={0} context={context([], { disabled: true })} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Listen" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("BassNoteList", () => {
  it("shows each note with its range, removes one, and Remove all", () => {
    const overrides: BassOverride[] = [
      { start: 0, end: 1, pc: 4 },
      { start: 2, end: 3, pc: 9, octave: 1 },
    ];
    const ctx = context(overrides);
    render(<BassNoteList harmony={harmony} overrides={overrides} disabled={false} onChange={ctx.onChange} />);
    expect(screen.getByRole("heading", { name: "Your bass notes (2)" })).toBeTruthy();
    expect(screen.getByText("A up an octave, 2.0 s to 3.0 s")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove the bass note from 0.0 s" }));
    expect(ctx.onChange).toHaveBeenLastCalledWith([overrides[1]]);
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    expect(ctx.onChange).toHaveBeenLastCalledWith([]);
  });

  it("shows nothing when there are no notes", () => {
    const { container } = render(<BassNoteList harmony={harmony} overrides={[]} disabled={false} onChange={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
