import { describe, expect, it } from "vitest";
import type { Cue } from "../performance/chart";
import type { Chord } from "../performance/chords";
import {
  chartChordEvents,
  chordChangeTimes,
  chordsPerBeat,
  chordTones,
  harmonyForSong,
  mergeShortChords,
  parseChordName,
  withOriginalBass,
  type ChordAtBeat,
} from "./harmony";
import type { BassLineBeat } from "../analysis/bass-line";
import type { BeatGrid } from "./beat-grid";

/** A grid of `count` beats, `interval` seconds apart, starting at zero. */
function grid(count: number, interval = 0.5): BeatGrid {
  return {
    beatsPerBar: 4,
    beats: Array.from({ length: count }, (_, i) => i * interval),
    downbeat: 0,
    bpm: 60 / interval,
    steady: null,
  };
}

function line(time: number, text: string): Cue {
  return { time, text, messages: [] };
}

const trigger: Cue = { time: 0, text: "", messages: [], trigger: "load" };

/** Beat entries for a list of chord names, one per beat, with `null` for a rest. */
function beatsNamed(names: (string | null)[], interval = 0.5): ChordAtBeat[] {
  return names.map((name, i) => ({ beat: i, time: i * interval, chord: name === null ? null : parseChordName(name) }));
}

const namesOf = (perBeat: ChordAtBeat[]) => perBeat.map((entry) => entry.chord?.name ?? null);

describe("parseChordName", () => {
  it("reads a major triad", () => {
    expect(parseChordName("C")).toEqual({ root: 0, quality: "major", seventh: "none", bass: 0, name: "C" });
  });

  it("reads minor triads, including a flat root", () => {
    expect(parseChordName("Am")).toMatchObject({ root: 9, quality: "minor", seventh: "none", bass: 9 });
    expect(parseChordName("Ebm")).toMatchObject({ root: 3, quality: "minor", seventh: "none" });
  });

  it("reads sharps and flats in sevenths", () => {
    expect(parseChordName("F#m7")).toMatchObject({ root: 6, quality: "minor", seventh: "min7" });
    expect(parseChordName("Bb7")).toMatchObject({ root: 10, quality: "major", seventh: "dom7" });
    expect(parseChordName("Bbm")).toMatchObject({ root: 10, quality: "minor", seventh: "none" });
  });

  it("reads major sevenths", () => {
    expect(parseChordName("Cmaj7")).toMatchObject({ root: 0, quality: "major", seventh: "maj7" });
  });

  it("takes the slash note as the bass", () => {
    expect(parseChordName("D/F#")).toMatchObject({ root: 2, quality: "major", bass: 6, name: "D/F#" });
    expect(parseChordName("G/B")).toMatchObject({ root: 7, bass: 11 });
  });

  it("reads suspended and power chords", () => {
    expect(parseChordName("Gsus4")).toMatchObject({ root: 7, quality: "sus4", seventh: "none" });
    expect(parseChordName("E5")).toMatchObject({ root: 4, quality: "power", seventh: "none" });
  });

  it("reads diminished chords and half-diminished sevenths", () => {
    expect(parseChordName("Bdim")).toMatchObject({ root: 11, quality: "dim", seventh: "none" });
    expect(parseChordName("Bm7b5")).toMatchObject({ root: 11, quality: "dim", seventh: "half-dim" });
  });

  it.each([
    { name: "C6", root: 0, quality: "major", seventh: "none" },
    { name: "Cadd9", root: 0, quality: "major", seventh: "none" },
    { name: "C9", root: 0, quality: "major", seventh: "dom7" },
    { name: "Am9", root: 9, quality: "minor", seventh: "min7" },
    { name: "Cmaj9", root: 0, quality: "major", seventh: "maj7" },
    { name: "G7sus4", root: 7, quality: "sus4", seventh: "dom7" },
    { name: "Em11", root: 4, quality: "minor", seventh: "min7" },
    { name: "C7#9", root: 0, quality: "major", seventh: "dom7" },
    { name: "Bbm6", root: 10, quality: "minor", seventh: "none" },
    { name: "Dm(maj7)", root: 2, quality: "minor", seventh: "maj7" },
    { name: "A13", root: 9, quality: "major", seventh: "dom7" },
    { name: "F#ø", root: 6, quality: "dim", seventh: "half-dim" },
  ])("derives $name from its suffix", ({ name, ...expected }) => {
    expect(parseChordName(name)).toMatchObject(expected);
  });

  it("returns null for a rest, an unparseable root, or an unparseable slash bass", () => {
    expect(parseChordName("N")).toBeNull();
    expect(parseChordName("")).toBeNull();
    expect(parseChordName("Hello")).toBeNull();
    expect(parseChordName("H7")).toBeNull();
    expect(parseChordName("Am/")).toBeNull();
    expect(parseChordName("C/H")).toBeNull();
  });
});

describe("chartChordEvents", () => {
  it("gives one chord per line the line's time", () => {
    expect(chartChordEvents([line(10, "[Am] one"), line(14, "[G] two")])).toEqual([
      { time: 10, name: "Am" },
      { time: 14, name: "G" },
    ]);
  });

  it("spreads two chords evenly to the next timed line", () => {
    expect(chartChordEvents([line(10, "[Am] [C] lyric"), line(14, "[G] next")])).toEqual([
      { time: 10, name: "Am" },
      { time: 12, name: "C" },
      { time: 14, name: "G" },
    ]);
  });

  it("gives the last line two seconds a chord", () => {
    expect(chartChordEvents([line(30, "[F] [G]")])).toEqual([
      { time: 30, name: "F" },
      { time: 32, name: "G" },
    ]);
  });

  it("skips triggers and keeps rests", () => {
    expect(chartChordEvents([trigger, line(5, "[N] rest"), trigger])).toEqual([{ time: 5, name: "N" }]);
  });
});

describe("chordsPerBeat", () => {
  // Am from 0 s, C from 1.2 s, to the end at 4 s. A beat runs from its time to the next beat.
  const events = [
    { time: 0, name: "Am" },
    { time: 1.2, name: "C" },
  ];

  it("gives a mid-beat change to the beat it covers most", () => {
    // The beat at 1.0 s runs to 1.5 s. C covers 0.3 s of it and Am 0.2 s, so that beat is C.
    expect(namesOf(chordsPerBeat(grid(8), events, 4)).slice(0, 4)).toEqual(["Am", "Am", "C", "C"]);
  });

  it("keeps the earlier chord when the change falls on the late half of the beat", () => {
    const later = [
      { time: 0, name: "Am" },
      { time: 1.3, name: "C" },
    ];
    expect(namesOf(chordsPerBeat(grid(8), later, 4)).slice(0, 3)).toEqual(["Am", "Am", "Am"]);
  });

  it("gives no chord before the first event", () => {
    const perBeat = chordsPerBeat(grid(6), [{ time: 1, name: "G" }], 3);
    expect(namesOf(perBeat)).toEqual([null, null, "G", "G", "G", "G"]);
  });

  it("runs the last beat to the song end", () => {
    // The last beat is at 1.0 s and runs to 2.0 s. G covers 0.8 s of it and Am 0.2 s.
    const perBeat = chordsPerBeat(
      grid(3),
      [
        { time: 0, name: "Am" },
        { time: 1.2, name: "G" },
      ],
      2,
    );
    expect(namesOf(perBeat)).toEqual(["Am", "Am", "G"]);
  });
});

describe("mergeShortChords", () => {
  it("merges a one-beat blip between the same chord", () => {
    expect(namesOf(mergeShortChords(beatsNamed(["C", "C", "Am", "C", "C"])))).toEqual(["C", "C", "C", "C", "C"]);
  });

  it("keeps a real two-beat change", () => {
    const names = ["C", "C", "Am", "Am", "C", "C"];
    expect(namesOf(mergeShortChords(beatsNamed(names)))).toEqual(names);
  });

  it("keeps a blip at the start of the song and a blip next to a rest", () => {
    expect(namesOf(mergeShortChords(beatsNamed(["Am", "C", "C"])))).toEqual(["Am", "C", "C"]);
    expect(namesOf(mergeShortChords(beatsNamed(["C", null, "C"])))).toEqual(["C", null, "C"]);
  });
});

/** A bass reading per beat: the pitch class each beat's bass note has (null for none), at one confidence. */
function readingOf(pcs: (number | null)[], confidence = 1): BassLineBeat[] {
  return pcs.map((pc, beat) => ({ beat, pc, confidence: pc === null ? 0 : confidence }));
}

describe("chordTones", () => {
  it("gives the root, third, fifth and seventh of a chord", () => {
    expect(chordTones(parseChordName("Bm")!)).toEqual([11, 2, 6]);
    expect(chordTones(parseChordName("G7")!)).toEqual([7, 11, 2, 5]);
    expect(chordTones(parseChordName("Dm7b5")!)).toEqual([2, 5, 8, 0]);
  });

  it("gives the root and fifth of a power chord, with no third", () => {
    expect(chordTones(parseChordName("E5")!)).toEqual([4, 11]);
  });
});

describe("withOriginalBass", () => {
  it("puts the played note under the chord, and keeps the chord's root and quality", () => {
    const perBeat = beatsNamed(["Bm", "Bm", "Bm", "Bm"]);
    const out = withOriginalBass(perBeat, readingOf([4, 4, 4, 4]));
    expect(out.map((entry) => entry.chord?.bass)).toEqual([4, 4, 4, 4]);
    expect(out.map((entry) => entry.chord?.name)).toEqual(["Bm", "Bm", "Bm", "Bm"]);
    expect(out[0].chord).toMatchObject({ root: 11, quality: "minor" });
  });

  it("uses the next chord for a beat whose played note is that chord's root, when the detected chord is late", () => {
    // The detected change to E comes a beat late: the bass plays E on the beat before it.
    const out = withOriginalBass(beatsNamed(["F#m", "F#m", "E", "E"]), readingOf([6, 4, 4, 4]));
    expect(out.map((entry) => entry.chord?.name)).toEqual(["F#m", "E", "E", "E"]);
    expect(out[1].chord).toMatchObject({ root: 4, bass: 4 });
  });

  it("keeps the chord when the played note is one of its own notes", () => {
    const out = withOriginalBass(beatsNamed(["Am", "Am"]), readingOf([4, 9]));
    expect(out.map((entry) => entry.chord?.name)).toEqual(["Am", "Am"]);
    expect(out.map((entry) => entry.chord?.bass)).toEqual([4, 9]);
  });

  it("keeps the chord's own bass where the reading is not confident, or is missing", () => {
    const perBeat = beatsNamed(["D/F#", "D/F#", "D/F#"]);
    const unsure = withOriginalBass(perBeat, [
      { beat: 0, pc: 4, confidence: 0.5 },
      { beat: 1, pc: null, confidence: 0 },
    ]);
    expect(unsure.map((entry) => entry.chord?.bass)).toEqual([6, 6, 6]);
  });

  it("leaves rests as rests", () => {
    expect(withOriginalBass(beatsNamed([null, "C"]), readingOf([4, 0]))[0].chord).toBeNull();
  });
});

describe("harmonyForSong", () => {
  const detected: Chord[] = [
    { time: 0, name: "G", confidence: 0.9 },
    { time: 1, name: "N", confidence: 0.1 },
  ];

  it("uses the chart's chords when it has any", () => {
    const cues = [line(0, "[Am] verse"), line(1, "[F] verse")];
    expect(namesOf(harmonyForSong(grid(6), cues, detected, 3)).slice(0, 4)).toEqual(["Am", "Am", "F", "F"]);
  });

  it("uses the detected chords when the chart has none, ignoring confidence", () => {
    const perBeat = harmonyForSong(grid(6), [line(0, "lyrics only")], detected, 3);
    expect(namesOf(perBeat)).toEqual(["G", "G", null, null, null, null]);
  });

  it("gives a rest where the chart says N", () => {
    const perBeat = harmonyForSong(grid(4), [line(0, "[N] instrumental"), line(1, "[D] line")], [], 2);
    expect(perBeat[0].chord).toBeNull();
    expect(perBeat[2].chord?.name).toBe("D");
  });

  it("puts the original bass under the chords when given the bass line, and leaves the chords as they are without it", () => {
    const cues = [line(0, "[Am] verse")];
    expect(harmonyForSong(grid(4), cues, [], 2, readingOf([4, 4, 4, 4])).map((entry) => entry.chord?.bass)).toEqual([4, 4, 4, 4]);
    expect(harmonyForSong(grid(4), cues, [], 2, null).map((entry) => entry.chord?.bass)).toEqual([9, 9, 9, 9]);
  });
});

describe("detected chord names in the band", () => {
  it("keep their shapes through the band's harmony: a power chord, a slash chord and a seventh", () => {
    const detected: Chord[] = [
      { time: 0, name: "A5", confidence: 1 },
      { time: 2, name: "C/G", confidence: 1 },
      { time: 4, name: "Cmaj7", confidence: 1 },
    ];
    const perBeat = harmonyForSong(grid(12), [], detected, 6);
    expect(perBeat[0].chord).toMatchObject({ root: 9, quality: "power" });
    expect(perBeat[4].chord).toMatchObject({ root: 0, bass: 7, quality: "major" });
    expect(perBeat[8].chord).toMatchObject({ root: 0, seventh: "maj7" });
  });
});

describe("chordChangeTimes", () => {
  it("returns the times of the beats where the chord changes", () => {
    const perBeat = beatsNamed(["C", "C", "C", "Am", "Am", "C", "C"]);
    expect(chordChangeTimes(perBeat)).toEqual([1.5, 2.5]);
  });

  it("counts a chord that starts after a rest, but not the first beat", () => {
    expect(chordChangeTimes(beatsNamed([null, null, "C"]))).toEqual([1]);
  });
});
