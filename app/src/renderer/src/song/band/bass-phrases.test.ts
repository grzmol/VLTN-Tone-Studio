import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections, type BandSettings, type SectionOverride } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { BASS_NOTE_RANGES, generateBass, melodicApproach } from "./bass";
import { chooseVariation, chordScale, fillScale, scaleNeighbours, isPhraseEnd, leadSteps, phraseBars, variationSeed, variationSteps, walkDown } from "./bass-phrases";
import type { Feel } from "./feel";
import { parseChordName, withBassOverrides, type ChordAtBeat } from "./harmony";
import { createRandom } from "./random";
import type { Section } from "../performance/sections";
import type { NoteEvent } from "./note";

/** A grid of `bars` bars in 4/4 at 120 BPM (a beat every half second). */
const gridOf = (bars: number): BeatGrid => ({
  beatsPerBar: 4,
  beats: Array.from({ length: bars * 4 }, (_, i) => i * 0.5),
  downbeat: 0,
  bpm: 120,
  steady: null,
});

/** One chord per bar, for the four beats of each bar. */
const harmonyOf = (names: readonly string[]): ChordAtBeat[] =>
  names.flatMap((name, bar) => [0, 1, 2, 3].map((b) => ({ beat: bar * 4 + b, time: (bar * 4 + b) * 0.5, chord: parseChordName(name) })));

const section = (id: string, name: string, start: number, end: number): Section => ({ id, name, start, end, mode: "continue" });

/** The notes of one bar, from the start of the bar (bars are 2 seconds long). */
const barOf = (notes: readonly NoteEvent[], bar: number): NoteEvent[] => notes.filter((note) => Math.floor(note.time / 2 + 1e-9) === bar);

/** Settings with the bass pitch fixed to roots, so the notes are easy to read. */
const settingsWith = (sections: Record<string, SectionOverride>): BandSettings => ({
  ...DEFAULT_BAND_SETTINGS,
  complexity: 1,
  lockToKick: false,
  bassMode: "roots",
  bassRange: "normal",
  sections,
});

/** Generates the bass of a song of `bars` bars (the last one is the ending), with the given sections and chords. */
function generate(sections: Section[], names: readonly string[], overrides: Record<string, SectionOverride>, extra: { feel?: Feel } = {}) {
  const bars = names.length;
  const settings = settingsWith(overrides);
  const plans = planSections(sections, bars * 2, settings);
  return generateBass(gridOf(bars), harmonyOf(names), plans, settings, [], 9, extra.feel);
}

describe("approach notes in a known key", () => {
  const cMajor = { start: 0, end: 100, tonic: 0, mode: "major" as const };
  /** E is 40 in the normal range, and the note before it is a G (43), so F sharp and F are both close. */
  const into = (key: typeof cMajor | null, semitones: number): number | null => melodicApproach(key, 40, 43, BASS_NOTE_RANGES.normal, semitones);

  it("takes the scale note below or above the target instead of a whole tone: F, not F sharp, into E in C major", () => {
    expect(into(null, 2)).toBe(42);
    expect(into(cMajor, 2)).toBe(41);
  });

  it("keeps the semitone approach at complexity 2/3 and up, and outside the key", () => {
    expect(into(cMajor, 1)).toBe(41);
    // E flat is not in C major, so the whole tone applies: D flat or F, and F is the nearer to the G.
    expect(melodicApproach(cMajor, 39, 43, BASS_NOTE_RANGES.normal, 2)).toBe(41);
  });

  it("ignores the key at engine 1", () => {
    const settings = { ...settingsWith({ a: { bassPart: "melodic", fills: 0 } }), complexity: 0.4, engine: 1 };
    const names = ["G", "G", "G", "G", "E", "E", "E", "E", "E"];
    const plans = planSections([section("a", "Verse", 0, 16)], 18, settings);
    const notes = generateBass(gridOf(names.length), harmonyOf(names), plans, settings, [], 9, undefined, undefined, [{ start: 0, end: 18, tonic: 0, mode: "major" }]);
    expect(barOf(notes, 3).at(-1)!.pitch % 12).toBe(6);
  });
});

describe("phrase rules", () => {
  it("makes a phrase four bars, or two in a section under four bars", () => {
    expect(phraseBars(3)).toBe(2);
    expect(phraseBars(4)).toBe(4);
    expect(isPhraseEnd(3, 8)).toBe(true);
    expect(isPhraseEnd(2, 8)).toBe(false);
    expect(isPhraseEnd(1, 2)).toBe(true);
    // A short last phrase still closes on the section's last bar.
    expect(isPhraseEnd(5, 6)).toBe(true);
  });

  it("gives no variation at fills 0, and only in every second phrase at fills 1", () => {
    const random = createRandom(4);
    for (let i = 0; i < 20; i++) expect(chooseVariation(0, "groove", 1, random)).toBeNull();
    for (let i = 0; i < 20; i++) expect(chooseVariation(1, "groove", 0, random)).toBeNull();
    for (let i = 0; i < 20; i++) expect(chooseVariation(1, "groove", 1, random)?.count).toBeLessThanOrEqual(2);
  });

  it("sizes the variation by fills: one or two notes at fills 1, two or three at fills 2, up to four at fills 3", () => {
    const counts = (fills: 1 | 2 | 3) => {
      const random = createRandom(7);
      return Array.from({ length: 400 }, () => chooseVariation(fills, "groove", 1, random)!.count);
    };
    expect(Math.min(...counts(1))).toBe(1);
    expect(Math.max(...counts(1))).toBe(2);
    expect(Math.min(...counts(2))).toBe(2);
    expect(Math.max(...counts(2))).toBe(3);
    expect(Math.max(...counts(3))).toBe(4);
  });

  it("lets a ring or a pedal only pickup or empty its last beat at fills 1 or less", () => {
    for (const part of ["ring", "pedal"] as const) {
      const random = createRandom(11);
      const kinds = new Set(Array.from({ length: 300 }, () => chooseVariation(1, part, 1, random)!.kind));
      expect([...kinds].sort()).toEqual(["empty", "pickup"]);
      const more = createRandom(12);
      expect(new Set(Array.from({ length: 300 }, () => chooseVariation(2, part, 0, more)!.kind)).size).toBe(4);
    }
  });

  it("places a pickup on the last eighths of the bar, and an empty variation on the last beat", () => {
    const random = createRandom(1);
    expect(variationSteps({ kind: "pickup", count: 2 }, 16, 4, random).add.map((note) => note.step)).toEqual([14, 12]);
    expect(variationSteps({ kind: "empty", count: 1 }, 16, 4, random).remove).toEqual([12, 13, 14, 15]);
  });

  it("walks a run down to the next root: chromatic at busy 4 and up, and by the chord's scale below", () => {
    expect(walkDown(60, 1, chordScale(60, "major"), true)).toBe(59);
    expect(walkDown(60, 2, chordScale(60, "major"), true)).toBe(58);
    // The major scale from C: B is in it, B flat is not, so the step below C is B and the one below that A.
    expect(walkDown(60, 1, chordScale(60, "major"), false)).toBe(59);
    expect(walkDown(60, 2, chordScale(60, "major"), false)).toBe(57);
    // The minor scale from C has B flat.
    expect(walkDown(60, 1, chordScale(60, "minor"), false)).toBe(58);
    expect(walkDown(60, 0, chordScale(60, "major"), false)).toBe(60);
  });

  it("keeps a run in the song's key: in C major a run into F plays C, D, E and a run into G plays D, E, F", () => {
    const cMajor = { tonic: 0, mode: "major" as const };
    const run = (target: number, count: number, key: typeof cMajor | null): number[] =>
      Array.from({ length: count }, (_, k) => walkDown(target, count - k, fillScale(target, "major", key), false));
    // F is 53. A three-note run is C, D, E either way; a fourth note shows the difference: B in the key, B flat in F major.
    expect(run(53, 3, cMajor)).toEqual([48, 50, 52]);
    expect(run(53, 4, cMajor)).toEqual([47, 48, 50, 52]);
    expect(run(53, 4, null)).toEqual([46, 48, 50, 52]);
    // G is 55: the key gives F natural, G major would give F sharp.
    expect(run(55, 3, cMajor)).toEqual([50, 52, 53]);
    expect(run(55, 3, null)).toEqual([50, 52, 54]);
  });

  it("walks the minor scale in a minor key, and falls back to the chord's quality outside the key", () => {
    const aMinor = { tonic: 9, mode: "minor" as const };
    // Into E (a major V chord in A minor) the key's natural minor scale applies, not E major: D, not D sharp, is below E.
    expect(walkDown(52, 1, fillScale(52, "major", aMinor), false)).toBe(50);
    expect(walkDown(52, 1, fillScale(52, "major", null), false)).toBe(51);
    // E flat is outside A minor, so a fill into it uses the chord's own quality.
    expect(fillScale(51, "major", aMinor)).toEqual(chordScale(51, "major"));
  });

  it("finds the scale notes a step below and above a target", () => {
    expect(scaleNeighbours(53, fillScale(53, "major", { tonic: 0, mode: "major" }))).toEqual([52, 55]);
    expect(scaleNeighbours(52, fillScale(52, "major", { tonic: 0, mode: "major" }))).toEqual([50, 53]);
  });

  it("ends a lead-in on the target root, with the notes before it walking up to it", () => {
    const lead = leadSteps(3, 16);
    expect(lead).toHaveLength(3);
    expect(lead.map((note) => note.step)).toEqual([8, 11, 13]);
    expect(lead.at(-1)).toMatchObject({ kind: "lead", offset: 0 });
    expect(leadSteps(9, 16)).toHaveLength(4);
  });

  it("gives every seed stream its own sequence per section occurrence", () => {
    expect(variationSeed(3, "Verse", 0)).not.toBe(variationSeed(3, "Verse", 1));
    expect(variationSeed(3, "Verse", 0)).not.toBe(variationSeed(3, "Chorus", 0));
    expect(variationSeed(3, "Verse", 0)).toBe(variationSeed(3, "Verse", 0));
  });
});

describe("bass phrases in a generated song", () => {
  // An eleven-bar verse: bar 10 is the song's ending. Phrases end on bars 3, 7 and 10.
  const verse = [section("v", "Verse", 0, 22)];
  const names = Array(11).fill("C");

  // Timing and pitch are compared. A variation adds or moves notes in its bar, which shifts the jitter stream of later notes, so their
  // velocities can move by a few units; the timing and the pitch of every other bar stay as they were.
  it("keeps the timing and pitch of every bar that does not close a phrase, and changes only phrase-end bars with fills 3", () => {
    const base = generate(verse, names, { v: { bassPart: "pulse", busy: 2, fills: 0 } });
    const varied = generate(verse, names, { v: { bassPart: "pulse", busy: 2, fills: 3 } });
    const changed: number[] = [];
    for (let bar = 0; bar < 10; bar++) {
      const same = JSON.stringify(barOf(base, bar).map((n) => [n.time, n.pitch])) === JSON.stringify(barOf(varied, bar).map((n) => [n.time, n.pitch]));
      if (!same) changed.push(bar);
    }
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((bar) => bar % 4 === 3)).toBe(true);
  });

  it("plays a variation in every phrase at fills 3", () => {
    const base = generate(verse, names, { v: { bassPart: "pulse", busy: 2, fills: 0 } });
    const varied = generate(verse, names, { v: { bassPart: "pulse", busy: 2, fills: 3 } });
    for (const bar of [3, 7]) {
      expect(JSON.stringify(barOf(varied, bar).map((n) => [n.time, n.pitch]))).not.toBe(JSON.stringify(barOf(base, bar).map((n) => [n.time, n.pitch])));
    }
  });

  it("gives no variation at fills 0, so every bar keeps its four quarter notes", () => {
    const notes = generate(verse, names, { v: { bassPart: "pulse", busy: 2, fills: 0 } });
    for (let bar = 0; bar < 10; bar++) expect(barOf(notes, bar)).toHaveLength(4);
  });

  it("gives a ring or a pedal only pickups or empty beats at fills 1", () => {
    for (const part of ["ring", "pedal"] as const) {
      const notes = generate(verse, names, { v: { bassPart: part, busy: 2, fills: 1 } });
      const base = generate(verse, names, { v: { bassPart: part, busy: 2, fills: 0 } });
      for (let bar = 0; bar < 10; bar++) {
        const extra = barOf(notes, bar).length - barOf(base, bar).length;
        // A pickup adds up to two notes, a run or a pop would add the same notes at other places: a run needs at least two.
        const onPickupSpots = barOf(notes, bar).every((note) => note.time >= bar * 2 + 1.5 - 1e-9 || note.time === bar * 2);
        expect(onPickupSpots, `${part} bar ${bar}`).toBe(true);
        expect(extra).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("lead-ins and hit the one", () => {
  // A verse of four bars, then a chorus of a different name, on another chord: the lead-in is in the verse's last bar.
  const sections = [section("v", "Verse", 0, 8), section("c", "Chorus", 8, 16)];
  const names = [...Array(4).fill("C"), ...Array(5).fill("G")];

  it("ends a lead-in on the next section's first root", () => {
    const notes = generate(sections, names, {});
    const lastVerseBar = barOf(notes, 3);
    expect(lastVerseBar.length).toBeGreaterThan(0);
    const last = lastVerseBar.at(-1)!;
    expect(last.time).toBeLessThan(8);
    expect(((last.pitch % 12) + 12) % 12).toBe(7);
  });

  it("keeps a note set by hand where the lead-in would go", () => {
    // E set by hand on the last two beats of the verse, where the lead-in into the chorus's G would play.
    const settings = settingsWith({});
    const plans = planSections(sections, names.length * 2, settings);
    const harmony = withBassOverrides(harmonyOf(names), [{ start: 7, end: 8, pc: 4 }]);
    const notes = generateBass(gridOf(names.length), harmony, plans, settings, [], 9);
    const handSet = notes.filter((note) => note.time >= 7 - 1e-9 && note.time < 8);
    expect(handSet.length).toBeGreaterThan(0);
    expect(handSet.every((note) => ((note.pitch % 12) + 12) % 12 === 4)).toBe(true);
  });

  it("plays no lead-in when the verse is followed by a stop", () => {
    const withStop = generate(sections, names, {}, { feel: { profiles: [], stops: new Set([14, 15]), hits: new Set<number>() } as unknown as Feel });
    expect(barOf(withStop, 3).filter((note) => note.time >= 7 - 1e-9)).toEqual([]);
    const without = generate(sections, names, {});
    expect(barOf(without, 3).some((note) => note.time >= 7 - 1e-9)).toBe(true);
  });

  it("holds the first note of a chorus to the bar end, and hits it harder", () => {
    // A chorus of one note a bar, so nothing else sounds before the bar end and the held note is not cut by the next one.
    const hit = generate(sections, names, { c: { hitTheOne: true, bassPart: "ring", busy: 2 } });
    const plain = generate(sections, names, { c: { hitTheOne: false, bassPart: "ring", busy: 2 } });
    const first = hit.find((note) => Math.abs(note.time - 8) < 1e-9)!;
    const same = plain.find((note) => Math.abs(note.time - 8) < 1e-9)!;
    expect(first.duration).toBeCloseTo(1.97, 2);
    expect(first.velocity - same.velocity).toBe(6);
  });
});

describe("a section's second time round", () => {
  // Verse, chorus, verse, chorus: the two verses are four bars each, and the chorus that follows the second verse ends the song.
  const sections = [section("v1", "Verse", 0, 8), section("c1", "Chorus", 8, 16), section("v2", "Verse", 16, 24), section("c2", "Chorus", 24, 32)];
  const names = [...Array(4).fill("C"), ...Array(4).fill("G"), ...Array(4).fill("C"), ...Array(4).fill("G"), "G"];
  const overrides: Record<string, SectionOverride> = {
    v1: { bassPart: "pulse", busy: 2, fills: 3 },
    v2: { bassPart: "pulse", busy: 2, fills: 3 },
  };

  it("plays the first three bars of a repeated section the same, and varies its phrase end differently", () => {
    const notes = generate(sections, names, overrides);
    const first = (bar: number) => barOf(notes, bar).map((note) => [note.time - bar * 2, note.pitch, note.velocity]);
    const second = (bar: number) => barOf(notes, bar + 8).map((note) => [note.time - (bar + 8) * 2, note.pitch, note.velocity]);
    for (const bar of [1, 2]) expect(second(bar), `bar ${bar}`).toEqual(first(bar));
    expect(JSON.stringify(second(3))).not.toBe(JSON.stringify(first(3)));
  });
});
