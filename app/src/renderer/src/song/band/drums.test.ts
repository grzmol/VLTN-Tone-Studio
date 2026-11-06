import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings, type SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateDrums, playsAt } from "./drums";
import { rankGrooves, type Feel } from "./feel";
import { CLOSED_HAT, CRASH, DRUM_DURATION, KICK, OPEN_HAT, RIDE, SIDE_STICK, SNARE, type NoteEvent } from "./note";
import { findStyle, STYLES } from "./styles";
import { STYLE_IDS, type DrumGroove, type DrumHit } from "./styles/types";

/** A grid of `count` beats, `interval` seconds apart. Intervals of 0.5 keep every step time exact in binary. */
function steady(count: number, downbeat = 0, beatsPerBar = 4): BeatGrid {
  return { beatsPerBar, beats: Array.from({ length: count }, (_, i) => i * 0.5), downbeat, bpm: 120, steady: null };
}

/** The same grid with beats that drift: a few hundredths of a second early or late, moving smoothly. */
function drifting(count: number): BeatGrid {
  const grid = steady(count);
  return { ...grid, beats: grid.beats.map((time, i) => time + 0.02 * Math.sin(i * 0.7)), steady: null };
}

/** A plan from `startBeat` to `endBeat`. The fixture grids put a beat every 0.5 s, so beat n is at n / 2 seconds. */
function plan(startBeat: number, endBeat: number, overrides: Partial<SectionPlan> = {}): SectionPlan {
  return {
    sectionId: null,
    start: startBeat * 0.5,
    end: endBeat * 0.5,
    style: "rock",
    energy: 3,
    loud: 3,
    busy: 3,
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

/** Settings that keep every hit: full complexity, no swing, ghosts on, no section crashes unless a test asks for them. */
function settingsFor(overrides: Partial<BandSettings> = {}): BandSettings {
  return { ...DEFAULT_BAND_SETTINGS, complexity: 1, swing: 0, ghostNotes: true, crashOnSections: false, ...overrides };
}

/** Hat, ride and cross-stick: the voices that keep time. */
const TIME_KEEPING = [CLOSED_HAT, OPEN_HAT, RIDE, SIDE_STICK];

/** The time-keeping pitch with the most core (untagged) hits in a groove. Ties go to the lower pitch. */
function timeKeepingPitch(groove: DrumGroove): number {
  const counts = new Map<number, number>();
  for (const hit of groove.hits) {
    if (hit.tier === undefined && TIME_KEEPING.includes(hit.pitch)) counts.set(hit.pitch, (counts.get(hit.pitch) ?? 0) + 1);
  }
  let best = -1;
  for (const [pitch, count] of counts) {
    const bestCount = counts.get(best) ?? -1;
    if (count > bestCount || (count === bestCount && pitch < best)) best = pitch;
  }
  return best;
}

/** The beat a time falls in, and how far through it (0 to 1). */
function positionOf(beats: readonly number[], time: number): { beat: number; fraction: number } {
  let beat = 0;
  while (beat + 1 < beats.length && beats[beat + 1] <= time + 1e-9) beat++;
  const length = beat + 1 < beats.length ? beats[beat + 1] - beats[beat] : beats[beat] - beats[beat - 1];
  return { beat, fraction: (time - beats[beat]) / length };
}

describe("generateDrums", () => {
  it("gives the same notes for the same seed", () => {
    const grid = steady(64);
    const plans = [plan(0, 64)];
    expect(generateDrums(grid, plans, settingsFor(), 5)).toEqual(generateDrums(grid, plans, settingsFor(), 5));
  });

  it("gives different notes for a different seed", () => {
    // Two grooves to choose from per energy, so one pair of seeds can agree by chance. Across eight seeds they must not all agree.
    const grid = steady(64);
    const plans = [plan(0, 64)];
    const outputs = Array.from({ length: 8 }, (_, seed) => JSON.stringify(generateDrums(grid, plans, settingsFor(), seed + 1)));
    expect(new Set(outputs).size).toBeGreaterThan(1);
  });

  it("sorts the notes by time and keeps every velocity and duration in range", () => {
    const notes = generateDrums(steady(64), [plan(0, 32, { energy: 5, fill: true })], settingsFor(), 3);
    expect(notes.length).toBeGreaterThan(0);
    for (let i = 1; i < notes.length; i++) expect(notes[i].time).toBeGreaterThanOrEqual(notes[i - 1].time);
    for (const note of notes) {
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
      expect(note.duration).toBe(DRUM_DURATION);
    }
  });

  it.each(STYLE_IDS.map((id) => [id] as const))("puts every %s note on a step time when swing is 0", (id) => {
    const style = findStyle(id)!;
    const grid = steady(96, 0, style.meter.beatsPerBar);
    const notes = generateDrums(grid, [plan(0, 48, { style: id, energy: 5 }), plan(48, 96, { style: id, energy: 2 })], settingsFor(), 7);
    expect(notes.length).toBeGreaterThan(0);
    const lastBeat = grid.beats[grid.beats.length - 1];
    for (const note of notes.filter((n) => n.time < lastBeat)) {
      const { fraction } = positionOf(grid.beats, note.time);
      const step = fraction * style.meter.stepsPerBeat;
      expect(Math.abs(step - Math.round(step)), `${id} at ${note.time}`).toBeLessThan(1e-6);
    }
  });

  it("delays only the off-beat sixteenths when swing is on", () => {
    const grid = steady(32);
    const straight = generateDrums(grid, [plan(0, 32, { style: "funk", energy: 4, fill: false })], settingsFor(), 4);
    const swing = 0.6;
    const swung = generateDrums(grid, [plan(0, 32, { style: "funk", energy: 4, fill: false })], settingsFor({ swing }), 4);

    // Same seed, same hits: only the times move. The shift for an off-beat is swing × half a step, in beats, times the beat length.
    const shift = ((swing * 0.5) / 4) * 0.5;
    const expected: NoteEvent[] = straight
      .map((note) => {
        const { fraction } = positionOf(grid.beats, note.time);
        const offBeat = Math.round(fraction * 4) % 2 === 1;
        return { ...note, time: offBeat ? note.time + shift : note.time };
      })
      .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
    const actual = [...swung].sort((a, b) => a.time - b.time || a.pitch - b.pitch);

    expect(actual).toHaveLength(expected.length);
    expected.forEach((note, i) => {
      expect(actual[i].pitch).toBe(note.pitch);
      expect(actual[i].time).toBeCloseTo(note.time, 9);
    });
    expect(straight.some((note) => Math.round(positionOf(grid.beats, note.time).fraction * 4) % 2 === 1)).toBe(true);
  });

  it("does not swing the on-beats", () => {
    const grid = steady(16);
    const notes = generateDrums(grid, [plan(0, 16, { style: "funk", energy: 2, fill: false })], settingsFor({ swing: 0.75 }), 2);
    const onBeats = notes.filter((note) => Math.round(positionOf(grid.beats, note.time).fraction * 4) % 4 === 0);
    for (const note of onBeats) {
      const { beat, fraction } = positionOf(grid.beats, note.time);
      expect(fraction * 4 - Math.round(fraction * 4)).toBeCloseTo(0, 9);
      expect(beat).toBeGreaterThanOrEqual(0);
    }
    expect(onBeats.length).toBeGreaterThan(0);
  });

  it("ignores swing on a triplet grid", () => {
    const grid = steady(24, 0, 4);
    const straight = generateDrums(grid, [plan(0, 24, { style: "shuffle", energy: 4, fill: false })], settingsFor(), 9);
    const swung = generateDrums(grid, [plan(0, 24, { style: "shuffle", energy: 4, fill: false })], settingsFor({ swing: 0.75 }), 9);
    expect(swung).toEqual(straight);
  });

  it("puts a fill in the last bar of a plan and leaves the rest of the song alone", () => {
    // Plan A covers beats 0 to 31 (bars at 0, 4, … 28). Plan B covers 32 to 63 at energy 2, with no crash at its start.
    const grid = steady(64);
    const plans = (fill: boolean) => [plan(0, 32, { fill }), plan(32, 64, { energy: 2 })];
    const without = generateDrums(grid, plans(false), settingsFor(), 12);
    const withFill = generateDrums(grid, plans(true), settingsFor(), 12);

    const before = (notes: NoteEvent[], time: number) => notes.filter((note) => note.time < time);
    const from = (notes: NoteEvent[], time: number) => notes.filter((note) => note.time >= time);
    const within = (notes: NoteEvent[], from: number, to: number) => notes.filter((note) => note.time >= from && note.time < to);

    // The bar at beat 28 is the last bar of plan A. Its first half is the groove in both versions, so those notes match.
    expect(before(withFill, grid.beats[30])).toEqual(before(without, grid.beats[30]));
    // The fill changes the second half of that bar.
    expect(within(withFill, grid.beats[30], grid.beats[32])).not.toEqual(within(without, grid.beats[30], grid.beats[32]));
    // The bar at beat 32 may gain a crash after a fill, so compare from the second beat of that bar on.
    expect(from(withFill, grid.beats[33])).toEqual(from(without, grid.beats[33]));
  });

  it("uses a bar fill, not a half fill, at energy 4 and up", () => {
    // Forty beats, so bar 28 is the last bar of the plan and not the end of the song.
    const grid = steady(40);
    const withFill = generateDrums(grid, [plan(0, 32, { energy: 4, fill: true })], settingsFor(), 8);
    const lastBar = withFill.filter((note) => note.time >= grid.beats[28] && note.time < grid.beats[32]);
    // A bar fill has hits in the first half too (its toms start on the downbeat), unlike a half fill.
    expect(lastBar.some((note) => note.time < grid.beats[30])).toBe(true);
  });

  it("has more notes per bar at energy 5 than at energy 1", () => {
    const grid = steady(64);
    const count = (energy: 1 | 5) => generateDrums(grid, [plan(0, 64, { energy, fill: false })], settingsFor(), 21).length;
    expect(count(5)).toBeGreaterThan(count(1) * 1.5);
  });

  it("adds notes as complexity rises, for the same seed and energy", () => {
    const grid = steady(64);
    for (const energy of [3, 4, 5] as const) {
      const count = (complexity: number) => generateDrums(grid, [plan(0, 64, { style: "funk", energy, fill: false })], settingsFor({ complexity }), 14).length;
      expect(count(0), `energy ${energy} at 0`).toBeLessThan(count(0.5));
      expect(count(0.5), `energy ${energy} at 0.5`).toBeLessThan(count(1));
    }
  });

  it("gives every bar of one groove variation the same notes at a fixed complexity", () => {
    // Rock at energy 5 has two grooves. Each bar must match one of them, so at most two distinct bar shapes, and the last bar (the
    // ending) is left out. Crash on section starts is off so the first bar has no extra crash.
    const grid = steady(64);
    for (const complexity of [0, 0.5, 1]) {
      const notes = generateDrums(grid, [plan(0, 64, { style: "rock", energy: 5, fill: false })], settingsFor({ complexity }), 31);
      const shapes = new Set<string>();
      for (let start = 0; start < 60; start += 4) {
        const bar = notes
          .filter((note) => note.time >= grid.beats[start] - 1e-9 && note.time < grid.beats[start + 4] - 1e-9)
          .map((note) => `${Math.round((note.time - grid.beats[start]) * 1000)}:${note.pitch}:${note.velocity}`);
        shapes.add(bar.join(","));
      }
      expect(shapes.size, `complexity ${complexity}`).toBeLessThanOrEqual(2);
      expect(shapes.size, `complexity ${complexity}`).toBeGreaterThan(0);
    }
  });

  it("keeps the time-keeping lane whole at complexity 0, for every style and energy from 2 to 5", () => {
    // The time-keeping lane is the hat, ride or cross-stick with the most core hits in the groove. At complexity 0 it must play
    // every step it plays at complexity 1, except the busy extras, which are added subdivisions. So no lean hit may sit on that lane.
    for (const id of STYLE_IDS) {
      for (const energy of [2, 3, 4, 5] as const) {
        for (const groove of STYLES[id].grooves[energy]) {
          const pitch = timeKeepingPitch(groove);
          const lane = (complexity: number, keep: (hit: DrumHit) => boolean) =>
            groove.hits
              .filter((hit) => hit.pitch === pitch && keep(hit) && playsAt(hit, complexity))
              .map((hit) => hit.step)
              .sort((a, b) => a - b);
          const atZero = lane(0, () => true);
          const atOneWithoutBusy = lane(1, (hit) => hit.tier !== "busy");
          expect(atZero, `${id} energy ${energy} "${groove.name}" time-keeping lane ${pitch}`).toEqual(atOneWithoutBusy);
          expect(atZero.length, `${id} energy ${energy} "${groove.name}" has a time-keeping lane`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps the backbeat at complexity 0", () => {
    // Rock at energy 2: the snare sits on beats 2 and 4 of every bar, whatever the complexity.
    const grid = steady(64);
    const notes = generateDrums(grid, [plan(0, 64, { style: "rock", energy: 2, fill: false })], settingsFor({ complexity: 0 }), 33);
    for (let start = 0; start < 60; start += 4) {
      expect(
        notes.some((note) => note.pitch === SNARE && note.time === grid.beats[start + 1]),
        `bar ${start} beat 2`,
      ).toBe(true);
      expect(
        notes.some((note) => note.pitch === SNARE && note.time === grid.beats[start + 3]),
        `bar ${start} beat 4`,
      ).toBe(true);
    }
  });

  it("is silent in the pickup before the downbeat", () => {
    const grid = steady(32, 2);
    const notes = generateDrums(grid, [plan(0, 16)], settingsFor(), 4);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note.time).toBeGreaterThanOrEqual(grid.beats[2]);
  });

  it("gives no notes in a section whose drums are off", () => {
    const grid = steady(64);
    const notes = generateDrums(grid, [plan(0, 32, { fill: false }), plan(32, 64, { play: { drums: false, bass: true } })], settingsFor(), 16);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => note.time < grid.beats[32])).toBe(true);
  });

  it("drops every ghost note when ghost notes are off", () => {
    const grid = steady(64);
    const plans = [plan(0, 64, { style: "funk", energy: 3, fill: false })];
    const with_ = generateDrums(grid, plans, settingsFor({ ghostNotes: true }), 30);
    const without = generateDrums(grid, plans, settingsFor({ ghostNotes: false }), 30);
    expect(with_.some((note) => note.velocity <= 45)).toBe(true);
    expect(without.some((note) => note.velocity <= 45)).toBe(false);
    expect(without.length).toBeLessThan(with_.length);
  });

  it("places notes from the actual beat times when the beats drift", () => {
    const grid = drifting(64);
    const notes = generateDrums(grid, [plan(0, 64, { style: "rock", energy: 4, fill: false })], settingsFor(), 17);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes.filter((n) => n.time < grid.beats[63])) {
      const { fraction } = positionOf(grid.beats, note.time);
      const step = fraction * 4;
      expect(Math.abs(step - Math.round(step))).toBeLessThan(1e-6);
    }
    // Some notes are moved off the straight grid, so the drift is really in use.
    const straight = generateDrums(steady(64), [plan(0, 64, { style: "rock", energy: 4, fill: false })], settingsFor(), 17);
    expect(notes.map((n) => n.time)).not.toEqual(straight.map((n) => n.time));
  });

  it("ends the song on a crash and a kick on the last downbeat, with nothing after", () => {
    const grid = steady(64);
    const notes = generateDrums(grid, [plan(0, 64, { fill: true })], settingsFor(), 19);
    const lastDownbeat = grid.beats[60];
    const last = notes.filter((note) => note.time === lastDownbeat);
    expect(last.map((note) => note.pitch).sort((a, b) => a - b)).toEqual([KICK, CRASH].sort((a, b) => a - b));
    expect(notes.every((note) => note.time <= lastDownbeat)).toBe(true);
    expect(notes.some((note) => note.time < lastDownbeat && note.time >= grid.beats[56])).toBe(true);
  });

  it("keeps notes within the final beat plus one beat on a partial last bar", () => {
    const grid = steady(62);
    const notes = generateDrums(grid, [plan(0, 62)], settingsFor(), 23);
    expect(notes.length).toBeGreaterThan(0);
    const limit = grid.beats[61] + 0.5;
    expect(notes.every((note) => note.time <= limit)).toBe(true);
  });

  it("crashes on a section start from energy 3 when crashOnSections is on", () => {
    const grid = steady(64);
    const plans = [plan(0, 32, { energy: 2, fill: false }), plan(32, 64, { energy: 4, fill: false })];
    const on = generateDrums(grid, plans, settingsFor({ crashOnSections: true }), 25);
    const off = generateDrums(grid, plans, settingsFor({ crashOnSections: false }), 25);
    const crashAt = (notes: NoteEvent[]) => notes.some((note) => note.pitch === CRASH && note.time === grid.beats[32]);
    expect(crashAt(on)).toBe(true);
    expect(crashAt(off)).toBe(false);
  });

  it("does not crash a section start below energy 3", () => {
    const grid = steady(64);
    const plans = [plan(0, 32, { fill: false }), plan(32, 64, { energy: 2, fill: false })];
    const notes = generateDrums(grid, plans, settingsFor({ crashOnSections: true }), 26);
    expect(notes.some((note) => note.pitch === CRASH && note.time === grid.beats[32])).toBe(false);
  });

  it("crashes on the first downbeat after a fill, even when crashOnSections is off", () => {
    const grid = steady(64);
    const plans = [plan(0, 32, { fill: true }), plan(32, 64, { energy: 1, fill: false })];
    const notes = generateDrums(grid, plans, settingsFor({ crashOnSections: false }), 27);
    expect(notes.some((note) => note.pitch === CRASH && note.time === grid.beats[32])).toBe(true);
  });

  it("uses the snare on the backbeat of a rock groove at energy 2", () => {
    const grid = steady(16);
    const notes = generateDrums(grid, [plan(0, 16, { style: "rock", energy: 2, fill: false })], settingsFor(), 28);
    // Steps 4 and 12 are beats 2 and 4 of the bar, so beats 1 and 3 of the grid.
    expect(notes.some((note) => note.pitch === SNARE && note.time === grid.beats[1])).toBe(true);
  });
});

describe("generateDrums with follow-my-playing", () => {
  /** A feel with no accents of its own, so only the stops and hits change the notes. */
  const feelOf = (overrides: Partial<Feel>): Feel => ({
    profiles: [{ weights: new Float64Array(16), confidence: 0 }],
    stops: new Set(),
    hits: new Set(),
    ...overrides,
  });
  /** A profile with the given steps at full weight. */
  const accents = (steps: number[]) => {
    const weights = new Float64Array(16);
    for (const step of steps) weights[step] = 1;
    return { weights, confidence: 1 };
  };
  /** The bar at `bar`'s kick steps, on the 16th grid of a bar of 2 s. */
  const kickSteps = (notes: readonly NoteEvent[], grid: BeatGrid, bar: number): number[] => {
    const start = grid.beats[bar * 4];
    return notes
      .filter((note) => note.pitch === KICK && note.time >= start - 1e-9 && note.time < start + 2 - 1e-9)
      .map((note) => Math.round((note.time - start) / 0.125))
      .sort((a, b) => a - b);
  };
  /** The kick steps a groove plays at half complexity, which is when the feel adds no pushes. */
  const grooveKicks = (groove: DrumGroove): number[] =>
    groove.hits
      .filter((hit) => hit.pitch === KICK && playsAt(hit, 0.5))
      .map((hit) => hit.step)
      .sort((a, b) => a - b);

  it("is silent on a stop, and a hit after it gets a crash and a kick", () => {
    const grid = steady(17);
    const feel = feelOf({ stops: new Set([4, 5, 6, 7]), hits: new Set([8]) });
    const notes = generateDrums(grid, [plan(0, 17)], settingsFor(), 3, feel);
    expect(notes.filter((note) => note.time >= 2 && note.time < 4)).toEqual([]);
    const hit = notes.filter((note) => note.time === 4).map((note) => note.pitch);
    expect(hit).toContain(CRASH);
    expect(hit).toContain(KICK);
  });

  it("adds a kick on a strong off-beat accent at complexity two thirds and up, and not below", () => {
    const grid = steady(33);
    const feel = feelOf({ profiles: [accents([2])] });
    const pushedAt = (complexity: number) => {
      const notes = generateDrums(grid, [plan(0, 33)], settingsFor({ complexity }), 11, feel);
      return [0, 1, 2, 3, 4, 5, 6, 7].map((bar) => kickSteps(notes, grid, bar).includes(2));
    };
    expect(pushedAt(1).every(Boolean)).toBe(true);
    expect(pushedAt(0.5).some(Boolean)).toBe(false);
  });

  it("gives each section a variation from the best two fits to its own accents", () => {
    const grid = steady(33);
    const verse = accents([0, 10]);
    const chorus = accents([0, 6, 12]);
    const feel = feelOf({ profiles: [verse, chorus] });
    const notes = generateDrums(grid, [plan(0, 16), plan(16, 33)], settingsFor({ complexity: 0.5 }), 13, feel);
    const grooves = STYLES.rock.grooves[2];
    const best = (weights: Float64Array) =>
      rankGrooves(grooves, weights, 0.5)
        .slice(0, 2)
        .map((index) => grooveKicks(grooves[index]));
    const verseBest = best(verse.weights);
    const chorusBest = best(chorus.weights);
    for (let bar = 0; bar < 4; bar++) expect(verseBest).toContainEqual(kickSteps(notes, grid, bar));
    for (let bar = 4; bar < 8; bar++) expect(chorusBest).toContainEqual(kickSteps(notes, grid, bar));
  });

  it("gives the same notes for the same seed, and with a stop and a hit in the song", () => {
    const grid = steady(33);
    const feel = feelOf({ profiles: [accents([0, 6, 12])], stops: new Set([8, 9]), hits: new Set([10]) });
    const plans = [plan(0, 33)];
    expect(generateDrums(grid, plans, settingsFor(), 5, feel)).toEqual(generateDrums(grid, plans, settingsFor(), 5, feel));
  });
});

describe("generateDrums by section loud", () => {
  const grid = steady(64);
  /** The same notes at each loud level, keyed by time and pitch. Loud draws nothing, so the notes are the same but for the velocity. */
  const byLoud = (loud: SectionPlan["loud"]): Map<string, number> => {
    const notes = generateDrums(grid, [plan(0, 64, { style: "funk", energy: 3, loud, fill: false })], settingsFor(), 30);
    return new Map(notes.map((note) => [`${note.time}:${note.pitch}`, note.velocity]));
  };
  const at3 = byLoud(3);

  it("scales every hit by its loud level, and leaves loud 3 as written", () => {
    const scale: Record<SectionPlan["loud"], number> = { 1: 0.7, 2: 0.85, 3: 1, 4: 1.08, 5: 1.15 };
    for (const loud of [1, 2, 4, 5] as const) {
      const scaled = byLoud(loud);
      expect(scaled.size, `loud ${loud} has the same hits`).toBe(at3.size);
      for (const [key, velocity] of at3) {
        expect(scaled.get(key), `${key} at loud ${loud}`).toBe(Math.min(127, Math.max(1, Math.round(velocity * scale[loud]))));
      }
    }
  });

  it("keeps a ghost note below 50 at the loudest level", () => {
    const ghosts = [...at3].filter(([, velocity]) => velocity <= 49);
    expect(ghosts.length).toBeGreaterThan(0);
    const at5 = byLoud(5);
    for (const [key] of ghosts) expect(at5.get(key), key).toBeLessThan(50);
  });
});
