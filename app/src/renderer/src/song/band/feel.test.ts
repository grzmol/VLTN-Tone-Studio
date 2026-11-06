import { describe, expect, it } from "vitest";
import type { SectionPlan } from "./arrangement";
import type { BeatGrid, OnsetStrength } from "./beat-grid";
import {
  accentPushes,
  beatLevelsDb,
  accentProfile,
  bassRhythmFromAccents,
  followFeel,
  followStatus,
  MAX_PUSHES,
  pickGrooveByAccents,
  rankGrooves,
  resolveFollowSource,
  stopsAndHits,
} from "./feel";
import { CLOSED_HAT, KICK, SNARE } from "./note";
import { STYLES } from "./styles";
import type { DrumGroove } from "./styles/types";

/** Frames a second in the synthetic onset curves. */
const FRAME_RATE = 100;
/** Seconds per step of a 4/4 bar at 120 BPM with 16 steps: two seconds a bar, eight steps a beat. */
const STEP = 0.125;

/** A steady 4/4 grid of `bars` bars at 120 BPM, a beat every half second. */
function grid(bars: number): BeatGrid {
  return { beatsPerBar: 4, beats: Array.from({ length: bars * 4 }, (_, i) => i * 0.5), downbeat: 0, bpm: 120, steady: { bpm: 120, firstBeat: 0 } };
}

/** A rock plan covering bars `first` up to, not including, `last`. */
function planBars(first: number, last: number): SectionPlan {
  return {
    sectionId: null,
    name: "",
    start: first * 2,
    end: last * 2,
    style: "rock",
    energy: 2,
    loud: 2,
    busy: 2,
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
  };
}

/** An onset curve of `bars` bars. Each bar peaks at the steps `pattern(bar)` gives, on the 16-step grid. */
function onsetFor(bars: number, pattern: (bar: number) => number[]): Float64Array {
  const out = new Float64Array(bars * 2 * FRAME_RATE + 1);
  for (let bar = 0; bar < bars; bar++) {
    for (const step of pattern(bar)) out[Math.round((bar * 2 + step * STEP) * FRAME_RATE)] = 1;
  }
  return out;
}

/** A 0-to-1 stream from a fixed seed, so a noise curve is the same every run. */
function noise(length: number, seed: number): Float64Array {
  let state = seed;
  return Float64Array.from({ length }, () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  });
}

/** A weight vector of 16 steps with the given steps at full weight. */
function accentsOf(steps: number[], length = 16): Float64Array {
  const out = new Float64Array(length);
  for (const step of steps) out[step] = 1;
  return out;
}

const plainGroove: DrumGroove = {
  name: "Kick on one and three",
  steps: 16,
  hits: [
    { step: 0, pitch: KICK, velocity: 100 },
    { step: 8, pitch: KICK, velocity: 100 },
    { step: 4, pitch: SNARE, velocity: 100 },
    { step: 12, pitch: SNARE, velocity: 100 },
  ],
};

const andGroove: DrumGroove = {
  name: "Kick on the and of two",
  steps: 16,
  hits: [...plainGroove.hits, { step: 6, pitch: KICK, velocity: 100 }],
};

const kickSteps = (groove: DrumGroove): number[] => groove.hits.filter((hit) => hit.pitch === KICK).map((hit) => hit.step);

describe("accentProfile", () => {
  it("takes the accents of a bar as the profile, and bars that repeat as full confidence", () => {
    const [profile] = accentProfile(
      onsetFor(4, () => [0, 6, 12]),
      FRAME_RATE,
      grid(4),
      [planBars(0, 4)],
    );
    expect(profile.weights[0]).toBeCloseTo(1);
    expect(profile.weights[6]).toBeCloseTo(1);
    expect(profile.weights[12]).toBeCloseTo(1);
    expect(profile.weights[4]).toBe(0);
    expect(profile.confidence).toBeCloseTo(1, 5);
  });

  it("gives each plan its own profile, from its own bars", () => {
    const profiles = accentProfile(
      onsetFor(4, (bar) => (bar < 2 ? [0, 6, 12] : [0, 8])),
      FRAME_RATE,
      grid(4),
      [planBars(0, 2), planBars(2, 4)],
    );
    expect(profiles[0].weights[6]).toBeCloseTo(1);
    expect(profiles[0].weights[8]).toBe(0);
    expect(profiles[1].weights[8]).toBeCloseTo(1);
    expect(profiles[1].weights[6]).toBe(0);
  });

  it("has no confidence in a plan with no bars, and none in a single bar", () => {
    const empty: SectionPlan = { ...planBars(0, 2), start: 50, end: 60 };
    const [silent, single] = accentProfile(
      onsetFor(4, () => [0, 6]),
      FRAME_RATE,
      grid(4),
      [empty, planBars(0, 1)],
    );
    expect(silent.weights.every((weight) => weight === 0)).toBe(true);
    expect(silent.confidence).toBe(0);
    expect(single.confidence).toBe(0);
  });

  it("gives a low confidence to a curve whose bars do not repeat", () => {
    const random = noise(8 * 2 * FRAME_RATE + 1, 5);
    const [profile] = accentProfile(random, FRAME_RATE, grid(8), [planBars(0, 8)]);
    expect(profile.confidence).toBeLessThan(0.3);
  });
});

describe("stopsAndHits", () => {
  /** Beat levels in dB: `loud` for every beat, with the given beats set to `quiet` (silence is far under the median). */
  const levelsWith = (quiet: number[], loud = 0, silence = -80): Float64Array => {
    const levels = new Float64Array(16).fill(loud);
    for (const beat of quiet) levels[beat] = silence;
    return levels;
  };
  /** An onset curve over 16 beats that peaks at every beat in `beats`, at the given strength. */
  const onsetAt = (beats: number[], strength = 1): Float64Array => {
    const onset = new Float64Array(8 * FRAME_RATE + 1);
    for (const beat of beats) onset[Math.round(beat * 0.5 * FRAME_RATE)] = strength;
    return onset;
  };
  const allBeats = Array.from({ length: 16 }, (_, beat) => beat);
  const withoutBeats = (skip: number[]) => allBeats.filter((beat) => !skip.includes(beat));

  it("gives a stop for a real bar of silence, and a hit on the beat after it with an onset", () => {
    const onset = onsetAt(withoutBeats([4, 5, 6, 7]));
    expect(stopsAndHits(onset, FRAME_RATE, grid(4), levelsWith([4, 5, 6, 7]))).toEqual({ stops: [4, 5, 6, 7], hits: [8] });
  });

  it("gives no stop for a sustained chord: one strum, decaying within 20 dB over each bar", () => {
    // Each bar's first beat is the strum, and the level falls 4 dB a beat from there, so the bar stays within 12 dB.
    const levels = Float64Array.from(allBeats, (beat) => -4 * (beat % 4));
    const onset = onsetAt([0, 4, 8, 12]);
    expect(stopsAndHits(onset, FRAME_RATE, grid(4), levels)).toEqual({ stops: [], hits: [] });
  });

  it("gives no stop for a single silent beat", () => {
    expect(stopsAndHits(onsetAt(withoutBeats([5])), FRAME_RATE, grid(4), levelsWith([5]))).toEqual({ stops: [], hits: [] });
  });

  it("gives no hit when the beat after a stop has no onset in the follow source", () => {
    // The band is silent for beats 4 to 7 and back at beat 8, but the follow stem has no attack on beat 8.
    const onset = onsetAt(withoutBeats([4, 5, 6, 7, 8]));
    expect(stopsAndHits(onset, FRAME_RATE, grid(4), levelsWith([4, 5, 6, 7]))).toEqual({ stops: [4, 5, 6, 7], hits: [] });
  });

  it("gives no hit when the level has not come back within 12 dB of the median", () => {
    const levels = levelsWith([4, 5, 6, 7]);
    levels[8] = -20;
    expect(stopsAndHits(onsetAt(withoutBeats([4, 5, 6, 7])), FRAME_RATE, grid(4), levels)).toEqual({ stops: [4, 5, 6, 7], hits: [] });
  });

  it("finds no stops or hits in a song that plays throughout", () => {
    expect(stopsAndHits(onsetAt(allBeats), FRAME_RATE, grid(4), levelsWith([]))).toEqual({ stops: [], hits: [] });
  });
});

describe("beatLevelsDb", () => {
  it("gives each beat's RMS in dB, and floors a silent beat", () => {
    const sampleRate = 100;
    const mono = new Float32Array(8 * sampleRate);
    mono.fill(0.5, 0, sampleRate);
    const levels = beatLevelsDb(mono, sampleRate, grid(2));
    expect(levels[0]).toBeCloseTo(20 * Math.log10(0.5), 3);
    expect(levels[1]).toBeCloseTo(20 * Math.log10(0.5), 3);
    expect(levels[2]).toBe(-120);
  });
});

describe("pickGrooveByAccents", () => {
  const profile = accentsOf([0, 6, 12]);

  it("picks the groove with a kick on the and of two when one exists", () => {
    expect(pickGrooveByAccents([plainGroove, andGroove], profile, 1)).toBe(1);
    expect(pickGrooveByAccents([andGroove, plainGroove], profile, 1)).toBe(0);
  });

  it("counts only the hits that play at this complexity", () => {
    const lean: DrumGroove = { ...andGroove, hits: [...plainGroove.hits, { step: 6, pitch: KICK, velocity: 100, tier: "lean" }] };
    expect(pickGrooveByAccents([plainGroove, lean], profile, 0)).toBe(0);
    expect(pickGrooveByAccents([plainGroove, lean], profile, 1)).toBe(1);
  });

  it("takes a different groove for a different strumming pattern, on the rock style at energy 2", () => {
    const grooves = STYLES.rock.grooves[2];
    const [verse, chorus] = accentProfile(
      onsetFor(4, (bar) => (bar < 2 ? [0, 10] : [0, 6, 12])),
      FRAME_RATE,
      grid(4),
      [planBars(0, 2), planBars(2, 4)],
    );
    const verseGroove = rankGrooves(grooves, verse.weights, 1)[0];
    const chorusGroove = rankGrooves(grooves, chorus.weights, 1)[0];
    expect(verseGroove).not.toBe(chorusGroove);
    expect(kickSteps(grooves[chorusGroove])).toContain(6);
  });
});

describe("accentPushes", () => {
  // Strong accents on the off-beats 2, 6 and 10, and a strong one on the beat at 4.
  const profile = new Float64Array(16);
  profile[2] = 0.9;
  profile[6] = 1;
  profile[10] = 0.8;
  profile[14] = 0.75;
  profile[4] = 1;

  it("adds nothing below complexity two thirds", () => {
    expect(accentPushes(profile, plainGroove, 0.5, 4)).toEqual([]);
  });

  it("adds at most two pushes, the strongest off-beats, from complexity two thirds up", () => {
    expect(MAX_PUSHES).toBe(2);
    expect(accentPushes(profile, plainGroove, 1, 4)).toEqual([2, 6]);
  });

  it("does not push where the groove already has a kick, or on a beat", () => {
    expect(accentPushes(profile, { ...plainGroove, hits: [...plainGroove.hits, { step: 6, pitch: KICK, velocity: 100 }] }, 1, 4)).toEqual([2, 10]);
  });
});

describe("bassRhythmFromAccents", () => {
  it("takes the steps at half accent or more, and always step 0", () => {
    const profile = new Float64Array(16);
    profile[2] = 0.6;
    profile[6] = 1;
    profile[10] = 0.5;
    profile[12] = 0.49;
    profile[15] = 0.9;
    expect(bassRhythmFromAccents(profile, 4, 4)).toEqual([0, 2, 6, 10, 15]);
  });
});

describe("followFeel", () => {
  const audio = (onset: Float64Array): OnsetStrength => ({ onset, low: onset, frameRate: FRAME_RATE });

  it("follows nothing in auto when no section repeats, and follows in an explicit choice", () => {
    const random = audio(noise(8 * 2 * FRAME_RATE + 1, 9));
    const plans = [planBars(0, 8)];
    const level = new Float64Array(8 * 4);
    expect(followFeel(random, grid(8), plans, true, level).feel).toBeNull();
    expect(followFeel(random, grid(8), plans, false, level).feel).not.toBeNull();
  });

  it("follows a steady accent pattern in auto, with its stops and hits", () => {
    // An onset on every beat (0, 4, 8, 12) and the accents on top, so no beat is silent.
    const steady = audio(onsetFor(8, () => [0, 4, 6, 8, 12]));
    const result = followFeel(steady, grid(8), [planBars(0, 8)], true, new Float64Array(8 * 4));
    expect(result.feel).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.feel?.stops.size).toBe(0);
    expect(result.feel?.hits.size).toBe(0);
  });
});

describe("resolveFollowSource and followStatus", () => {
  it("uses the explicit stem when it exists, and auto's order otherwise", () => {
    expect(resolveFollowSource("auto", ["guitar", "other", "mix"])).toBe("guitar");
    expect(resolveFollowSource("auto", ["other", "mix"])).toBe("other");
    expect(resolveFollowSource("auto", ["mix"])).toBe("mix");
    expect(resolveFollowSource("piano", ["guitar", "mix"])).toBe("guitar");
    expect(resolveFollowSource("mix", ["guitar", "mix"])).toBe("mix");
  });

  it("says what was followed, or why it was not", () => {
    expect(followStatus({ source: "guitar", following: true })).toBe("Following the guitar for its accents.");
    expect(followStatus({ source: "guitar", following: false })).toBe("Follow my playing: not enough clear rhythm in the guitar");
  });
});

describe("groove scoring", () => {
  it("scores a groove with no kick or snare below one that has them, on any accent", () => {
    const hatsOnly: DrumGroove = { name: "Hats", steps: 16, hits: [{ step: 0, pitch: CLOSED_HAT, velocity: 80 }] };
    expect(pickGrooveByAccents([hatsOnly, plainGroove], accentsOf([0, 8]), 1)).toBe(1);
  });
});
