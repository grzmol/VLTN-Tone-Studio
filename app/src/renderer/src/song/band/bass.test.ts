import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings, type BassMode, type BassRange, type SectionPlan } from "./arrangement";
import { generateBass } from "./bass";
import type { BeatGrid } from "./beat-grid";
import type { Feel } from "./feel";
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
  return { ...DEFAULT_BAND_SETTINGS, complexity: 1, swing: 0, lockToKick: false, bassMode: "roots", bassRange: "normal", ...overrides };
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
    const ranges: Record<BassRange, [number, number]> = { low: [28, 40], normal: [28, 55], high: [33, 60] };
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
