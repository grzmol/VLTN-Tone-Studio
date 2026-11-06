import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections, type HumaniseSettings, type SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { CLOSED_HAT, CRASH, KICK, SNARE, type NoteEvent } from "./note";
import { DEFAULT_FEEL, GHOST_BELOW, MAX_SHIFT_MS, humanise } from "./humanise";
import { HUMANISE_FEELS } from "./styles/types";

const SECONDS = 64;

/** A steady grid: 120 BPM, one beat every half second, a downbeat on the first beat, four beats to the bar. */
function steadyGrid(seconds = SECONDS): BeatGrid {
  const beats: number[] = [];
  for (let time = 0; time < seconds; time += 0.5) beats.push(time);
  return { beatsPerBar: 4, beats, downbeat: 0, bpm: 120, steady: { bpm: 120, firstBeat: 0 } };
}

const grid = steadyGrid();
const rockPlans: SectionPlan[] = planSections([], SECONDS, DEFAULT_BAND_SETTINGS);
const settingsOf = (amount: number, feel: HumaniseSettings["feel"] = "style"): HumaniseSettings => ({ amount, feel });

/** One note of a pitch at each of the given times. */
function hits(pitch: number, times: number[], velocity = 90, duration = 0.1): NoteEvent[] {
  return times.map((time) => ({ time, pitch, velocity, duration }));
}

/** Notes half a second apart, so no two can swap places after a shift of at most MAX_SHIFT_MS. */
const spaced = (pitch: number, count: number, velocity = 90, duration = 0.1): NoteEvent[] =>
  hits(
    pitch,
    Array.from({ length: count }, (_, i) => i * 0.5),
    velocity,
    duration,
  );

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const deviation = (values: number[]): number => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

describe("humanise", () => {
  it("at amount 0 returns the same notes, the same objects, in the same order", () => {
    const input = [...hits(KICK, [0, 1]), ...hits(SNARE, [0.5])].sort((a, b) => a.time - b.time);
    for (const feel of ["style", ...HUMANISE_FEELS] as const) {
      const out = humanise(input, "drums", grid, rockPlans, settingsOf(0, feel), 7);
      expect(out).toHaveLength(input.length);
      out.forEach((note, i) => expect(note).toBe(input[i]));
    }
  });

  it("gives the same notes for the same seed, and different notes for another seed", () => {
    const input = spaced(CLOSED_HAT, 40);
    const first = humanise(input, "drums", grid, rockPlans, settingsOf(1), 7);
    expect(humanise(input, "drums", grid, rockPlans, settingsOf(1), 7)).toEqual(first);
    expect(humanise(input, "drums", grid, rockPlans, settingsOf(1), 8)).not.toEqual(first);
  });

  it("keeps every offset within the limit and never before 0 s, in time order", () => {
    const input = [...spaced(KICK, 100), ...spaced(SNARE, 100, 90), ...spaced(CLOSED_HAT, 100, 90), ...spaced(CRASH, 100, 90)];
    input.sort((a, b) => a.time - b.time);
    const pitches = input.map((note) => note.pitch);
    for (const feel of ["style", ...HUMANISE_FEELS] as const) {
      const out = humanise(input, "drums", grid, rockPlans, settingsOf(1, feel), 3);
      expect(out.map((note) => note.pitch).sort()).toEqual([...pitches].sort());
      out.forEach((note, i) => {
        expect(note.time).toBeGreaterThanOrEqual(0);
        if (i > 0) expect(note.time).toBeGreaterThanOrEqual(out[i - 1].time);
      });
    }
    const bass = humanise(spaced(36, 200, 90, 0.5), "bass", grid, rockPlans, settingsOf(1, "laid-back"), 3);
    const limit = MAX_SHIFT_MS / 1000 + 1e-9;
    bass.forEach((note, i) => {
      expect(Math.abs(note.time - i * 0.5)).toBeLessThanOrEqual(limit);
      expect(note.time).toBeGreaterThanOrEqual(0);
    });
  });

  it("puts a laid-back snare later on average than a pushed one", () => {
    const input = spaced(SNARE, 200);
    const shifts = (feel: HumaniseSettings["feel"]) =>
      humanise(input, "drums", grid, rockPlans, settingsOf(1, feel), 5).map((note, i) => note.time - input[i].time);
    expect(mean(shifts("laid-back"))).toBeGreaterThan(mean(shifts("pushed")));
  });

  it("spreads tight hats less than laid-back hats", () => {
    const input = spaced(CLOSED_HAT, 300);
    const shifts = (feel: HumaniseSettings["feel"]) =>
      humanise(input, "drums", grid, rockPlans, settingsOf(1, feel), 5).map((note, i) => note.time - input[i].time);
    expect(deviation(shifts("tight"))).toBeLessThan(deviation(shifts("laid-back")));
  });

  it("makes downbeats louder on average than off-beats, and keeps ghost notes under the ghost limit", () => {
    // Eighth-note hats for 30 bars, inside the grid: the downbeat is every eighth at a multiple of 8, and the on-beat eighths are the even ones.
    const eighths = Array.from({ length: 240 }, (_, i) => i * 0.25);
    const input = hits(CLOSED_HAT, eighths, 86);
    const out = humanise(input, "drums", grid, rockPlans, settingsOf(1), 9);
    const at = (test: (i: number) => boolean) => out.filter((_, i) => test(i)).map((note) => note.velocity);
    const downbeats = at((i) => i % 8 === 0);
    const onBeats = at((i) => i % 2 === 0 && i % 8 !== 0);
    const offBeats = at((i) => i % 2 === 1);
    expect(mean(downbeats)).toBeGreaterThan(mean(onBeats));
    expect(mean(onBeats)).toBeGreaterThan(mean(offBeats));
    expect(Math.min(...out.map((note) => note.velocity))).toBeGreaterThanOrEqual(1);
    expect(Math.max(...out.map((note) => note.velocity))).toBeLessThanOrEqual(127);

    // Ghosts on the backbeat and on the downbeat, the loudest a ghost gets: each stays under the limit.
    const ghosts = [...hits(SNARE, [0.5, 1.5, 2.5, 3.5], 38), ...hits(SNARE, [0, 2, 4], 38)];
    for (let i = 0; i < 40; i++) {
      const softened = humanise(ghosts, "drums", grid, rockPlans, settingsOf(1), i);
      for (const note of softened) expect(note.velocity).toBeLessThan(GHOST_BELOW);
    }
  });

  it("keeps a bass note's end where it was when the note is shifted later", () => {
    const input = spaced(36, 200, 90, 0.5);
    const out = humanise(input, "bass", grid, rockPlans, settingsOf(1, "laid-back"), 4);
    let shifted = 0;
    out.forEach((note, i) => {
      const shift = note.time - input[i].time;
      if (shift > 1e-9) {
        shifted += 1;
        expect(note.time + note.duration).toBeCloseTo(input[i].time + input[i].duration, 9);
        expect(note.duration).toBeLessThan(input[i].duration);
      }
    });
    expect(shifted).toBeGreaterThan(0);
  });

  it("gives the same count and pitches at any amount, and changes only how far the notes move", () => {
    const input = [...spaced(KICK, 60), ...spaced(SNARE, 60, 90), ...spaced(CLOSED_HAT, 120, 86)].sort((a, b) => a.time - b.time);
    const quiet = humanise(input, "drums", grid, rockPlans, settingsOf(0.3), 6);
    const loud = humanise(input, "drums", grid, rockPlans, settingsOf(1), 6);
    expect(quiet).toHaveLength(input.length);
    expect(loud).toHaveLength(input.length);
    expect(loud.map((note) => note.pitch).sort()).toEqual(quiet.map((note) => note.pitch).sort());
    expect(loud.map((note) => note.pitch).sort()).toEqual(input.map((note) => note.pitch).sort());
  });

  it("uses the style's own feel when the setting says style, and the default feel where no plan covers a note", () => {
    const ballad = planSections([], SECONDS, { ...DEFAULT_BAND_SETTINGS, style: "ballad" });
    const pop = planSections([], SECONDS, { ...DEFAULT_BAND_SETTINGS, style: "pop" });
    const input = spaced(SNARE, 60);
    expect(humanise(input, "drums", grid, ballad, settingsOf(1, "style"), 2)).toEqual(humanise(input, "drums", grid, ballad, settingsOf(1, "laid-back"), 2));
    expect(humanise(input, "drums", grid, pop, settingsOf(1, "style"), 2)).toEqual(humanise(input, "drums", grid, pop, settingsOf(1, "tight"), 2));
    expect(humanise(input, "drums", grid, [], settingsOf(1, "style"), 2)).toEqual(humanise(input, "drums", grid, [], settingsOf(1, DEFAULT_FEEL), 2));
  });

  it("gives the bass only timing and a small velocity spread, with no beat accents", () => {
    const input = spaced(36, 100, 90, 0.5);
    const out = humanise(input, "bass", grid, rockPlans, settingsOf(1, "natural"), 8);
    for (const note of out) expect(Math.abs(note.velocity - 90)).toBeLessThanOrEqual(4);
  });
});
