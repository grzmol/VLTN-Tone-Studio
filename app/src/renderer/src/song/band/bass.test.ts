import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings, type BassMode, type BassRange, type SectionPlan } from "./arrangement";
import { bassRangeFor, generateBass } from "./bass";
import { chooseFigure, type Figure } from "./bass-figures";
import { findStyle } from "./styles";
import type { EndingSettings } from "./ending";
import type { BeatGrid } from "./beat-grid";
import type { Feel } from "./feel";
import type { BarMark } from "./marks";
import { parseChordName, type ChordAtBeat } from "./harmony";
import type { NoteEvent } from "./note";

/** A grid of `count` beats at 120 BPM (a beat every 0.5 s), in 4/4. Beats before `downbeat` are a pickup. */
function gridOf(count: number, downbeat = 0): BeatGrid {
  return { beatsPerBar: 4, beats: Array.from({ length: count }, (_, i) => i * 0.5), downbeat, bpm: 120, steady: null };
}

/** One entry per beat, with the chord named in `names` (null for a rest). */
function harmonyFor(names: readonly (string | null)[]): ChordAtBeat[] {
  return names.map((name, beat) => ({ beat, time: beat * 0.5, chord: name === null ? null : parseChordName(name) }));
}

/** Four beats of each chord, one chord per bar. */
function barsOf(...chords: (string | null)[]): (string | null)[] {
  return chords.flatMap((chord) => [chord, chord, chord, chord]);
}

/** A plan from `endBeat` to the end of the song, starting at zero. Beat n is at n / 2 seconds. */
function planFor(endBeat: number, overrides: Partial<SectionPlan> = {}): SectionPlan {
  const energy = overrides.energy ?? 3;
  return {
    sectionId: null,
    start: 0,
    end: endBeat * 0.5,
    style: "rock",
    energy,
    loud: energy,
    busy: energy,
    name: "",
    bassPart: "groove",
    bassRamp: false,
    octave: 0,
    fills: 0,
    hitTheOne: false,
    slides: false,
    deadNotes: false,
    pickups: true,
    fill: false,
    play: { drums: true, bass: true },
    ...overrides,
  };
}

/** Settings with every choice fixed: roots, normal range, no kick lock, full complexity, no swing. */
function settingsFor(overrides: Partial<BandSettings> = {}): BandSettings {
  // The tests here are for the earlier bass (engine 1) unless one sets engine 2: a groove or melodic section plays a figure at engine 2.
  return { ...DEFAULT_BAND_SETTINGS, engine: 1, complexity: 1, swing: 0, lockToKick: false, bassMode: "roots", bassRange: "normal", ...overrides };
}

/** The pitch class of a MIDI note. */
const pc = (pitch: number): number => ((pitch % 12) + 12) % 12;

/** The notes that start in the bar at `bar` (a bar is two seconds in 4/4 at 120 BPM). */
const inBar = (notes: readonly NoteEvent[], bar: number): NoteEvent[] => notes.filter((note) => Math.floor(note.time / 2 + 1e-9) === bar);

describe("generateBass", () => {
  const chords = barsOf("C", "Am", "F", "G", "C", "Am", "F", "G");
  const harmony = harmonyFor(chords);

  it("gives the same notes for the same seed, and a new seed gives different notes", () => {
    const grid = gridOf(chords.length);
    const plans = [planFor(chords.length)];
    const settings = settingsFor({ bassMode: "melodic" });
    expect(generateBass(grid, harmony, plans, settings, [], 5)).toEqual(generateBass(grid, harmony, plans, settings, [], 5));

    // Two variations to choose from, so one pair of seeds can agree by chance. Across eight seeds the output must not all agree.
    const outputs = Array.from({ length: 8 }, (_, seed) => JSON.stringify(generateBass(grid, harmony, plans, settings, [], seed + 1)));
    expect(new Set(outputs).size).toBeGreaterThan(1);
  });

  it("keeps every note inside the range, for each range and mode", () => {
    const ranges: Record<BassRange, [number, number]> = { low: [28, 40], normal: [28, 55], high: [33, 60], extended: [23, 50] };
    const progression = harmonyFor(barsOf("C", "Am", "F", "G/B", "Dm7", "Bdim", "E7", "Aaug"));
    const grid = gridOf(progression.length);
    const modes: [BassMode, string][] = [
      ["roots", "rock"],
      ["fifths", "rock"],
      ["octaves", "rock"],
      ["melodic", "rock"],
      ["walking", "shuffle"],
    ];
    for (const range of Object.keys(ranges) as BassRange[]) {
      const [low, high] = ranges[range];
      for (const [mode, style] of modes) {
        for (const energy of [1, 3, 5] as const) {
          const notes = generateBass(
            grid,
            progression,
            [planFor(progression.length, { style: style as SectionPlan["style"], energy })],
            settingsFor({ bassMode: mode, bassRange: range, complexity: 0.5 }),
            [],
            9,
          );
          expect(notes.length).toBeGreaterThan(0);
          for (const note of notes) {
            expect(note.pitch).toBeGreaterThanOrEqual(low);
            expect(note.pitch).toBeLessThanOrEqual(high);
          }
        }
      }
    }
  });

  it("plays only the bass pitch class in roots mode, and a slash chord plays its slash note", () => {
    const names = barsOf("D/F#", "C", "G");
    const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor(), [], 3);
    const bar0 = inBar(notes, 0);
    const bar1 = inBar(notes, 1);
    expect(bar0.length).toBeGreaterThan(0);
    expect(bar0.every((note) => pc(note.pitch) === 6)).toBe(true);
    expect(bar1.length).toBeGreaterThan(0);
    expect(bar1.every((note) => pc(note.pitch) === 0)).toBe(true);
  });

  it("gives the fifth for major, minor, diminished and augmented chords in roots-fifths", () => {
    const cases: [string, number[]][] = [
      ["C", [0, 7]],
      ["Am", [9, 4]],
      ["Bdim", [11, 5]],
      ["Caug", [0, 8]],
    ];
    for (const [name, allowed] of cases) {
      const names = barsOf(name, name, name, name);
      const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor({ bassMode: "fifths" }), [], 4);
      const seen = new Set(notes.map((note) => pc(note.pitch)));
      expect(
        [...seen].every((value) => allowed.includes(value)),
        name,
      ).toBe(true);
      expect(seen.has(allowed[1]), `${name} fifth`).toBe(true);
    }
  });

  it("puts an approach note a semitone from the next bass note, on the last step before a chord change", () => {
    // C for two beats, then G from beat 2 (one second in). The step before the change must lead into the G.
    const names = [...barsOf("C").slice(0, 2), ...barsOf("G", "G")];
    const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor({ bassMode: "melodic" }), [], 6);
    const before = notes.filter((note) => note.time < 1).at(-1);
    const after = notes.find((note) => note.time >= 1);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(pc(after!.pitch)).toBe(7);
    expect(Math.abs(before!.pitch - after!.pitch)).toBe(1);
    // At loud 3 the base is 75. An approach note is 10 softer, and the seeded jitter is at most 4 either way.
    expect(before!.velocity).toBeGreaterThanOrEqual(61);
    expect(before!.velocity).toBeLessThanOrEqual(69);
  });

  it("uses a whole tone for the approach when complexity is below two thirds", () => {
    const names = [...barsOf("C").slice(0, 2), ...barsOf("G", "G")];
    const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor({ bassMode: "melodic", complexity: 0.5 }), [], 6);
    const before = notes.filter((note) => note.time < 1).at(-1);
    const after = notes.find((note) => note.time >= 1);
    expect(Math.abs(before!.pitch - after!.pitch)).toBe(2);
  });

  it("walks quarter notes on shuffle, with the last one a semitone from the next bar's bass", () => {
    const names = barsOf("C", "F", "G", "C");
    const notes = generateBass(
      gridOf(names.length),
      harmonyFor(names),
      [planFor(names.length, { style: "shuffle" })],
      settingsFor({ bassMode: "walking" }),
      [],
      2,
    );
    for (const bar of [0, 1, 2]) {
      const inThisBar = inBar(notes, bar);
      expect(inThisBar.map((note) => note.time)).toEqual([0, 0.5, 1, 1.5].map((offset) => bar * 2 + offset));
      const next = inBar(notes, bar + 1)[0];
      expect(Math.abs(inThisBar.at(-1)!.pitch - next.pitch)).toBe(1);
    }
  });

  it("locks the onsets to the kick, and keeps the first step of each bar", () => {
    const count = 16;
    const grid = gridOf(count);
    // A kick on every odd beat, 0.5 s, 1.5 s and so on.
    const kick: NoteEvent[] = Array.from({ length: count }, (_, i) => i)
      .filter((i) => i % 2 === 1)
      .map((i) => ({ time: i * 0.5, pitch: 36, velocity: 100, duration: 0.1 }));
    const notes = generateBass(grid, harmonyFor(barsOf("C", "Am", "F", "G")), [planFor(count)], settingsFor({ lockToKick: true }), kick, 8);
    for (const note of notes) {
      const onKick = kick.some((hit) => Math.abs(hit.time - note.time) <= 0.001);
      const onBarStart = Math.abs(note.time / 2 - Math.round(note.time / 2)) < 1e-9;
      expect(onKick || onBarStart, `note at ${note.time}`).toBe(true);
    }
    // The first bar with a kick keeps its first step (the downbeat), even though the kick sits on beat 2.
    for (const bar of [0, 1, 2]) expect(notes.some((note) => Math.abs(note.time - bar * 2) < 1e-9)).toBe(true);
  });

  it("rests on a null chord", () => {
    const names = [...barsOf("C").slice(0, 1), null, "C", "C", ...barsOf("G", "G")];
    const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor(), [], 7);
    expect(notes.some((note) => note.time >= 0.5 && note.time < 1)).toBe(false);
    expect(notes.some((note) => note.time >= 1.5)).toBe(true);
  });

  it("switches to the new bass note at a chord change in the middle of a bar", () => {
    // C for beats 0 and 1, then G for beats 2 and 3, in one bar. Every note from the change on must be G.
    const names = [...barsOf("C").slice(0, 2), "G", "G", ...barsOf("G", "G")];
    const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor(), [], 11);
    const afterChange = notes.filter((note) => note.time >= 1 && note.time < 2);
    expect(afterChange.length).toBeGreaterThan(0);
    expect(afterChange.every((note) => pc(note.pitch) === 7)).toBe(true);
    expect(notes.find((note) => note.time >= 1)!.pitch % 12).toBe(7);
  });

  it("keeps every note inside its bar, with a positive duration", () => {
    const names = barsOf("C", "Am", "F", "G", "C");
    for (const energy of [1, 2, 3, 4, 5] as const) {
      const notes = generateBass(
        gridOf(names.length),
        harmonyFor(names),
        [planFor(names.length, { energy })],
        settingsFor({ bassMode: "melodic" }),
        [],
        13 + energy,
      );
      for (const note of notes) {
        const barEnd = (Math.floor(note.time / 2 + 1e-9) + 1) * 2;
        expect(note.duration).toBeGreaterThan(0);
        expect(note.time + note.duration).toBeLessThanOrEqual(barEnd + 1e-9);
      }
    }
  });

  it("is silent when bass is off, and in the pickup before the downbeat", () => {
    const names = barsOf("C", "F", "G");
    const off = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length, { play: { drums: true, bass: false } })], settingsFor(), [], 1);
    expect(off).toEqual([]);

    const pickup = generateBass(gridOf(names.length, 1), harmonyFor(names), [planFor(names.length)], settingsFor(), [], 1);
    expect(pickup.length).toBeGreaterThan(0);
    expect(pickup.every((note) => note.time >= 0.5)).toBe(true);
  });

  it("holds one bass note for the last bar", () => {
    const names = barsOf("C", "F", "G");
    const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor(), [], 1);
    const last = notes.filter((note) => note.time >= 4);
    expect(last).toHaveLength(1);
    expect(last[0].time).toBe(4);
    expect(pc(last[0].pitch)).toBe(7);
    expect(last[0].duration).toBeCloseTo(2, 9);
  });

  it("moves at most seven semitones between notes in roots mode on C F G C", () => {
    const names = barsOf("C", "F", "G", "C");
    const notes = generateBass(gridOf(names.length), harmonyFor(names), [planFor(names.length)], settingsFor(), [], 21);
    expect(notes.length).toBeGreaterThan(3);
    for (let i = 1; i < notes.length; i++) expect(Math.abs(notes[i].pitch - notes[i - 1].pitch)).toBeLessThanOrEqual(7);
  });
});

describe("generateBass with follow-my-playing", () => {
  const chords = barsOf("C", "Am", "F", "G");
  const harmony = harmonyFor(chords);
  const grid = gridOf(chords.length);
  /** A feel whose accents are the given steps of a bar, with no stops or hits unless a test gives them. */
  const feelOf = (steps: number[], overrides: Partial<Feel> = {}): Feel => {
    const weights = new Float64Array(16);
    for (const step of steps) weights[step] = 1;
    return { profiles: [{ weights, confidence: 1 }], stops: new Set(), hits: new Set(), ...overrides };
  };
  /** The steps, on the 16th grid, where the notes of bar `bar` start. */
  const stepsIn = (notes: readonly NoteEvent[], bar: number): number[] =>
    [...new Set(inBar(notes, bar).map((note) => Math.round((note.time - bar * 2) / 0.125)))].sort((a, b) => a - b);

  it("follows the accents in each bar, and always plays on step 0", () => {
    const notes = generateBass(grid, harmony, [planFor(16)], settingsFor(), [], 4, feelOf([0, 6, 10]));
    for (const bar of [0, 1, 2]) expect(stepsIn(notes, bar)).toEqual([0, 6, 10]);
  });

  it("is silent on a stop, and plays a note on the hit after it", () => {
    // Beats 4 to 7 are a stop (the second bar), and beat 8 is the hit after it.
    const notes = generateBass(grid, harmony, [planFor(16)], settingsFor(), [], 4, feelOf([0], { stops: new Set([4, 5, 6, 7]), hits: new Set([8]) }));
    expect(notes.filter((note) => note.time >= 2 && note.time < 4)).toEqual([]);
    expect(notes.some((note) => Math.abs(note.time - 4) < 1e-9)).toBe(true);
  });

  it("gives the same notes for the same seed with a feel", () => {
    const feel = feelOf([0, 6, 10], { stops: new Set([4]), hits: new Set([8]) });
    expect(generateBass(grid, harmony, [planFor(16)], settingsFor(), [], 9, feel)).toEqual(
      generateBass(grid, harmony, [planFor(16)], settingsFor(), [], 9, feel),
    );
  });
});

describe("generateBass dynamics", () => {
  const chords = barsOf("C", "C", "C", "C", "C", "C", "C", "C");
  const harmony = harmonyFor(chords);
  const grid = gridOf(chords.length);
  /** Notes from several seeds at one loud level, so the mean is not one seed's luck. */
  const notesAt = (loud: SectionPlan["loud"], seeds = 6): NoteEvent[] =>
    Array.from({ length: seeds }, (_, seed) => generateBass(grid, harmony, [planFor(chords.length, { loud })], settingsFor(), [], seed + 1)).flat();
  const mean = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0) / values.length;

  it("plays harder at each louder section level", () => {
    const means = ([1, 2, 3, 4, 5] as const).map((loud) => mean(notesAt(loud).map((note) => note.velocity)));
    for (let i = 1; i < means.length; i++) expect(means[i]).toBeGreaterThan(means[i - 1]);
  });

  it("keeps most notes below 66, the soft layer, at loud 1 and 2", () => {
    for (const loud of [1, 2] as const) {
      const velocities = notesAt(loud).map((note) => note.velocity);
      const soft = velocities.filter((velocity) => velocity < 66).length;
      expect(soft / velocities.length, `loud ${loud}`).toBeGreaterThan(0.5);
    }
  });

  it("accents the downbeat, the first step of each bar", () => {
    const notes = notesAt(3);
    // A bar is two seconds at 120 BPM, so a downbeat note starts on an even second.
    const onDownbeat = notes.filter((note) => Math.abs(note.time / 2 - Math.round(note.time / 2)) < 1e-9).map((note) => note.velocity);
    const elsewhere = notes.filter((note) => Math.abs(note.time / 2 - Math.round(note.time / 2)) >= 1e-9).map((note) => note.velocity);
    expect(onDownbeat.length).toBeGreaterThan(0);
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(mean(onDownbeat) - mean(elsewhere)).toBeGreaterThan(4);
  });

  it("keeps every velocity between 1 and 127, even at loud 5 with the downbeat accent", () => {
    for (const note of notesAt(5)) {
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
    }
  });
});

describe("generateBass by bass part", () => {
  const BARS = 8;
  // One bar more than BARS: the song's last bar is its ending, a held note, so the counts below look at the bars before it.
  const chords = barsOf(...Array.from({ length: BARS + 1 }, () => "C"));
  const harmony = harmonyFor(chords);
  const grid = gridOf(chords.length);
  const perBar = (notes: readonly NoteEvent[]): number[] => Array.from({ length: BARS }, (_, bar) => inBar(notes, bar).length);
  const partSettings = (overrides: Partial<BandSettings> = {}) => settingsFor({ bassFeel: 0.5, ...overrides });
  const run = (plan: Partial<SectionPlan>, overrides: Partial<BandSettings> = {}, names = harmony) =>
    generateBass(grid, names, [planFor(chords.length, plan)], partSettings(overrides), [], 4);

  it("rings one note a bar at busy 2, lasting to the next note", () => {
    const notes = run({ bassPart: "ring", busy: 2, energy: 2 });
    expect(perBar(notes)).toEqual(Array(BARS).fill(1));
    // Two seconds a bar; the note lasts to the next bar, less the 30 ms gap.
    for (const note of notes.filter((note) => note.time < BARS * 2)) expect(note.duration).toBeCloseTo(1.97, 6);
  });

  it("rings two half notes a bar from busy 3, and adds a passing note on every second bar from busy 4", () => {
    expect(perBar(run({ bassPart: "ring", busy: 3 }))).toEqual(Array(BARS).fill(2));
    expect(perBar(run({ bassPart: "ring", busy: 4 }))).toEqual([2, 3, 2, 3, 2, 3, 2, 3]);
  });

  it("pulses four notes a bar at busy 2, eight at busy 3, and lengthens them as loud rises", () => {
    expect(perBar(run({ bassPart: "pulse", busy: 2 }))).toEqual(Array(BARS).fill(4));
    expect(perBar(run({ bassPart: "pulse", busy: 3 }))).toEqual(Array(BARS).fill(8));
    const soft = run({ bassPart: "pulse", busy: 2, loud: 1 })[0].duration;
    const hard = run({ bassPart: "pulse", busy: 2, loud: 5 })[0].duration;
    expect(hard).toBeGreaterThan(soft);
    // 40% of a beat at loud 1 and 90% at loud 5, with the 30 ms gap cut from the beat.
    expect(soft).toBeCloseTo(0.5 * 0.4 - 0.0, 2);
    expect(hard).toBeCloseTo(0.5 * 0.9, 2);
  });

  it("holds one pitch class through chord changes on a pedal, and strikes it once a bar", () => {
    const changing = harmonyFor(barsOf("C", "Am", "F", "G", "C", "Am", "F", "G", "C"));
    const notes = generateBass(grid, changing, [planFor(chords.length, { bassPart: "pedal" })], partSettings(), [], 4);
    expect(perBar(notes)).toEqual(Array(BARS).fill(1));
    expect(new Set(notes.map((note) => pc(note.pitch)))).toEqual(new Set([0]));
  });

  it("does not strike a pedal again for a chord change in the middle of a bar", () => {
    // Bar 0 is C, then G from beat 2. The pedal stays on C and strikes once.
    const midBar = harmonyFor([...["C", "C", "G", "G"], ...Array(BARS * 4).fill("C")]);
    const notes = generateBass(grid, midBar, [planFor(chords.length, { bassPart: "pedal" })], partSettings(), [], 4);
    expect(inBar(notes, 0)).toHaveLength(1);
    expect(pc(notes[0].pitch)).toBe(0);
  });

  it("re-strikes a ring bar on a chord change in the middle of the bar", () => {
    // Bar 0 is C, then G from beat 2. Ring at busy 2 would play one note; the change adds a second on the G.
    const change = harmonyFor([...["C", "C", "G", "G"], ...Array(BARS * 4).fill("C")]);
    const notes = generateBass(grid, change, [planFor(chords.length, { bassPart: "ring", busy: 2 })], partSettings(), [], 4);
    const bar0 = inBar(notes, 0);
    expect(bar0).toHaveLength(2);
    expect(pc(bar0[1].pitch)).toBe(7);
  });

  it("gives nothing for a rest part", () => {
    expect(run({ bassPart: "rest" })).toEqual([]);
  });

  it("walks four notes a bar on the walking part, in any style", () => {
    expect(perBar(run({ bassPart: "walking", style: "rock" }))).toEqual(Array(BARS).fill(4));
  });

  it("scales the lengths by the bass feel, and keeps them inside the next note and the bar", () => {
    const at = (feel: number) => run({ bassPart: "pulse", busy: 2, loud: 3 }, { bassFeel: feel })[0].duration;
    expect(at(1) / at(0)).toBeCloseTo(1.4 / 0.6, 1);
    expect(at(1)).toBeLessThanOrEqual(0.5 - 0.03 + 1e-9);
    expect(at(0)).toBeCloseTo(0.5 * 0.65 * 0.6, 2);
  });

  it("moves the notes of a section up an octave when the range allows, and leaves them when it does not", () => {
    const plain = run({ bassPart: "pulse", busy: 2 });
    const up = run({ bassPart: "pulse", busy: 2, octave: 1 });
    expect(up.map((note) => note.pitch)).toEqual(plain.map((note) => note.pitch + 12));
    const low = generateBass(grid, harmony, [planFor(chords.length, { bassPart: "pulse", busy: 2, octave: 1 })], partSettings({ bassRange: "low" }), [], 4);
    const lowPlain = generateBass(grid, harmony, [planFor(chords.length, { bassPart: "pulse", busy: 2 })], partSettings({ bassRange: "low" }), [], 4);
    expect(low.map((note) => note.pitch)).toEqual(lowPlain.map((note) => note.pitch));
  });

  it("ramps the loud level over the last two bars of a pre-chorus", () => {
    const notes = run({ bassPart: "pulse", busy: 2, loud: 3, bassRamp: true });
    const mean = (bars: number[]) => {
      const values = notes.filter((note) => bars.includes(Math.floor(note.time / 2 + 1e-9))).map((note) => note.velocity);
      return values.reduce((total, value) => total + value, 0) / values.length;
    };
    // The section is nine bars with its ending. The last two are bars 7 and 8, so bar 7 rises by a level (75 to 92 with jitter) and bar 5 does not.
    expect(mean([7]) - mean([0, 1])).toBeGreaterThan(10);
    expect(Math.abs(mean([5]) - mean([0, 1]))).toBeLessThan(8);
  });

  it("plays the lead part for the first bars of a section of four bars or more, and not in a shorter one", () => {
    const led = run({ bassPart: "ring", busy: 3, bassLead: { part: "pedal", bars: 2 } });
    expect(perBar(led).slice(0, 4)).toEqual([1, 1, 2, 2]);
    // Three bars in all, the last being the ending: the section is too short for the lead, so both bars before the ending ring.
    const short = generateBass(
      gridOf(12),
      harmonyFor(barsOf("C", "C", "C")),
      [planFor(12, { bassPart: "ring", busy: 3, bassLead: { part: "pedal", bars: 2 } })],
      partSettings(),
      [],
      4,
    );
    expect([0, 1].map((bar) => inBar(short, bar).length)).toEqual([2, 2]);
  });
});

describe("generateBass with the performer's bass notes (spec 87)", () => {
  const names = barsOf("C", "G");
  const grid = gridOf(names.length);
  const plans = [planFor(names.length)];
  /** The harmony with the second bar's bass set to `bass`, and an octave nudge when given. */
  const withBass = (bass: number, octave?: 1 | -1): ChordAtBeat[] =>
    harmonyFor(names).map((entry, beat) =>
      beat < 4 || !entry.chord ? entry : { ...entry, chord: { ...entry.chord, bass, ...(octave ? { bassOctave: octave } : {}) } },
    );
  const firstOf = (notes: readonly NoteEvent[], bar: number) => inBar(notes, bar)[0];

  it("plays the performer's note on the bar it covers", () => {
    const notes = generateBass(grid, withBass(2), plans, settingsFor(), [], 3);
    expect(pc(firstOf(notes, 1).pitch)).toBe(2);
  });

  it("moves the note by an octave nudge", () => {
    const plain = generateBass(grid, withBass(2), plans, settingsFor(), [], 3);
    const up = generateBass(grid, withBass(2, 1), plans, settingsFor(), [], 3);
    expect(firstOf(up, 1).pitch - firstOf(plain, 1).pitch).toBe(12);
  });
});

describe("generateBass with a section that starts near a bar line", () => {
  const chords = barsOf("C", "C", "C", "C", "F", "F", "F", "F");
  const harmony = harmonyFor(chords);
  const grid = gridOf(chords.length);
  /** Two sections that meet `offset` seconds after the bar line at 8 s, the second hitting the one. */
  const withSplit = (offset: number) => {
    const plans = [planFor(16, { end: 8 + offset, fills: 1 }), planFor(32, { start: 8 + offset, hitTheOne: true })];
    return generateBass(grid, harmony, plans, settingsFor(), [], 4);
  };

  it.each([0.04, -0.04])("plays the hit-the-one note on the bar line when the section starts %f s after it", (offset) => {
    const notes = withSplit(offset);
    const first = notes.find((note) => note.time >= 8 - 1e-9);
    expect(first?.time).toBeCloseTo(8, 9);
    expect(notes).toEqual(withSplit(0));
  });
});

describe("generateBass endings", () => {
  // Four bars of two seconds, C F G C. The song's own end is at 8 s.
  const names = barsOf("C", "F", "G", "C");
  const bass = (ending: EndingSettings, endTime?: number, plans = [planFor(names.length)]) =>
    generateBass(gridOf(names.length), harmonyFor(names), plans, settingsFor({ ending }), [], 1, undefined, endTime);

  it("holds one note on the last downbeat for a hit, and nothing after", () => {
    const notes = bass({ kind: "hit" });
    const last = notes.filter((note) => note.time >= 6);
    expect(last).toHaveLength(1);
    expect(last[0].duration).toBeCloseTo(2, 9);
  });

  it("plays the last bar and then a root that rings for two bars for a hold", () => {
    const notes = bass({ kind: "hold" });
    expect(notes.filter((note) => note.time >= 6 && note.time < 8).length).toBeGreaterThan(0);
    const last = notes.filter((note) => note.time >= 8);
    expect(last).toHaveLength(1);
    expect(last[0].time).toBe(8);
    expect(pc(last[0].pitch)).toBe(0);
    // Two bars of two seconds.
    expect(last[0].duration).toBeCloseTo(4, 9);
  });

  it("plays three roots on the last bar's beats and a last one on the next downbeat for three hits", () => {
    const notes = bass({ kind: "hits" });
    expect(notes.filter((note) => note.time >= 6).map((note) => note.time)).toEqual([6, 6.5, 7, 8]);
    expect(notes.filter((note) => note.time >= 6).every((note) => pc(note.pitch) === 0)).toBe(true);
  });

  it("plays a root on each bar of a slow-down and a last note after it", () => {
    const notes = bass({ kind: "slow", bars: 1 });
    const after = notes.filter((note) => note.time >= 8);
    expect(after).toHaveLength(2);
    expect(after[0].time).toBe(8);
    // The bar of the slow-down is longer than a normal bar of two seconds.
    expect(after[1].time).toBeGreaterThan(10);
  });

  it("plays to the end of the last section with no special ending for none", () => {
    const notes = bass({ kind: "none" });
    expect(notes.filter((note) => note.time >= 6).length).toBeGreaterThan(1);
    expect(notes.every((note) => note.time < 8)).toBe(true);
  });

  it("puts the ending at the end of the section it is asked for", () => {
    const plans = [planFor(8, { sectionId: "verse" }), { ...planFor(16, { sectionId: "outro" }), start: 4 }];
    const notes = bass({ kind: "hit", atSection: "verse" }, undefined, plans);
    expect(notes.filter((note) => note.time >= 2)).toHaveLength(1);
    expect(notes.filter((note) => note.time >= 2)[0].time).toBe(2);
  });

  it("puts the ending on the last full bar before the trim end", () => {
    const notes = bass({ kind: "hit" }, 6.9);
    expect(notes.filter((note) => note.time >= 4)).toHaveLength(1);
    expect(notes.filter((note) => note.time >= 4)[0].time).toBe(4);
  });
});

describe("generateBass with a figure (engine 2)", () => {
  const rock = findStyle("rock")!;
  /** The first seed whose figure for `name` has the shape the test needs, so a test does not depend on which figure a seed happens to pick. */
  const seedFor = (figures: readonly Figure[], part: "groove" | "melodic", name: string, wanted: (figure: Figure) => boolean): number => {
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((candidate) => wanted(chooseFigure(figures, part, candidate, name)));
    if (seed === undefined) throw new Error("no seed gives the figure the test needs");
    return seed;
  };
  const engine2 = (overrides: Partial<BandSettings> = {}): BandSettings => settingsFor({ engine: 2, ...overrides });
  /** A bar as (step, interval above its first note's pitch class), so a bar on another chord with the same figure compares equal. */
  const shapeOf = (notes: readonly NoteEvent[], bar: number): [number, number][] => {
    const own = inBar(notes, bar);
    return own.map((note) => [Math.round(((note.time - bar * 2) / 2) * 16), (note.pitch - own[0].pitch + 120) % 12]);
  };
  const stepsOf = (notes: readonly NoteEvent[], bar: number): number[] => shapeOf(notes, bar).map(([step]) => step);

  it("plays the same figure in bars 1 to 3 of each phrase and changes the fourth", () => {
    const chords = barsOf(...["C", "G", "Am", "F"].flatMap((name) => [name, name, name, name]));
    const figures = rock.bass.figures[4];
    const seed = seedFor(figures, "groove", "Chorus", (figure) => figure.bars === 1);
    const notes = generateBass(
      gridOf(chords.length),
      harmonyFor(chords),
      [planFor(chords.length, { name: "Chorus", energy: 4, fills: 3 })],
      engine2(),
      [],
      seed,
    );
    for (let phrase = 0; phrase < 4; phrase++) {
      const first = phrase * 4;
      expect(shapeOf(notes, first + 1)).toEqual(shapeOf(notes, first));
      expect(shapeOf(notes, first + 2)).toEqual(shapeOf(notes, first));
    }
    // The last bar of a phrase varies, in at least all but the phrase that leads into the ending.
    const varied = [0, 1, 2].filter((phrase) => JSON.stringify(shapeOf(notes, phrase * 4 + 3)) !== JSON.stringify(shapeOf(notes, phrase * 4)));
    expect(varied.length).toBeGreaterThanOrEqual(2);
  });

  it("plays the same figure in Chorus 1 and Chorus 2", () => {
    const chords = barsOf(...Array<string>(12).fill("A"));
    const plans = [
      planFor(16, { name: "Chorus", energy: 4, end: 8 }),
      planFor(32, { name: "Verse", energy: 4, start: 8, end: 16 }),
      planFor(48, { name: "Chorus", energy: 4, start: 16, end: 24 }),
    ];
    const notes = generateBass(gridOf(chords.length), harmonyFor(chords), plans, engine2(), [], 7);
    expect(shapeOf(notes, 0)).toEqual(shapeOf(notes, 8));
    expect(stepsOf(notes, 0).length).toBeGreaterThan(1);
  });

  it("plays the key's third above a power chord that has none: A, not A sharp, over F sharp in A major", () => {
    const ballad = findStyle("ballad")!;
    const seed = seedFor(ballad.bass.figures[4], "melodic", "Verse", (figure) => figure.notes.some((bar) => bar.some((note) => note.degree === "3")));
    const chords = barsOf(...Array<string>(4).fill("F#5"));
    const notes = generateBass(
      gridOf(chords.length),
      harmonyFor(chords),
      [planFor(chords.length, { name: "Verse", style: "ballad", energy: 4, bassPart: "melodic" })],
      engine2(),
      [],
      seed,
      undefined,
      undefined,
      [{ start: 0, end: 8, tonic: 9, mode: "major" }],
    );
    const classes = new Set(notes.slice(0, -1).map((note) => pc(note.pitch)));
    expect(classes.has(9)).toBe(true);
    expect(classes.has(10)).toBe(false);
  });

  it("keeps every figure note when the kick is locked, and gives every kick a bass note within two steps", () => {
    const chords = barsOf("C", "C", "C", "C");
    const seed = seedFor(rock.bass.figures[4], "groove", "Verse", (figure) => figure.bars === 1);
    const figure = chooseFigure(rock.bass.figures[4], "groove", seed, "Verse");
    // A step is an eighth of a half-second beat: 0.125 s. These kicks are on steps 0, 5 (one from a figure note on 6 or 4), 10 and 14.
    const kickSteps = [0, 5, 10, 14];
    const kick: NoteEvent[] = [0, 1, 2, 3].flatMap((bar) =>
      kickSteps.map((step) => ({ time: bar * 2 + step * 0.125, pitch: 36, velocity: 100, duration: 0.1 })),
    );
    const notes = generateBass(
      gridOf(chords.length),
      harmonyFor(chords),
      [planFor(chords.length, { name: "Verse", energy: 4 })],
      engine2({ lockToKick: true }),
      kick,
      seed,
    );
    for (let bar = 0; bar < 3; bar++) {
      const played = stepsOf(notes, bar);
      for (const note of figure.notes[0]) expect(played.some((step) => Math.abs(step - note.step) <= 1)).toBe(true);
      for (const step of kickSteps) expect(played.some((at) => Math.abs(at - step) <= 2)).toBe(true);
    }
  });

  it("plays a note the performer set by hand as set, whatever the figure", () => {
    const grid = gridOf(16);
    const harmony = harmonyFor(barsOf("C", "C", "C", "C"));
    const set = harmony.map((entry) => ({ ...entry, chord: { ...entry.chord!, bass: 4, byHand: true } }));
    const notes = generateBass(grid, set, [planFor(16, { name: "Chorus", energy: 4, bassPart: "melodic" })], engine2(), [], 3);
    for (const note of notes.slice(0, -1)) expect(pc(note.pitch)).toBe(4);
  });

  it("plays each root at the same pitch both times round an intro of D, A, E and F sharp", () => {
    const chords = barsOf("D", "A", "E", "F#", "D", "A", "E", "F#", "D");
    for (const part of ["ring", "pulse", "groove", "melodic"] as const) {
      const notes = generateBass(gridOf(chords.length), harmonyFor(chords), [planFor(chords.length, { name: "Intro", bassPart: part })], engine2(), [], 3);
      const roots = [0, 1, 2, 3, 4, 5, 6, 7].map((bar) => inBar(notes, bar)[0].pitch);
      expect(roots.slice(0, 4)).toEqual(roots.slice(4));
      // The four roots sit within an octave of one another, instead of E and F sharp dropping a ninth below D and A.
      expect(Math.max(...roots) - Math.min(...roots)).toBeLessThanOrEqual(12);
    }
  });

  it("moves a section's roots by its octave shift, and keeps a note that would leave the range in it", () => {
    const chords = barsOf("C", "C", "A", "A");
    const plan = (octave: -1 | 0 | 1) => [planFor(chords.length, { bassPart: "pulse", octave })];
    const rootsOf = (octave: -1 | 0 | 1) => {
      const notes = generateBass(gridOf(chords.length), harmonyFor(chords), plan(octave), engine2(), [], 3);
      return [inBar(notes, 0)[0].pitch, inBar(notes, 2)[0].pitch];
    };
    expect(rootsOf(0)).toEqual([36, 33]);
    // The shift is all or nothing at engine 1. At engine 2 C moves up and A, which has no room above, stays in the range.
    expect(rootsOf(1)[0]).toBe(48);
    for (const pitch of rootsOf(1)) expect(pitch).toBeLessThanOrEqual(55);
    // An octave down would put C at 24, below the range, so it stays at 36.
    expect(rootsOf(-1)).toEqual([36, 33]);
  });

  it("plays a root of D at D1 (26) in the extended range, a seventh above the low E in the normal one", () => {
    const chords = barsOf("D", "D", "D", "D");
    const rootOf = (settings: BandSettings, keys: { start: number; end: number; tonic: number; mode: "major" | "minor" }[] = []) =>
      generateBass(gridOf(chords.length), harmonyFor(chords), [planFor(chords.length, { bassPart: "pulse" })], settings, [], 3, undefined, undefined, keys)[0].pitch;
    expect(rootOf(engine2({ bassRange: "extended" }))).toBe(26);
    expect(rootOf(engine2())).toBe(38);
  });

  it("plans a song in C, C sharp, D or E flat with the extended range while the range is still the default", () => {
    const keyOf = (tonic: number) => [{ start: 0, end: 60, tonic, mode: "major" as const }];
    for (const tonic of [0, 1, 2, 3]) expect(bassRangeFor(engine2(), keyOf(tonic))).toEqual({ range: "extended", tonic });
    expect(bassRangeFor(engine2(), keyOf(4))).toEqual({ range: "normal", tonic: null });
    expect(bassRangeFor(engine2(), [])).toEqual({ range: "normal", tonic: null });
    // A range the performer chose, and the earlier engine, keep their own.
    expect(bassRangeFor(engine2({ bassRange: "high" }), keyOf(2))).toEqual({ range: "high", tonic: null });
    expect(bassRangeFor(settingsFor({ engine: 1 }), keyOf(2))).toEqual({ range: "normal", tonic: null });
    // The song's key is the one covering most of it.
    const mixed = [
      { start: 0, end: 20, tonic: 2, mode: "major" as const },
      { start: 20, end: 60, tonic: 7, mode: "major" as const },
    ];
    expect(bassRangeFor(engine2(), mixed).range).toBe("normal");
    const chords = barsOf("D", "D", "D", "D");
    const notes = generateBass(gridOf(chords.length), harmonyFor(chords), [planFor(chords.length, { bassPart: "pulse" })], engine2(), [], 3, undefined, undefined, keyOf(2));
    expect(notes[0].pitch).toBe(26);
  });

  it("plays a short figure note for a third of its step, and the other notes for their usual share", () => {
    const funk = findStyle("funk")!;
    const hasShort = (figure: Figure): boolean => figure.notes[0].some((note) => note.short);
    const seed = seedFor(funk.bass.figures[3], "melodic", "Verse", hasShort);
    const figure = chooseFigure(funk.bass.figures[3], "melodic", seed, "Verse");
    const chords = barsOf("C", "C");
    const notes = generateBass(gridOf(chords.length), harmonyFor(chords), [planFor(chords.length, { name: "Verse", style: "funk", energy: 3, bassPart: "melodic" })], engine2(), [], seed);
    const bar = notes.filter((note) => note.time < 2 - 1e-9);
    let checked = 0;
    for (const note of figure.notes[0]) {
      const at = bar.findIndex((played) => Math.abs(played.time - note.step * 0.125) < 1e-6);
      expect(at).toBeGreaterThanOrEqual(0);
      const gap = (bar[at + 1]?.time ?? 2) - bar[at].time;
      if (note.short) {
        expect(bar[at].duration).toBeCloseTo(gap / 3, 6);
        checked++;
      } else expect(bar[at].duration).toBeGreaterThan(gap / 3);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps every note inside the range, for every style and energy", () => {
    const progression = harmonyFor(barsOf("C", "Am", "F", "G/B", "Dm7", "Bdim", "E7", "Aaug"));
    for (const id of ["rock", "pop", "ballad", "funk", "shuffle", "country", "reggae", "metal", "half-time"] as const) {
      for (const energy of [1, 3, 5] as const) {
        for (const part of ["groove", "melodic"] as const) {
          const notes = generateBass(
            gridOf(progression.length),
            progression,
            [planFor(progression.length, { style: id, energy, bassPart: part })],
            engine2({ complexity: 0.5 }),
            [],
            4,
          );
          expect(notes.length).toBeGreaterThan(0);
          for (const note of notes) {
            expect(note.pitch).toBeGreaterThanOrEqual(28);
            expect(note.pitch).toBeLessThanOrEqual(55);
          }
        }
      }
    }
  });
});

describe("generateBass with marks", () => {
  const chords = barsOf("C", "Am", "F", "G", "C", "Am", "F", "G");
  const harmony = harmonyFor(chords);
  const grid = gridOf(chords.length);
  const plans = [planFor(chords.length, { name: "Verse", fills: 3, busy: 4 })];
  const generate = (marks: BarMark[], withHarmony: ChordAtBeat[] = harmony, settings: Partial<BandSettings> = {}) =>
    generateBass(grid, withHarmony, plans, settingsFor({ engine: 2, bassMode: "melodic", ...settings, marks }), [], 3);
  // A song with no marks keeps the jitter it always had, so the unmarked notes are read from a song with a mark that falls on no bar.
  const plain = generate([{ time: 500, kind: "fill" }]);
  /** Every note outside the given bars. */
  // Lengths are left out: the note before a changed bar is cut at the next note, which has moved.
  const outside = (notes: readonly NoteEvent[], bars: number[]) =>
    notes.filter((note) => !bars.includes(Math.floor(note.time / 2 + 1e-9))).map((note) => [note.time, note.pitch, note.velocity]);

  it("gives the notes it always gave when there are no marks", () => {
    const noMarks = generateBass(grid, harmony, plans, settingsFor({ engine: 2, bassMode: "melodic" }), [], 3);
    expect(noMarks.map((note) => [note.time, note.pitch])).toEqual(plain.map((note) => [note.time, note.pitch]));
  });

  it("stop silences the last beats of its bar and plays a note on the next downbeat, and changes nothing else", () => {
    const marked = generate([{ time: 4, kind: "stop", beats: 2 }]);
    expect(inBar(marked, 2).filter((note) => note.time >= 5)).toEqual([]);
    // The last note before the stop is now the bar's last note, so it rings; the notes before it are the same.
    expect(inBar(marked, 2).filter((note) => note.time < 4.5)).toEqual(inBar(plain, 2).filter((note) => note.time < 4.5));
    expect(inBar(marked, 3).some((note) => note.time === 6)).toBe(true);
    expect(outside(marked, [2, 3])).toEqual(outside(plain, [2, 3]));
    // No note rings into the stop.
    expect(inBar(marked, 2).every((note) => note.time + note.duration <= 5 + 1e-9)).toBe(true);
  });

  it("bass-out rests the bass for one bar and leaves every other bar as it was", () => {
    const marked = generate([{ time: 4, kind: "bass-out" }]);
    expect(inBar(marked, 2)).toEqual([]);
    expect(outside(marked, [2])).toEqual(outside(plain, [2]));
  });

  it("a note set by hand still plays in a bar marked bass-out", () => {
    const byHand = harmony.map((entry) => (entry.beat === 9 && entry.chord ? { ...entry, chord: { ...entry.chord, byHand: true } } : entry));
    const marked = generate([{ time: 4, kind: "bass-out" }], byHand);
    expect(inBar(marked, 2).length).toBeGreaterThan(0);
    expect(inBar(marked, 2).every((note) => note.time >= 4.5 && note.time < 5)).toBe(true);
  });

  it("hit plays one note on the downbeat, held for the bar, and changes nothing else", () => {
    const marked = generate([{ time: 4, kind: "hit" }]);
    expect(inBar(marked, 2)).toHaveLength(1);
    expect(inBar(marked, 2)[0].time).toBe(4);
    expect(inBar(marked, 2)[0].duration).toBeGreaterThan(1);
    expect(outside(marked, [2])).toEqual(outside(plain, [2]));
  });

  it("no-fill takes the phrase variation out of its bar and leaves the other phrases as they were", () => {
    // Bars 3 and 7 end the phrases of an eight-bar section.
    const marked = generate([{ time: 6, kind: "no-fill" }]);
    const without = generateBass(grid, harmony, [planFor(chords.length, { name: "Verse", fills: 0, busy: 4 })], settingsFor({ engine: 2, bassMode: "melodic", marks: [{ time: 500, kind: "fill" }] }), [], 3);
    expect(inBar(plain, 3)).not.toEqual(inBar(without, 3));
    expect(inBar(marked, 3)).toEqual(inBar(without, 3));
    expect(outside(marked, [3])).toEqual(outside(plain, [3]));
  });

  it("fill gives a bar a variation of its own and changes no other bar", () => {
    const quiet = [planFor(chords.length, { name: "Verse", fills: 0, busy: 4 })];
    const base = generateBass(grid, harmony, quiet, settingsFor({ engine: 2, bassMode: "melodic", marks: [{ time: 500, kind: "fill" }] }), [], 3);
    const marked = generateBass(grid, harmony, quiet, settingsFor({ engine: 2, bassMode: "melodic", marks: [{ time: 4, kind: "fill" }] }), [], 3);
    expect(inBar(marked, 2)).not.toEqual(inBar(base, 2));
    expect(outside(marked, [2])).toEqual(outside(base, [2]));
  });
});
