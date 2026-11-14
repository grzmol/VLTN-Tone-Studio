import { describe, expect, it } from "vitest";
import {
  FRET_COUNT,
  SCALES,
  STANDARD_TUNING,
  defaultSoloScale,
  noteName,
  octaveUp,
  parseSoloScale,
  scaleDef,
  scaleNotesOnNeck,
  scalePositions,
  type ScaleId,
  type ScalePosition,
} from "./scales";

const A = 9;
const E = 4;
const G = 7;

/** The frets of a position per string, low E first. */
function fretsByString(position: ScalePosition): number[][] {
  return STANDARD_TUNING.map((_, string) => position.notes.filter((note) => note.string === string).map((note) => note.fret));
}

describe("scale positions", () => {
  it("A minor pentatonic position 1 sits at the 5th fret", () => {
    expect(fretsByString(scalePositions(A, "minorPentatonic")[0])).toEqual([
      [5, 8],
      [5, 7],
      [5, 7],
      [5, 7],
      [5, 8],
      [5, 8],
    ]);
  });

  it("A minor pentatonic position 2", () => {
    expect(fretsByString(scalePositions(A, "minorPentatonic")[1])).toEqual([
      [8, 10],
      [7, 10],
      [7, 10],
      [7, 9],
      [8, 10],
      [8, 10],
    ]);
  });

  it("E minor pentatonic position 1 starts at the open string", () => {
    const position = scalePositions(E, "minorPentatonic")[0];
    expect(fretsByString(position)[0]).toEqual([0, 3]);
    expect(position.fromFret).toBe(0);
  });

  it("G major position 1 has three notes per string", () => {
    expect(fretsByString(scalePositions(G, "major")[0])).toEqual([
      [3, 5, 7],
      [3, 5, 7],
      [4, 5, 7],
      [4, 5, 7],
      [5, 7, 8],
      [5, 7, 8],
    ]);
  });

  it("A blues position 1 adds the flat fifth inside the box", () => {
    const frets = fretsByString(scalePositions(A, "blues")[0]);
    expect(frets[1]).toEqual([5, 6, 7]);
    expect(frets[3]).toEqual([5, 7, 8]);
    expect(frets[0]).toEqual([5, 8]);
    const flatFives = scalePositions(A, "blues")[0].notes.filter((note) => note.degree === "b5");
    expect(flatFives.map((note) => [note.string, note.fret])).toEqual([
      [1, 6],
      [3, 8],
    ]);
  });

  it("has five positions for pentatonic scales and blues, seven for the others", () => {
    for (const scale of SCALES) {
      const expected = scaleDef(scale.id).intervals.length === 5 || scale.id === "blues" ? 5 : 7;
      expect(scalePositions(A, scale.id)).toHaveLength(expected);
    }
  });

  it("gives every string two or three notes, all in the scale, for every root", () => {
    for (const scale of SCALES) {
      const def = scaleDef(scale.id);
      for (let root = 0; root < 12; root++) {
        for (const position of scalePositions(root, scale.id)) {
          expect(position.fromFret).toBeGreaterThanOrEqual(0);
          expect(position.toFret).toBeLessThanOrEqual(FRET_COUNT);
          for (const frets of fretsByString(position)) {
            expect(frets.length).toBeGreaterThanOrEqual(2);
            expect(frets.length).toBeLessThanOrEqual(scale.id === "blues" ? 4 : 3);
          }
          for (const note of position.notes) {
            expect(def.intervals).toContain((note.pc - root + 12) % 12);
            expect((STANDARD_TUNING[note.string] + note.fret) % 12).toBe(note.pc);
          }
        }
      }
    }
  });

  it("covers every scale note from fret 3 to 15 with the positions and their copies 12 frets up", () => {
    for (const scale of SCALES) {
      for (let root = 0; root < 12; root++) {
        const covered = new Set<string>();
        for (const position of scalePositions(root, scale.id)) {
          for (const shown of [position, octaveUp(position)]) {
            shown?.notes.forEach((note) => covered.add(`${note.string}:${note.fret}`));
          }
        }
        // A box that would start below the nut moves up 12 frets, so the lowest frets (open strings to fret 2) are not part of the check.
        // The blues flat fifth is only in the boxes where it fits, so the walk covers the minor pentatonic notes
        const walked: ScaleId = scale.id === "blues" ? "minorPentatonic" : scale.id;
        for (const note of scaleNotesOnNeck(root, walked)) {
          if (note.fret >= 3 && note.fret <= 15) expect(covered.has(`${note.string}:${note.fret}`)).toBe(true);
        }
      }
    }
  });
});

describe("scaleNotesOnNeck", () => {
  it("lists the notes of A minor pentatonic with the root marked", () => {
    const notes = scaleNotesOnNeck(A, "minorPentatonic");
    expect(notes.filter((note) => note.string === 0 && note.root).map((note) => note.fret)).toEqual([5, 17]);
    expect(notes.filter((note) => note.string === 5 && note.fret <= 5).map((note) => [note.fret, note.degree])).toEqual(
      [
        [0, "5"],
        [3, "b7"],
        [5, "R"],
      ].map(([fret, degree]) => [fret, degree]),
    );
    expect(Math.max(...notes.map((note) => note.fret))).toBeLessThanOrEqual(FRET_COUNT);
  });
});

describe("octaveUp", () => {
  it("moves a position 12 frets up", () => {
    const position = scalePositions(E, "minorPentatonic")[0];
    const up = octaveUp(position);
    expect(up?.fromFret).toBe(12);
    expect(up?.toFret).toBe(position.toFret + 12);
    expect(up?.notes[0].fret).toBe(position.notes[0].fret + 12);
  });

  it("returns null when a note would pass the last fret", () => {
    const high: ScalePosition = { number: 1, fromFret: 10, toFret: 11, notes: [] };
    expect(octaveUp(high)).toBeNull();
    expect(octaveUp({ ...high, toFret: 10 })).not.toBeNull();
  });
});

describe("defaultSoloScale", () => {
  it("uses a minor key's own tonic", () => {
    expect(defaultSoloScale("A minor")).toEqual({ scale: "minorPentatonic", root: A });
  });

  it("uses the relative minor of a major key", () => {
    expect(defaultSoloScale("A major")).toEqual({ scale: "minorPentatonic", root: 6, relativeOf: "A major" });
  });

  it("gives null with no usable key", () => {
    expect(defaultSoloScale(undefined)).toBeNull();
    expect(defaultSoloScale("")).toBeNull();
    expect(defaultSoloScale("nonsense")).toBeNull();
  });
});

describe("noteName", () => {
  it("spells with flats or sharps", () => {
    expect(noteName(1, true)).toBe("Db");
    expect(noteName(1, false)).toBe("C#");
    expect(noteName(13, false)).toBe("C#");
    expect(noteName(0, true)).toBe("C");
  });
});

describe("parseSoloScale", () => {
  it("keeps valid values", () => {
    expect(parseSoloScale({ scale: "dorian", root: 2 })).toEqual({ scale: "dorian", root: 2 });
  });

  it("drops anything invalid", () => {
    expect(parseSoloScale({ scale: "lydian", root: 12 })).toEqual({});
    expect(parseSoloScale({ scale: 3, root: 1.5 })).toEqual({});
    expect(parseSoloScale({ root: "2" })).toEqual({});
    expect(parseSoloScale(null)).toEqual({});
    expect(parseSoloScale("blues")).toEqual({});
  });
});
