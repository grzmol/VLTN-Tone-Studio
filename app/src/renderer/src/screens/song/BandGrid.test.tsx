import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "@/song/band/beat-grid";
import { parseChordName, type ChordAtBeat } from "@/song/band/harmony";
import { BandGrid } from "./BandGrid";

afterEach(cleanup);

const grid: BeatGrid = { beatsPerBar: 4, beats: [0, 0.5, 1, 1.5], downbeat: 0, bpm: 120, steady: null };

/** Beat entries for chord names, with the bass note given when it is not the chord's root. */
function harmonyOf(entries: [string, number?][]): ChordAtBeat[] {
  return entries.map(([name, bass], beat) => {
    const chord = parseChordName(name)!;
    return { beat, time: grid.beats[beat], chord: bass === undefined ? chord : { ...chord, bass } };
  });
}

describe("BandGrid bass labels", () => {
  it("shows the bass note under a chord change where it differs from the chord's root", () => {
    // Bm on beat 0 with the bassist on E (4): E is shown under the chord. Beat 1 stays Bm and gets no new label.
    const { container } = render(<BandGrid grid={grid} harmony={harmonyOf([["Bm", 4], ["Bm", 4], ["G"], ["G"]])} />);
    const labels = [...container.querySelectorAll('[title="Bass note played under this chord"]')].map((node) => node.textContent);
    expect(labels).toEqual(["E"]);
    expect(container.textContent).toContain("Bm");
  });

  it("shows no bass label where the bass is the chord's root", () => {
    const { container } = render(<BandGrid grid={grid} harmony={harmonyOf([["G"], ["G"], ["Am"], ["Am"]])} />);
    expect(container.querySelector('[title="Bass note played under this chord"]')).toBeNull();
  });
});

describe("BandGrid beats and the performer's notes", () => {
  it("makes each beat a button that picks that beat, and marks the selected one", () => {
    const onSelect = vi.fn();
    render(<BandGrid grid={grid} harmony={harmonyOf([["G"], ["G"], ["Am"], ["Am"]])} selected={2} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /^Beat 2,/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.getByRole("button", { name: /^Beat 3,/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the name of a note the performer set, once, above its beats", () => {
    const { container } = render(<BandGrid grid={grid} harmony={harmonyOf([["G"], ["G"], ["Am"], ["Am"]])} overrides={[{ start: 0, end: 1, pc: 4 }]} />);
    const notes = [...container.querySelectorAll('[title="Your bass note"]')].map((node) => node.textContent);
    expect(notes).toEqual(["E"]);
  });
});
