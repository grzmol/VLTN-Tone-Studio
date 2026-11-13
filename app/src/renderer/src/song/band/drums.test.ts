import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings, type SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateDrums, playsAt } from "./drums";
import type { EndingSettings } from "./ending";
import { rankGrooves, type Feel } from "./feel";
import type { BarMark } from "./marks";
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
  // The tests here are the earlier drums (engine 2) unless one sets engine 3; the drum phrases have their own tests below.
  return { ...DEFAULT_BAND_SETTINGS, engine: 2, complexity: 1, swing: 0, ghostNotes: true, crashOnSections: false, ...overrides };
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
      // The plan covers the last bar too, so the song ends there and the bars before it keep their grooves.
      const notes = generateDrums(grid, [plan(0, 36)], settingsFor({ complexity }), 11, feel);
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
    const notes = generateDrums(grid, [plan(0, 16), plan(16, 36)], settingsFor({ complexity: 0.5 }), 13, feel);
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

describe("generateDrums with the 3/4 style", () => {
  const threeFour = findStyle("three-four")!;
  const grid = steady(60, 0, 3);

  it("puts every hit on a twelfth-step position and a kick on every bar's beat 1 in a 16-bar section", () => {
    const notes = generateDrums(grid, [plan(0, 48, { style: "three-four", energy: 3 })], settingsFor(), 4);
    expect(threeFour.meter).toEqual({ beatsPerBar: 3, stepsPerBeat: 4 });
    for (const note of notes) {
      const { beat, fraction } = positionOf(grid.beats, note.time);
      expect(beat).toBeLessThan(48);
      expect(Math.abs(fraction * 4 - Math.round(fraction * 4))).toBeLessThan(1e-9);
    }
    // The last bar is the song's ending only when it is the last bar of the grid; here the grid goes on past the section.
    for (let bar = 0; bar < 15; bar++) {
      expect(notes.some((note) => note.pitch === KICK && note.time === grid.beats[bar * 3])).toBe(true);
    }
  });
});

describe("generateDrums with a section that starts near a bar line", () => {
  const grid = steady(64);
  const settings = settingsFor({ crashOnSections: true });
  /** Two sections that meet `offset` seconds after the bar line at 8 s. */
  const withSplit = (offset: number) => {
    const plans = [plan(0, 16, { fill: true, energy: 4, end: 8 + offset }), plan(16, 32, { energy: 4, start: 8 + offset })];
    return generateDrums(grid, plans, settings, 6);
  };

  it.each([0.04, -0.04])("fills the bar before the bar line and crashes on it when the section starts %f s after it", (offset) => {
    const notes = withSplit(offset);
    expect(notes.some((note) => note.pitch === CRASH && note.time === 8)).toBe(true);
    // The bar from 6 s to 8 s is the fill: it plays the section's bar fill, which has toms.
    expect(notes.some((note) => note.time >= 6 && note.time < 8 && [45, 47, 50].includes(note.pitch))).toBe(true);
    // The same notes as for a section that starts exactly on the bar line.
    expect(notes).toEqual(withSplit(0));
  });
});

describe("generateDrums endings", () => {
  // Sixteen beats at 0.5 s: four bars starting at 0, 2, 4 and 6 s. The song's own end is at 8 s.
  const grid = steady(16);
  const ended = (kind: EndingSettings["kind"], extra: Partial<EndingSettings> = {}) => settingsFor({ ending: { kind, ...extra } });
  const at = (notes: NoteEvent[], time: number) =>
    notes
      .filter((note) => Math.abs(note.time - time) < 1e-9)
      .map((note) => note.pitch)
      .sort((a, b) => a - b);

  it("hits on the last bar's downbeat and plays nothing else in that bar", () => {
    const notes = generateDrums(grid, [plan(0, 16)], ended("hit"), 1);
    expect(at(notes, 6)).toEqual([KICK, CRASH]);
    expect(notes.filter((note) => note.time > 6)).toEqual([]);
    expect(notes.filter((note) => note.time >= 6)).toHaveLength(2);
  });

  it("plays a bar fill and then a hard crash and kick on the next downbeat for a hold", () => {
    const notes = generateDrums(grid, [plan(0, 16)], ended("hold"), 1);
    expect(notes.filter((note) => note.time >= 6 && note.time < 8).length).toBeGreaterThan(2);
    expect(at(notes, 8)).toEqual([KICK, CRASH]);
    expect(notes.filter((note) => note.time === 8).every((note) => note.velocity === 127)).toBe(true);
    expect(notes.filter((note) => note.time > 8)).toEqual([]);
  });

  it("plays three unison hits and a last one on the next downbeat for three hits", () => {
    const notes = generateDrums(grid, [plan(0, 16)], ended("hits"), 1);
    for (const time of [6, 6.5, 7, 8]) expect(at(notes, time)).toEqual([KICK, SNARE, CRASH]);
    expect(notes.filter((note) => note.time >= 6)).toHaveLength(12);
  });

  it("slows down over the bars after the last beat and ends on a hold", () => {
    const notes = generateDrums(grid, [plan(0, 16)], ended("slow", { bars: 1 }), 1);
    const hats = notes.filter((note) => note.pitch === CLOSED_HAT && note.time >= 8).map((note) => note.time);
    expect(hats).toHaveLength(4);
    expect(hats[0]).toBe(8);
    // Each beat of the slow-down is longer than the one before it.
    const gaps = hats.slice(1).map((time, i) => time - hats[i]);
    expect(gaps[0]).toBeGreaterThan(0.5);
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
    expect(gaps[2]).toBeGreaterThan(gaps[1]);
    const last = notes.filter((note) => note.pitch === CRASH && note.time > 8);
    expect(last).toHaveLength(1);
    expect(last[0].velocity).toBe(127);
    expect(last[0].time).toBeGreaterThan(hats[3]);
    expect(notes.filter((note) => note.time > last[0].time)).toEqual([]);
  });

  it("holds instead of slowing down where the recording is still playing", () => {
    // The plan ends two bars before the grid does, so the ending is not on the grid's last bar.
    const notes = generateDrums(grid, [plan(0, 8)], ended("slow"), 1);
    expect(at(notes, 4)).toEqual([KICK, CRASH]);
    expect(notes.filter((note) => note.time > 4)).toEqual([]);
  });

  it("plays to the end of the last section with no special ending for none", () => {
    const notes = generateDrums(grid, [plan(0, 16)], ended("none"), 1);
    expect(notes.filter((note) => note.time >= 6 && note.time < 8).length).toBeGreaterThan(2);
    expect(notes.every((note) => note.time < 8)).toBe(true);
    expect(notes.some((note) => note.time >= 6 && note.pitch === CRASH && note.velocity === 127)).toBe(false);
  });

  it("puts the ending at the end of the section it is asked for", () => {
    const plans = [plan(0, 8, { sectionId: "verse" }), plan(8, 16, { sectionId: "outro" })];
    const notes = generateDrums(grid, plans, ended("hit", { atSection: "verse" }), 1);
    // The verse's last bar starts at beat 4, 2 s in.
    expect(at(notes, 2)).toEqual([KICK, CRASH]);
    expect(notes.filter((note) => note.time > 2)).toEqual([]);
  });

  it("ends at the last section that has drums on, and not at the grid's end", () => {
    const plans = [plan(0, 12), plan(12, 16, { play: { drums: false, bass: true } })];
    const notes = generateDrums(grid, plans, ended("hit"), 1);
    expect(at(notes, 4)).toEqual([KICK, CRASH]);
    expect(notes.filter((note) => note.time > 4)).toEqual([]);
  });

  it("puts the ending on the last full bar before the trim end", () => {
    // The bars end at 2, 4, 6 and 8 s. A trim end of 6.9 s leaves three full bars, so the ending is on the third, at 4 s.
    const notes = generateDrums(grid, [plan(0, 16)], ended("hit"), 1, undefined, 6.9);
    expect(at(notes, 4)).toEqual([KICK, CRASH]);
    expect(notes.filter((note) => note.time > 4)).toEqual([]);
  });

  it("keeps the last bar a hit when no ending is set, as saved songs have always had", () => {
    const saved = generateDrums(grid, [plan(0, 16)], settingsFor(), 1);
    expect(saved).toEqual(generateDrums(grid, [plan(0, 16)], ended("hit"), 1));
  });
});

describe("generateDrums with marks", () => {
  // Eight bars of two seconds, in two sections of four, with a fill on the first one's last bar. Bar n starts at 2n seconds.
  const grid = steady(33);
  const plans = [plan(0, 16, { fill: true }), plan(16, 33)];
  const base = settingsFor();
  const generate = (marks: BarMark[], settings: BandSettings = base) => generateDrums(grid, plans, { ...settings, marks }, 7);
  const barOf = (notes: readonly NoteEvent[], bar: number) => notes.filter((note) => note.time >= bar * 2 && note.time < bar * 2 + 2);
  /** Every note outside the given bars. */
  const outside = (notes: readonly NoteEvent[], bars: number[]) => notes.filter((note) => !bars.includes(Math.floor(note.time / 2)));
  const plain = generate([]);

  it("gives the notes it always gave when there are no marks", () => {
    expect(generateDrums(grid, plans, base, 7)).toEqual(plain);
  });

  it("a fill mark gives its bar a fill and changes no other bar but the crash that follows a fill", () => {
    const marked = generate([{ time: 4, kind: "fill", beats: 2 }]);
    expect(barOf(marked, 2)).not.toEqual(barOf(plain, 2));
    expect(barOf(marked, 2).filter((note) => note.time < 5)).toEqual(barOf(plain, 2).filter((note) => note.time < 5));
    expect(outside(marked, [2, 3])).toEqual(outside(plain, [2, 3]));
    expect(barOf(marked, 3).filter((note) => note.pitch === CRASH && note.time === 6)).toHaveLength(1);
  });

  it("a fill of one beat changes less of the bar than a fill of four", () => {
    const one = barOf(generate([{ time: 4, kind: "fill", beats: 1 }]), 2);
    const four = barOf(generate([{ time: 4, kind: "fill", beats: 4 }]), 2);
    expect(one.filter((note) => note.time < 5.5)).toEqual(barOf(plain, 2).filter((note) => note.time < 5.5));
    expect(four).not.toEqual(one);
  });

  it("no-fill on a section's last bar removes the fill and the crash after it", () => {
    const withFill = plain;
    expect(barOf(withFill, 4).some((note) => note.pitch === CRASH && note.time === 8)).toBe(true);
    const marked = generate([{ time: 6, kind: "no-fill" }]);
    // The bar plays its groove, as it would if the section had no fill, and the crash the fill led to is gone.
    const grooveOnly = generateDrums(grid, [plan(0, 16), plan(16, 33)], base, 7);
    expect(barOf(marked, 3)).toEqual(barOf(grooveOnly, 3));
    expect(barOf(marked, 4).some((note) => note.pitch === CRASH && note.time === 8)).toBe(false);
    expect(outside(marked, [3, 4])).toEqual(outside(withFill, [3, 4]));
  });

  it("stop silences the last beats of its bar, hits the next downbeat, and changes nothing else", () => {
    const marked = generate([{ time: 4, kind: "stop", beats: 2 }]);
    expect(barOf(marked, 2).filter((note) => note.time >= 5)).toEqual([]);
    expect(barOf(marked, 2).filter((note) => note.time < 5)).toEqual(barOf(plain, 2).filter((note) => note.time < 5));
    const next = barOf(marked, 3).filter((note) => note.time === 6);
    expect(next.map((note) => note.pitch)).toEqual(expect.arrayContaining([KICK, CRASH]));
    expect(outside(marked, [2, 3])).toEqual(outside(plain, [2, 3]));
    expect(barOf(marked, 3).filter((note) => note.time > 6.4)).toEqual(barOf(plain, 3).filter((note) => note.time > 6.4));
  });

  it("stop keeps the follow feel's own stops", () => {
    const follow: Feel = { profiles: [], stops: new Set([2]), hits: new Set() };
    const marked = generateDrums(grid, plans, { ...base, marks: [{ time: 4, kind: "stop", beats: 1 }] }, 7, follow);
    expect(barOf(marked, 0).filter((note) => note.time === 1)).toEqual([]);
    expect(barOf(marked, 2).filter((note) => note.time >= 5.5)).toEqual([]);
  });

  it("crash puts a crash on the downbeat, and no-crash takes the section's crash away, each on its own bar", () => {
    const withCrash = generate([{ time: 4, kind: "crash" }]);
    expect(barOf(withCrash, 2).some((note) => note.pitch === CRASH && note.time === 4)).toBe(true);
    expect(outside(withCrash, [2])).toEqual(outside(plain, [2]));
    const sectionCrashes = { ...base, crashOnSections: true };
    const before = generateDrums(grid, plans, { ...sectionCrashes, marks: [] }, 7);
    const marked = generateDrums(grid, plans, { ...sectionCrashes, marks: [{ time: 8, kind: "no-crash" }] }, 7);
    expect(barOf(before, 4).some((note) => note.pitch === CRASH && note.time === 8)).toBe(true);
    expect(barOf(marked, 4).some((note) => note.pitch === CRASH && note.time === 8)).toBe(false);
    expect(outside(marked, [4])).toEqual(outside(before, [4]));
  });

  it("drums-out rests the drums for one bar and leaves every other bar as it was", () => {
    const marked = generate([{ time: 4, kind: "drums-out" }]);
    expect(barOf(marked, 2)).toEqual([]);
    expect(outside(marked, [2])).toEqual(outside(plain, [2]));
  });

  it("hit plays a kick and a crash on the downbeat only", () => {
    const marked = generate([{ time: 4, kind: "hit" }]);
    expect(
      barOf(marked, 2)
        .map((note) => [note.time, note.pitch].join(":"))
        .sort(),
    ).toEqual(["4:36", "4:49"]);
    expect(outside(marked, [2])).toEqual(outside(plain, [2]));
  });

  it("a mark that falls on no bar changes nothing", () => {
    expect(generate([{ time: 500, kind: "drums-out" }])).toEqual(plain);
  });
});

describe("generateDrums with a seed for one section", () => {
  // Three sections of 16 bars (32 s each), one after the other.
  const grid = steady(193);
  const section = (index: number, name: string, seed?: number) =>
    plan(index * 64, (index + 1) * 64 + (index === 2 ? 1 : 0), { name, fill: true, ...(seed === undefined ? {} : { seed }) });
  const plansWith = (seed?: number) => [section(0, "Verse"), section(1, "Chorus", seed), section(2, "Bridge")];
  const settings = settingsFor();
  const inSection = (notes: readonly NoteEvent[], index: number) => notes.filter((note) => note.time >= index * 32 && note.time < (index + 1) * 32);

  it("plays the same notes when no section has a seed of its own as before", () => {
    expect(generateDrums(grid, plansWith(), settings, 5)).toEqual(generateDrums(grid, plansWith(), settings, 5));
  });

  it("a new seed for the song leaves a section with its own seed alone and changes the others", () => {
    const first = generateDrums(grid, plansWith(9), settings, 1);
    const second = generateDrums(grid, plansWith(9), settings, 2);
    expect(inSection(second, 1)).toEqual(inSection(first, 1));
    expect(inSection(second, 0)).not.toEqual(inSection(first, 0));
    expect(inSection(second, 2)).not.toEqual(inSection(first, 2));
  });

  it("a new seed for one section changes only that section", () => {
    const first = generateDrums(grid, plansWith(9), settings, 1);
    const second = generateDrums(grid, plansWith(10), settings, 1);
    expect(inSection(second, 1)).not.toEqual(inSection(first, 1));
    expect(inSection(second, 0)).toEqual(inSection(first, 0));
    expect(inSection(second, 2)).toEqual(inSection(first, 2));
  });

  it("giving a section a seed leaves the sections after it as they were", () => {
    const without = generateDrums(grid, plansWith(), settings, 1);
    const seeded = generateDrums(grid, plansWith(9), settings, 1);
    expect(inSection(seeded, 0)).toEqual(inSection(without, 0));
    expect(inSection(seeded, 2)).toEqual(inSection(without, 2));
  });
});

// The drum phrases (engine 3). Bars are two seconds long on the fixture grid, four beats of half a second.
describe("generateDrums with drum phrases (engine 3)", () => {
  const BAR_SECONDS = 2;
  const settings3 = (overrides: Partial<BandSettings> = {}): BandSettings =>
    settingsFor({ engine: 3, ending: { kind: "none" }, ...overrides });
  /** A plan from bar `from` to bar `to` (exclusive). */
  const bars = (from: number, to: number, overrides: Partial<SectionPlan> = {}): SectionPlan => plan(from * 4, to * 4, overrides);
  /** What a bar plays, as "step:pitch:velocity" in sixteenths from its downbeat, leaving out hits from `beforeBeat` on when it is given. */
  const signature = (notes: readonly NoteEvent[], bar: number, untilBeat = 4): string[] =>
    notes
      .filter((note) => note.time >= bar * BAR_SECONDS - 1e-9 && note.time < bar * BAR_SECONDS + (untilBeat * BAR_SECONDS) / 4 - 1e-9)
      .map((note) => `${Math.round(((note.time - bar * BAR_SECONDS) / BAR_SECONDS) * 16)}:${note.pitch}:${note.velocity}`);
  const grid = steady(64 * 4);

  it("gives the same notes for the same seed, and others for another", () => {
    const plans = [bars(0, 16, { name: "Verse", energy: 3, fill: true }), bars(16, 24, { name: "Chorus", energy: 4 })];
    expect(generateDrums(grid, plans, settings3(), 5)).toEqual(generateDrums(grid, plans, settings3(), 5));
    const outputs = Array.from({ length: 8 }, (_, seed) => JSON.stringify(generateDrums(grid, plans, settings3(), seed + 1)));
    expect(new Set(outputs).size).toBeGreaterThan(1);
  });

  describe("one groove per section, varied by the bar's role", () => {
    const plans = [bars(0, 16, { name: "Verse", energy: 3, fill: true }), bars(16, 24, { name: "Chorus", energy: 4 })];
    const notes = generateDrums(grid, plans, settings3(), 3);

    it("plays at least four distinct bars in a 16-bar verse", () => {
      const distinct = new Set(Array.from({ length: 16 }, (_, bar) => signature(notes, bar).join(",")));
      expect(distinct.size).toBeGreaterThanOrEqual(4);
    });

    it("turns around on bars 4 and 12 with a change in the last beat only", () => {
      for (const bar of [3, 11]) {
        expect(signature(notes, bar, 3), `bar ${bar + 1}`).toEqual(signature(notes, 1, 3));
        expect(signature(notes, bar), `bar ${bar + 1}`).not.toEqual(signature(notes, 1));
      }
    });

    it("plays a small fill on bar 8 that changes the last beat only", () => {
      expect(signature(notes, 7, 3)).toEqual(signature(notes, 1, 3));
      expect(signature(notes, 7)).not.toEqual(signature(notes, 1));
    });

    it("plays the groove as written on the bars between", () => {
      for (const bar of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) expect(signature(notes, bar), `bar ${bar + 1}`).toEqual(signature(notes, 1));
    });
  });

  describe("a repeated section", () => {
    const plans = [
      bars(0, 8, { name: "Verse", energy: 3, fill: false }),
      bars(8, 16, { name: "Chorus", energy: 4, fill: false }),
      bars(16, 24, { name: "Verse", energy: 3, fill: false }),
    ];
    const notes = generateDrums(grid, plans, settings3(), 4);

    it("plays the same groove the second time", () => {
      expect(signature(notes, 17)).toEqual(signature(notes, 1));
      expect(signature(notes, 18)).toEqual(signature(notes, 2));
    });

    it("plays the other groove of the energy in the second half of the second verse", () => {
      expect(signature(notes, 5)).toEqual(signature(notes, 1));
      expect(signature(notes, 21)).not.toEqual(signature(notes, 17));
      expect(signature(notes, 22)).toEqual(signature(notes, 21));
    });
  });

  describe("sections with a seed of their own", () => {
    const plansWith = (seeds: (number | undefined)[]): SectionPlan[] =>
      ["Verse", "Chorus", "Bridge"].map((name, i) => bars(i * 8, i * 8 + 8, { name, energy: 3, fill: true, ...(seeds[i] !== undefined ? { seed: seeds[i] } : {}) }));
    const section = (notes: readonly NoteEvent[], index: number) => notes.filter((note) => note.time >= index * 16 && note.time < (index + 1) * 16);

    it("keeps a kept section's drums when another section is given a new seed", () => {
      const before = generateDrums(grid, plansWith([undefined, 9, undefined]), settings3(), 1);
      for (const other of [10, 11, 12, 13]) {
        const after = generateDrums(grid, plansWith([other, 9, other]), settings3(), 1);
        expect(section(after, 1)).toEqual(section(before, 1));
      }
    });

    it("keeps a kept section's drums when the song's seed changes", () => {
      const first = generateDrums(grid, plansWith([undefined, 9, undefined]), settings3(), 1);
      const second = generateDrums(grid, plansWith([undefined, 9, undefined]), settings3(), 2);
      expect(section(second, 1)).toEqual(section(first, 1));
    });
  });

  describe("fills sized to the change", () => {
    /** The first beat of the bar at which it plays other notes than a plain bar of its section (bar 1), or 4 when it does not. */
    const firstChange = (notes: readonly NoteEvent[], bar: number): number => {
      for (let beat = 0; beat < 4; beat++) {
        const inBeat = (n: readonly NoteEvent[], at: number) => signature(n, at, beat + 1).filter((hit) => Number(hit.split(":")[0]) >= beat * 4);
        if (inBeat(notes, bar).join() !== inBeat(notes, 1).join()) return beat;
      }
      return 4;
    };
    const lastBar = (first: Partial<SectionPlan>, second: Partial<SectionPlan>, secondName = "Next") => {
      const plans = [bars(0, 8, { name: "First", energy: 3, fill: true, ...first }), bars(8, 16, { name: secondName, energy: 3, ...second })];
      return generateDrums(grid, plans, settings3(), 3);
    };

    // The rows of the size table. `from` is the first beat that differs from the groove: 3 for a last-beat fill, 2 for half a bar, 4 for no fill, and 0
    // or 1 for a whole bar (a bar fill may keep a first kick that the groove has too).
    const rows: [string, Partial<SectionPlan>, Partial<SectionPlan> | undefined, number][] = [
      ["the song's end", {}, undefined, 4],
      ["the same name continuing", { name: "Verse" }, { name: "Verse" }, 3],
      ["a drop of two levels", { energy: 4, loud: 4 }, { energy: 2 }, 3],
      ["an energy one lower", { energy: 4 }, { energy: 3 }, 3],
      ["an equal energy", { energy: 3 }, { energy: 3 }, 3],
      ["an energy one higher", { energy: 3 }, { energy: 4 }, 2],
      ["an energy two higher", { energy: 2 }, { energy: 4 }, 0],
      ["a chorus after another kind of section", { energy: 4, name: "Bridge" }, { name: "Chorus", energy: 4 }, 0],
    ];
    it.each(rows)("takes the size from %s", (_label, first, second, from) => {
      const plans = [bars(0, 8, { name: "First", energy: 3, fill: true, ...first }), ...(second ? [bars(8, 16, { name: "Next", energy: 3, ...second })] : [])];
      const changed = firstChange(generateDrums(grid, plans, settings3(), 3), 7);
      if (from === 0) expect(changed).toBeLessThanOrEqual(1);
      else expect(changed).toBe(from);
    });

    it("plays no fill from energy 1 into the same section, and none before a section with no drums", () => {
      const intro = lastBar({ name: "Intro", energy: 1, loud: 1 }, { name: "Intro", energy: 1, loud: 1 });
      expect(firstChange(intro, 7)).toBe(4);
      const mute = { play: { drums: false, bass: true } };
      const quiet = lastBar({ energy: 3 }, mute);
      expect(firstChange(quiet, 7)).toBe(4);
    });

    it("ends a loud section before a section with no drums on a kick and a crash on its last beat only", () => {
      const notes = lastBar({ energy: 4, loud: 4 }, { play: { drums: false, bass: true } });
      const lastBeat = signature(notes, 7).filter((hit) => Number(hit.split(":")[0]) >= 12);
      expect(lastBeat.filter((hit) => hit.split(":")[1] === String(KICK))).toHaveLength(1);
      expect(lastBeat.filter((hit) => hit.split(":")[1] === String(CRASH))).toHaveLength(1);
      expect(lastBeat.filter((hit) => ![KICK, CRASH].includes(Number(hit.split(":")[1])))).toEqual([]);
    });

    it.each([
      [0, 4],
      [1, 3],
      [2, 2],
      [3, 0],
    ] as const)("plays a size %i fill the section sets itself", (fill, from) => {
      const notes = lastBar({ fill }, { energy: 3 });
      expect(firstChange(notes, 7)).toBeGreaterThanOrEqual(from === 0 ? 0 : from);
      if (from > 0) expect(firstChange(notes, 7)).toBeLessThanOrEqual(from === 4 ? 4 : from);
    });

    it("changes only the last bar of the section when its fill size changes", () => {
      const sized = (fill: 2 | 3) => generateDrums(grid, [bars(0, 8, { name: "First", energy: 3, fill }), bars(8, 16, { name: "Next", energy: 3 })], settings3(), 3);
      const half = sized(2);
      const whole = sized(3);
      const outside = (notes: readonly NoteEvent[]) => notes.filter((note) => note.time < 7 * BAR_SECONDS || note.time >= 8 * BAR_SECONDS);
      expect(outside(whole)).toEqual(outside(half));
      expect(signature(whole, 7)).not.toEqual(signature(half, 7));
    });

    it("crashes on the downbeat after a half or a whole bar fill, and not after a short one", () => {
      const crashAt = (fill: 0 | 1 | 2 | 3) => lastBar({ fill }, {}).some((note) => note.pitch === CRASH && Math.abs(note.time - 8 * BAR_SECONDS) < 1e-9);
      expect([0, 1, 2, 3].map((fill) => crashAt(fill as 0 | 1 | 2 | 3))).toEqual([false, false, true, true]);
    });

    it("draws different fills of one size at two section ends in a row", () => {
      const plans = [0, 1, 2, 3, 4, 5].map((i) => bars(i * 8, i * 8 + 8, { name: `S${i}`, energy: 3, fill: 2 }));
      const notes = generateDrums(grid, plans, settings3(), 3);
      for (let i = 0; i < 5; i++) {
        expect(signature(notes, i * 8 + 7).filter((hit) => Number(hit.split(":")[0]) >= 8).join(), `end of S${i}`).not.toBe(
          signature(notes, (i + 1) * 8 + 7).filter((hit) => Number(hit.split(":")[0]) >= 8).join(),
        );
      }
    });
  });
});
