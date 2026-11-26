import { describe, expect, it } from "vitest";
import { chooseFigure, degreePitchClass, figure, figureScore, isPlain, lockToKick } from "./bass-figures";
import { rhythmScore } from "./feel";
import { parseChordName } from "./harmony";
import { STYLES } from "./styles";

const ALL_STYLES = Object.values(STYLES);
import { ENERGIES } from "./styles/types";

const chord = (name: string) => parseChordName(name)!;

describe("figure", () => {
  it("reads a bar of tokens as steps, degrees, accents and short notes", () => {
    const parsed = figure(16, "1 . . 1> . . 5 . | 1 . . 1 . 8s 5 app");
    expect(parsed.bars).toBe(2);
    expect(parsed.notes[0]).toEqual([
      { step: 0, degree: "1" },
      { step: 6, degree: "1", accent: true },
      { step: 12, degree: "5" },
    ]);
    expect(parsed.notes[1].map((note) => [note.step, note.degree])).toEqual([
      [0, "1"],
      [6, "1"],
      [10, "8"],
      [12, "5"],
      [14, "app"],
    ]);
    expect(parsed.notes[1][2]).toMatchObject({ degree: "8", short: true });
  });

  it("takes a bar on a finer or coarser grid, as long as the tokens divide the steps", () => {
    expect(figure(16, "1 . 5 .").notes[0].map((note) => note.step)).toEqual([0, 8]);
    expect(figure(12, "1 . . . . . 5 . . . . .").notes[0].map((note) => note.step)).toEqual([0, 6]);
    expect(() => figure(16, "1 . .")).toThrow();
    expect(() => figure(16, "9 . . .")).toThrow();
    expect(() => figure(16, "1 . . .", "1 . . .", "1 . . .")).toThrow();
  });
});

describe("the figures of each style", () => {
  for (const style of ALL_STYLES) {
    const steps = style.meter.beatsPerBar * style.meter.stepsPerBeat;
    describe(style.name, () => {
      it("has three to four figures at every energy, and a groove figure at each", () => {
        for (const energy of ENERGIES) {
          const figures = style.bass.figures[energy];
          expect(figures.length).toBeGreaterThanOrEqual(3);
          expect(figures.length).toBeLessThanOrEqual(4);
          expect(figures.some(isPlain)).toBe(true);
        }
      });

      it("starts on the root on the downbeat, except in reggae, and keeps every step inside the bar", () => {
        for (const energy of ENERGIES) {
          for (const candidate of style.bass.figures[energy]) {
            if (style.id !== "reggae") expect(candidate.notes[0][0]).toMatchObject({ step: 0, degree: "1" });
            expect(candidate.notes).toHaveLength(candidate.bars);
            for (const bar of candidate.notes) for (const note of bar) expect(note.step >= 0 && note.step < steps).toBe(true);
          }
        }
      });
    });
  }
});

describe("chooseFigure", () => {
  const rock = STYLES.rock;
  const figures = rock.bass.figures[4];

  it("gives a section name the same figure each time, from its seed", () => {
    expect(chooseFigure(figures, "melodic", 5, "Chorus")).toBe(chooseFigure(figures, "melodic", 5, "Chorus"));
    const picked = new Set(Array.from({ length: 30 }, (_, seed) => chooseFigure(figures, "melodic", seed, "Chorus")));
    expect(picked.size).toBeGreaterThan(1);
  });

  it("draws a groove only from figures of roots, fifths and octaves", () => {
    const mixed = [figure(16, "1 . . . 3 . . ."), figure(16, "1 . . . 5 . . .")];
    for (let seed = 0; seed < 20; seed++) expect(chooseFigure(mixed, "groove", seed, "Verse")).toBe(mixed[1]);
  });

  it("takes the figure that fits the accents best when there are clear ones", () => {
    const sparse = figure(16, "1 . . . . . . .");
    const quarters = figure(16, "1 . . . 1 . . . 1 . . . 1 . . .");
    // Strong accents on every beat: the sparse figure leaves three of them uncovered.
    const weights = Float64Array.from({ length: 16 }, (_, step) => (step % 4 === 0 ? 1 : 0));
    const score = (covered: ReadonlySet<number>) => rhythmScore(covered, weights);
    expect(figureScore(sparse, score)).toBeLessThan(figureScore(quarters, score));
    for (let seed = 0; seed < 10; seed++) expect(chooseFigure([sparse, quarters], "melodic", seed, "Verse", score)).toBe(quarters);
  });
});

describe("lockToKick", () => {
  const notes = figure(16, "1 . . 1 . . 5 . . . . . 1 . . .").notes[0];

  it("keeps every figure note, moves one within a step of a kick onto it, and adds a root where the figure misses a kick", () => {
    // Kicks at 0 (on a note), 4 (a step after the note on 3: it moves), 9 (a step from nothing: 6 is three away, 12 is three away), 12.
    const locked = lockToKick(notes, new Set([0, 4, 9, 12]));
    expect(locked.map((note) => [note.step, note.degree])).toEqual([
      [0, "1"],
      [4, "1"],
      [6, "5"],
      [9, "1"],
      [12, "1"],
    ]);
    expect(locked.filter((note) => note.locked).map((note) => note.step)).toEqual([0, 4, 9, 12]);
  });

  it("adds nothing for a kick two steps from a figure note, and never removes a note", () => {
    const locked = lockToKick(notes, new Set([8]));
    expect(locked.map((note) => note.step)).toEqual([0, 3, 6, 12]);
    expect(lockToKick(notes, new Set())).toHaveLength(notes.length);
  });
});

describe("degreePitchClass", () => {
  const aMajor = { tonic: 9, mode: "major" as const };

  it("reads the chord's own third and seventh, and its fifth", () => {
    expect(degreePitchClass("3", chord("Am"), null)).toBe(0);
    expect(degreePitchClass("3", chord("A"), null)).toBe(1);
    expect(degreePitchClass("7", chord("G7"), null)).toBe(5);
    expect(degreePitchClass("5", chord("E"), null)).toBe(11);
    expect(degreePitchClass("1", chord("D/F#"), null)).toBe(6);
  });

  it("takes the key's scale note above a power chord's root for a third, and the fifth with no key", () => {
    // F sharp in A major: the third above is A, not A sharp.
    expect(degreePitchClass("3", chord("F#5"), aMajor)).toBe(9);
    expect(degreePitchClass("3", chord("F#5"), null)).toBe(1);
    expect(degreePitchClass("7", chord("D"), aMajor)).toBe(1);
    expect(degreePitchClass("app", chord("D"), aMajor)).toBeNull();
  });
});
