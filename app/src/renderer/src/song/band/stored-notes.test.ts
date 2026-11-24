import { describe, expect, it } from "vitest";
import { bandNotesOf, fromStoredNotes, parseBandNotes, toStoredNotes, updatedBandNotes } from "./stored-notes";
import type { NoteEvent } from "./note";

const NOTES: NoteEvent[] = [
  { time: 0.5, pitch: 36, velocity: 100, duration: 0.1 },
  { time: 1.25, pitch: 33, velocity: 80, duration: 0.4, slideFrom: 2 },
  { time: 2.0005, pitch: 33, velocity: 40, duration: 0.05, dead: true },
];

describe("stored band notes", () => {
  it("round trips times to the millisecond", () => {
    const back = fromStoredNotes(toStoredNotes(NOTES));
    expect(back.map((n) => [n.time, n.pitch, n.velocity, n.duration])).toEqual([
      [0.5, 36, 100, 0.1],
      [1.25, 33, 80, 0.4],
      [2.001, 33, 40, 0.05],
    ]);
  });

  it("keeps the dead and slide flags", () => {
    const stored = toStoredNotes(NOTES);
    expect(stored.map((note) => note[4])).toEqual([0, 2, 1]);
    const back = fromStoredNotes(stored);
    expect(back[0].dead).toBeUndefined();
    expect(back[1].slideFrom).toBeDefined();
    expect(back[2].dead).toBe(true);
  });

  it("survives a trip through JSON", () => {
    const saved = bandNotesOf({ drums: NOTES.slice(0, 1), bass: NOTES.slice(1) }, 2, 77);
    expect(parseBandNotes(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("gives none for malformed input", () => {
    const good = bandNotesOf({ drums: NOTES, bass: [] }, 2, 1);
    expect(parseBandNotes(undefined)).toBeNull();
    expect(parseBandNotes("notes")).toBeNull();
    expect(parseBandNotes({ ...good, seed: "x" })).toBeNull();
    expect(parseBandNotes({ ...good, drums: [[1, 2, 3]] })).toBeNull();
    expect(parseBandNotes({ ...good, drums: [[0, 200, 100, 100, 0]] })).toBeNull();
    expect(parseBandNotes({ ...good, bass: [[0, 36, 100, 100, 9]] })).toBeNull();
    expect(parseBandNotes({ ...good, bass: "none" })).toBeNull();
    expect(parseBandNotes({ ...good, drums: Array.from({ length: 20001 }, () => [0, 36, 100, 100, 0]) })).toBeNull();
  });

  it("keeps the notes of a part that was not generated this time, and drops a part that is off", () => {
    const before = bandNotesOf({ drums: NOTES.slice(0, 1), bass: NOTES.slice(1) }, 2, 5);
    const bassOnly = updatedBandNotes(before, { drums: [], bass: NOTES.slice(2) }, { drums: false, bass: true }, { drums: true, bass: true }, 2, 5);
    expect(bassOnly.drums).toEqual(before.drums);
    expect(bassOnly.bass).toHaveLength(1);
    const drumsOff = updatedBandNotes(before, { drums: [], bass: NOTES }, { drums: false, bass: true }, { drums: false, bass: true }, 2, 6);
    expect(drumsOff.drums).toEqual([]);
    expect(drumsOff.seed).toBe(6);
  });
});
