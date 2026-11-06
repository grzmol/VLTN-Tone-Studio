import { describe, expect, it } from "vitest";
import type { Section } from "../performance/sections";
import { DEFAULT_BAND_SETTINGS, isBandSettings, parseBandSettings } from "./arrangement";
import {
  bassOverrideAt,
  clearBassOverrideAt,
  noteNameOf,
  noteSourceAt,
  parseBassOverrides,
  scopeRanges,
  setBassOverride,
  usesFlats,
  type BassOverride,
  type ScopeContext,
} from "./bass-overrides";
import type { BeatGrid } from "./beat-grid";
import { harmonyForSong, parseChordName, type ChordAtBeat } from "./harmony";

/** Eight beats of half a second in 4/4, so the song is four seconds long. */
const grid: BeatGrid = { beatsPerBar: 4, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], downbeat: 0, bpm: 120, steady: null };
const SONG_END = 4;
/** A chorus over beats 0 to 3, a verse over beats 4 and 5, and a second chorus over beats 6 and 7. */
const SECTIONS: Section[] = [
  { id: "c1", name: "Chorus", start: 0, end: 2, mode: "continue" },
  { id: "v", name: "Verse", start: 2, end: 3, mode: "continue" },
  { id: "c2", name: "Chorus", start: 3, end: 4, mode: "continue" },
];
const NAMES = ["G", "G", "C", "C", "Am", "Am", "G", "G"];

function harmonyOf(names: readonly (string | null)[]): ChordAtBeat[] {
  return names.map((name, beat) => ({ beat, time: grid.beats[beat], chord: name === null ? null : parseChordName(name) }));
}

const context: ScopeContext = { grid, harmony: harmonyOf(NAMES), sections: SECTIONS, songEnd: SONG_END };

describe("parseBassOverrides", () => {
  it("gives none for anything that is not a list", () => {
    expect(parseBassOverrides(undefined)).toEqual([]);
    expect(parseBassOverrides("G")).toEqual([]);
    expect(parseBassOverrides({ start: 0 })).toEqual([]);
  });

  it("keeps each valid entry and drops the ones that are not", () => {
    const parsed = parseBassOverrides([
      { start: 1, end: 2, pc: 7 },
      { start: 0, end: 1, pc: 3, octave: -1 },
      { start: 3, end: 3, pc: 4 },
      { start: 4, end: 5, pc: 12 },
      { start: 5, end: 6, pc: 1.5 },
      { start: 6, end: 7, pc: 2, octave: 2 },
      { start: -1, end: 1, pc: 2 },
      "nope",
    ]);
    expect(parsed).toEqual([
      { start: 0, end: 1, pc: 3, octave: -1 },
      { start: 1, end: 2, pc: 7 },
    ]);
  });

  it("drops an entry that overlaps an earlier one", () => {
    const parsed = parseBassOverrides([
      { start: 0, end: 2, pc: 1 },
      { start: 1, end: 3, pc: 2 },
      { start: 2, end: 4, pc: 3 },
    ]);
    expect(parsed.map((entry) => entry.pc)).toEqual([1, 3]);
  });
});

describe("setBassOverride", () => {
  const base: BassOverride[] = [
    { start: 0, end: 4, pc: 1 },
    { start: 6, end: 8, pc: 2 },
  ];

  it("adds an override where nothing is set, in time order", () => {
    expect(setBassOverride([], { start: 2, end: 3, pc: 5 })).toEqual([{ start: 2, end: 3, pc: 5 }]);
  });

  it("cuts an overlapped override back to the parts outside the new one", () => {
    expect(setBassOverride(base, { start: 1, end: 2, pc: 9 })).toEqual([
      { start: 0, end: 1, pc: 1 },
      { start: 1, end: 2, pc: 9 },
      { start: 2, end: 4, pc: 1 },
      { start: 6, end: 8, pc: 2 },
    ]);
  });

  it("replaces an override it covers entirely", () => {
    expect(setBassOverride(base, { start: 6, end: 8, pc: 11, octave: 1 })).toEqual([
      { start: 0, end: 4, pc: 1 },
      { start: 6, end: 8, pc: 11, octave: 1 },
    ]);
  });
});

describe("clearBassOverrideAt", () => {
  it("removes the whole override covering a time, and keeps the others", () => {
    const overrides: BassOverride[] = [
      { start: 0, end: 4, pc: 1 },
      { start: 4, end: 8, pc: 2 },
    ];
    expect(clearBassOverrideAt(overrides, 1)).toEqual([{ start: 4, end: 8, pc: 2 }]);
    expect(clearBassOverrideAt(overrides, 9)).toEqual(overrides);
    expect(bassOverrideAt(overrides, 4)?.pc).toBe(2);
  });
});

describe("scopeRanges", () => {
  it("beat: the beat's own time", () => {
    expect(scopeRanges("beat", 1, context)).toEqual([{ start: 0.5, end: 1 }]);
  });

  it("bar: from the bar line before the beat to the next one", () => {
    expect(scopeRanges("bar", 1, context)).toEqual([{ start: 0, end: 2 }]);
    expect(scopeRanges("bar", 5, context)).toEqual([{ start: 2, end: 4 }]);
  });

  it("untilChange: to the next beat whose chord differs", () => {
    expect(scopeRanges("untilChange", 0, context)).toEqual([{ start: 0, end: 1 }]);
    expect(scopeRanges("untilChange", 2, context)).toEqual([{ start: 1, end: 2 }]);
  });

  it("sectionChord: this chord in every section with this name, and not in other sections", () => {
    // The G on beats 0 and 1 of the first chorus, and the G on beats 6 and 7 of the second: the verse's Am is not in it.
    expect(scopeRanges("sectionChord", 0, context)).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
    ]);
  });

  it("sectionChord: a song without sections covers the whole song with the chord", () => {
    const flat = { ...context, sections: [] };
    expect(scopeRanges("sectionChord", 4, flat)).toEqual([{ start: 2, end: 3 }]);
  });

  it("a beat with no chord covers only itself, for any scope", () => {
    const rest = { ...context, harmony: harmonyOf([null, ...NAMES.slice(1)]) };
    for (const scope of ["bar", "untilChange", "sectionChord"] as const) {
      expect(scopeRanges(scope, 0, rest)).toEqual([{ start: 0, end: 0.5 }]);
    }
  });
});

describe("note names and sources", () => {
  it("spells the notes with flats when the song's chords do", () => {
    expect(usesFlats(harmonyOf(["Bb", "Eb", "F", "Gm"]))).toBe(true);
    expect(usesFlats(harmonyOf(["F#", "E", "A"]))).toBe(false);
    expect(usesFlats(harmonyOf([null, null]))).toBe(false);
    expect(noteNameOf(10, true)).toBe("Bb");
    expect(noteNameOf(10, false)).toBe("A#");
    expect(noteNameOf(-2, false)).toBe("A#");
  });

  it("says where the bass note comes from: your note first, then the original bass, then the chords", () => {
    const harmony = harmonyOf(["C", "C", "C", "C"]);
    const reading = [
      { beat: 0, pc: 0, confidence: 0.9 },
      { beat: 1, pc: 4, confidence: 0.9 },
      { beat: 2, pc: 0, confidence: 0.1 },
      { beat: 3, pc: 0, confidence: 0.9 },
    ];
    const overrides: BassOverride[] = [{ start: 0.5, end: 1, pc: 4 }];
    expect(noteSourceAt(0, harmony, [], reading, "original")).toBe("original-bass");
    expect(noteSourceAt(1, harmony, overrides, reading, "original")).toBe("your-note");
    expect(noteSourceAt(2, harmony, [], reading, "original")).toBe("chords");
    expect(noteSourceAt(0, harmony, [], reading, "chords")).toBe("chords");
  });
});

describe("harmony with the performer's notes", () => {
  const detected = NAMES.map((name, i) => ({ time: grid.beats[i], name, confidence: 1 }));
  const plain = (overrides: BassOverride[]) => harmonyForSong(grid, [], detected, SONG_END, null, overrides);

  it("an override sets the bass of its beats, and keeps the chord's root and quality", () => {
    const harmony = plain([{ start: 0, end: 1.5, pc: 11 }]);
    expect(harmony[0].chord).toEqual({ ...parseChordName("G")!, bass: 11 });
    expect(harmony[2].chord?.bass).toBe(11);
    expect(harmony[3].chord?.bass).toBe(parseChordName("C")!.bass);
  });

  it("an octave nudge is kept on the chord", () => {
    const harmony = plain([{ start: 0, end: 0.5, pc: 2, octave: 1 }]);
    expect(harmony[0].chord?.bassOctave).toBe(1);
    expect(harmony[1].chord?.bassOctave).toBeUndefined();
  });

  it("removing the override restores the chords' own bass", () => {
    expect(plain([])).toEqual(harmonyForSong(grid, [], detected, SONG_END));
    expect(plain([])[0].chord?.bass).toBe(parseChordName("G")!.bass);
  });
});

describe("saved band settings", () => {
  it("keep the overrides that are valid, and default to none", () => {
    expect(DEFAULT_BAND_SETTINGS.bassOverrides).toEqual([]);
    const saved = parseBandSettings({
      bassOverrides: [
        { start: 1, end: 2, pc: 4 },
        { start: 3, end: 1, pc: 4 },
      ],
    });
    expect(saved.bassOverrides).toEqual([{ start: 1, end: 2, pc: 4 }]);
    expect(parseBandSettings({ bassOverrides: "bad" }).bassOverrides).toEqual([]);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassOverrides: [] })).toBe(true);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassOverrides: "bad" })).toBe(false);
  });
});

describe("an override on a beat with no chord", () => {
  it("plays the chosen note there instead of resting", async () => {
    const { withBassOverrides } = await import("./harmony");
    const perBeat: ChordAtBeat[] = [
      { beat: 0, time: 0, chord: parseChordName("A") },
      { beat: 1, time: 0.5, chord: null },
    ];
    const result = withBassOverrides(perBeat, [{ start: 0.5, end: 1, pc: 4 }]);
    expect(result[1].chord?.bass).toBe(4);
    expect(result[1].chord?.root).toBe(4);
    expect(result[0].chord?.bass).toBe(9);
  });
});
