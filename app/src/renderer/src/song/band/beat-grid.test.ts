import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import {
  chordChangeTimesOf,
  detectBeatGrid,
  doubleTempo,
  downbeatFromChordChanges,
  estimateMeter,
  estimateTempo,
  fitSteady,
  fixedBeatGrid,
  halveTempo,
  HOP,
  nudgeGrid,
  onsetStrength,
  parseBeatGrid,
  pickDownbeat,
  refineTempo,
  shiftDownbeat,
  trackBeats,
  withChordDownbeat,
  type BeatGrid,
} from "./beat-grid";

const RATE = 44100;
const SECONDS = 30;
const FIRST_BEAT = 0.5;

/** Deterministic noise in −1..1, so a failing test reproduces the same audio. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32) * 2 - 1;
  };
}

interface Hit {
  at: number;
  amplitude: number;
  /** Decay time constant, in seconds */
  decay: number;
  /** A sine at this frequency instead of a noise burst: a low thump */
  tone?: number;
}

/** Renders hits onto a mono track over a quiet floor. Noise bursts are broadband, like a stick hit, so the onset tracker can lock onto them. */
function render(hits: Hit[], seconds = SECONDS): PcmAudio {
  const out = new Float32Array(Math.round(seconds * RATE));
  const random = noise(7);
  for (let i = 0; i < out.length; i++) out[i] = 0.004 * random();
  for (const hit of hits) {
    const start = Math.round(hit.at * RATE);
    for (let i = 0; i < 0.3 * RATE && start + i < out.length; i++) {
      const t = i / RATE;
      const body = hit.tone ? Math.sin(2 * Math.PI * hit.tone * t) : random();
      out[start + i] += hit.amplitude * Math.exp(-t / hit.decay) * body;
    }
  }
  return { sampleRate: RATE, channels: [out] };
}

/** Click track: a noise burst on every beat, and a low thump on beats with index % thumpEvery === thumpOffset. */
function clickAudio(beats: number[], thumpEvery: number, thumpOffset = 0): PcmAudio {
  const hits: Hit[] = [];
  beats.forEach((at, i) => {
    hits.push({ at, amplitude: 0.5, decay: 0.012 });
    if (i % thumpEvery === thumpOffset) hits.push({ at, amplitude: 0.8, decay: 0.08, tone: 55 });
  });
  return render(hits);
}

/** Beats at a constant tempo from `first`, one every 60 / bpm seconds, up to the end of a clip that is `seconds` long. */
function beatsFrom(first: number, bpm: number, seconds = SECONDS): number[] {
  const beats: number[] = [];
  for (let k = 0; first + (k * 60) / bpm < seconds - 0.5; k++) beats.push(first + (k * 60) / bpm);
  return beats;
}

/** Beats at a constant tempo, starting at FIRST_BEAT. */
function steadyBeats(bpm: number, seconds = SECONDS): number[] {
  const beats: number[] = [];
  for (let t = FIRST_BEAT; t < seconds - 0.5; t += 60 / bpm) beats.push(t);
  return beats;
}

/** Beats whose tempo moves linearly from `from` to `to` BPM over the clip. */
function driftBeats(from: number, to: number, seconds = SECONDS): number[] {
  const beats: number[] = [];
  for (let t = FIRST_BEAT; t < seconds - 0.5; t += 60 / (from + ((to - from) * t) / seconds)) beats.push(t);
  return beats;
}

/** Share of the true beats with a detected beat within `tolerance` seconds. */
function hitRate(detected: readonly number[], truth: readonly number[], tolerance = 0.07): number {
  const hits = truth.filter((t) => detected.some((d) => Math.abs(d - t) <= tolerance)).length;
  return hits / truth.length;
}

describe("onsetStrength", () => {
  it("returns one frame per hop, at the hop's frame rate, with no negative values", () => {
    const { onset, low, frameRate } = onsetStrength([render([{ at: 0.5, amplitude: 0.5, decay: 0.01 }], 2)], RATE);
    expect(frameRate).toBeCloseTo(RATE / 512, 6);
    expect(onset.length).toBe(Math.ceil((2 * RATE) / 512));
    expect(low.length).toBe(onset.length);
    expect(onset.every((v) => v >= 0)).toBe(true);
    expect(low.every((v) => v >= 0)).toBe(true);
  });

  it("returns empty curves for no audio", () => {
    expect(onsetStrength([], RATE).onset.length).toBe(0);
  });
});

describe("click track at 120 BPM", () => {
  const beats = steadyBeats(120);
  const truth = beats;
  const audio = clickAudio(beats, 4);

  it("tracks at least 95% of the beats within 70 ms, with the downbeat on the thump", () => {
    const grid = detectBeatGrid([audio], RATE, 4);
    expect(hitRate(grid.beats, truth)).toBeGreaterThanOrEqual(0.95);
    // The first true beat is a downbeat, so the grid's downbeat must land on a beat in that phase.
    const nearest = grid.beats.findIndex((b) => Math.abs(b - FIRST_BEAT) <= 0.07);
    expect(nearest).toBeGreaterThanOrEqual(0);
    expect((grid.downbeat - nearest + 400) % 4).toBe(0);
    expect(grid.bpm).toBeCloseTo(120, 0);
  });

  it("fits a steady line at 120 BPM that starts on the first click", () => {
    const { steady } = detectBeatGrid([audio], RATE, 4);
    expect(steady).not.toBeNull();
    expect(Math.abs(steady!.bpm - 120)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(steady!.firstBeat - FIRST_BEAT)).toBeLessThanOrEqual(0.02);
  });
});

describe("onset peak of a single click", () => {
  it("peaks within one hop of the click, not one hop early as it did with frames centred on t × HOP", () => {
    const { onset, frameRate } = onsetStrength([render([{ at: 1, amplitude: 0.5, decay: 0.012 }], 2)], RATE);
    let peak = 0;
    for (let t = 0; t < onset.length; t++) if (onset[t] > onset[peak]) peak = t;
    expect(Math.abs(peak / frameRate - 1)).toBeLessThanOrEqual(HOP / RATE);
    expect(peak / frameRate).toBeGreaterThan(1 - HOP / RATE / 2);
  });
});

describe("click track that starts at exactly 0 s", () => {
  const truth = beatsFrom(0, 120);
  const audio = clickAudio(truth, 4);

  it("puts the first beat within 3 ms of 0 and every beat within 3 ms of its click", () => {
    const grid = detectBeatGrid([audio], RATE, 4);
    expect(grid.beats).toHaveLength(truth.length);
    grid.beats.forEach((beat, i) => expect(Math.abs(beat - truth[i])).toBeLessThanOrEqual(0.003));
  });

  it("puts the downbeat on the accented first click and fits a steady 120 BPM line", () => {
    const grid = detectBeatGrid([audio], RATE, 4);
    expect(grid.downbeat).toBe(0);
    expect(grid.steady).not.toBeNull();
    expect(Math.abs(grid.steady!.bpm - 120)).toBeLessThanOrEqual(0.1);
  });
});

describe("click track with a pickup at 0.25 s", () => {
  // The bar starts on the second click, at 0.75 s, so the first click at 0.25 s is a pickup and must not be turned into a bar of its own.
  const truth = beatsFrom(0.25, 120);
  const audio = clickAudio(truth, 4, 1);

  it("keeps the pickup at 0.25 s and puts the downbeat on the accent at 0.75 s", () => {
    const grid = detectBeatGrid([audio], RATE, 4);
    expect(Math.abs(grid.beats[0] - 0.25)).toBeLessThanOrEqual(0.003);
    expect(grid.downbeat).toBe(1);
    expect(Math.abs(grid.beats[grid.downbeat] - 0.75)).toBeLessThanOrEqual(0.003);
  });
});

describe("drift from 116 to 124 BPM", () => {
  const truth = driftBeats(116, 124);
  const audio = clickAudio(truth, 4);

  it("tracks at least 85% of the beats within 70 ms and does not call the song steady", () => {
    const grid = detectBeatGrid([audio], RATE, 4);
    expect(hitRate(grid.beats, truth)).toBeGreaterThanOrEqual(0.85);
    expect(grid.steady).toBeNull();
  });
});

describe("tempo of a click track", () => {
  // Accented click tracks, as a band plays them. Slow, mid and fast tempi, with the fast end (150, 170) the case that used to halve.
  it.each([75, 90, 120, 150, 170])("tracks %i BPM as the tempo, not only as a candidate", (bpm) => {
    const grid = detectBeatGrid([clickAudio(steadyBeats(bpm), 4)], RATE, 4);
    const { onset, frameRate } = onsetStrength([clickAudio(steadyBeats(bpm), 4)], RATE);
    expect(Math.abs(estimateTempo(onset, frameRate).bpm - bpm)).toBeLessThanOrEqual(1);
    expect(Math.abs(grid.bpm - bpm)).toBeLessThanOrEqual(1);
    expect(hitRate(grid.beats, steadyBeats(bpm))).toBeGreaterThanOrEqual(0.95);
  });
});

describe("a tempo the performer typed", () => {
  // A click that is really at 97.6 BPM, typed as 98 (close) or 97, and as 120 (far off).
  const beats = steadyBeats(97.6);
  const audio = clickAudio(beats, 4);

  it("refines a close hint to the tempo of the audio", () => {
    const { onset, frameRate } = onsetStrength([audio], RATE);
    expect(Math.abs(refineTempo(onset, frameRate, 98) - 97.6)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(refineTempo(onset, frameRate, 97) - 97.6)).toBeLessThanOrEqual(0.1);
  });

  it("stays within the spread of a far hint, rather than jumping to the audio's tempo", () => {
    const { onset, frameRate } = onsetStrength([audio], RATE);
    const refined = refineTempo(onset, frameRate, 120);
    expect(refined).toBeGreaterThanOrEqual(120 * 0.96);
    expect(refined).toBeLessThanOrEqual(120 * 1.04);
  });

  it("tracks the beats at the refined tempo", () => {
    const grid = detectBeatGrid([audio], RATE, 4, [], { tempoHint: 98 });
    expect(Math.abs(grid.bpm - 97.6)).toBeLessThanOrEqual(0.3);
    expect(hitRate(grid.beats, beats)).toBeGreaterThanOrEqual(0.95);
  });

  it("returns zero for a silent curve, which has no tempo to refine", () => {
    expect(refineTempo(new Float64Array(4000), 86, 98)).toBe(0);
  });

  it("keeps the typed tempo exactly when it is locked, and finds the beats on that grid", () => {
    // Clicks at 120 BPM, typed as 118. The audio disagrees with the typed tempo, but a lock keeps what the performer set: every beat is 60 / 118 apart.
    const locked = detectBeatGrid([clickAudio(steadyBeats(120), 4)], RATE, 4, [], { tempoHint: 118, lockTempo: true });
    expect(locked.steady?.bpm).toBeCloseTo(118, 6);
    expect(locked.bpm).toBeCloseTo(118, 6);
    expect(locked.beats[1] - locked.beats[0]).toBeCloseTo(60 / 118, 6);
  });

  it("locks to the exact tempo and puts the downbeat on the thump", () => {
    const truth = steadyBeats(120);
    const grid = detectBeatGrid([clickAudio(truth, 4)], RATE, 4, [], { tempoHint: 120, lockTempo: true });
    expect(grid.bpm).toBeCloseTo(120, 6);
    // Thumps fall on every fourth click: the first one is at 0.5 s, so the downbeat is 0.5 s modulo 2 s.
    const downbeatTime = grid.beats[grid.downbeat];
    expect(Math.abs((downbeatTime % 2) - FIRST_BEAT)).toBeLessThanOrEqual(0.03);
    expect(hitRate(grid.beats, truth)).toBeGreaterThanOrEqual(0.95);
  });
});

describe("tempo candidates", () => {
  it("includes 150 BPM when the track is at 75 BPM", () => {
    const { onset, frameRate } = onsetStrength([clickAudio(steadyBeats(75), 4)], RATE);
    expect(estimateTempo(onset, frameRate).candidates).toEqual(expect.arrayContaining([expect.closeTo(150, 0)]));
  });

  it("includes 75 BPM when the track is at 150 BPM", () => {
    const { onset, frameRate } = onsetStrength([clickAudio(steadyBeats(150), 4)], RATE);
    expect(estimateTempo(onset, frameRate).candidates).toEqual(expect.arrayContaining([expect.closeTo(75, 0)]));
  });
});

describe("downbeat from chord changes", () => {
  it("moves the downbeat to a chord change when every beat has the same low thump", () => {
    const beats = steadyBeats(120);
    // Every beat has a thump, so the low band has no preference. The chord changes fall on beats 2, 6, 10 …
    const changes = beats.filter((_, i) => i % 4 === 2);
    const grid = detectBeatGrid([clickAudio(beats, 1)], RATE, 4, changes);
    expect(changes.some((c) => Math.abs(grid.beats[grid.downbeat] - c) <= 0.07)).toBe(true);
  });

  it("keeps the low-band choice when no chord change is given", () => {
    const beats = steadyBeats(120);
    const grid = detectBeatGrid([clickAudio(beats, 4)], RATE, 4);
    const nearest = grid.beats.findIndex((b) => Math.abs(b - FIRST_BEAT) <= 0.07);
    expect((grid.downbeat - nearest + 400) % 4).toBe(0);
  });
});

describe("pickDownbeat", () => {
  it("returns the phase with the most chord-change hits when low evidence is equal", () => {
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    const flat = new Float64Array(400).fill(1);
    expect(pickDownbeat(beats, flat, 100, 4, [1.0, 3.0])).toBe(2);
  });

  it("returns 0 for no beats", () => {
    expect(pickDownbeat([], new Float64Array(10), 100, 4)).toBe(0);
  });
});

describe("downbeatFromChordChanges", () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];

  it("moves the downbeat to the phase most chord changes fall on", () => {
    // Changes on beats 0 and 4 (phase 0), current downbeat is phase 1.
    expect(downbeatFromChordChanges(beats, [0.0, 2.0], 4, 1)).toBe(0);
  });

  it("keeps the current downbeat when the chord changes fall on it", () => {
    expect(downbeatFromChordChanges(beats, [0.5, 2.5], 4, 1)).toBe(1);
  });

  it("keeps the current downbeat when no change is near a beat or the hits split evenly", () => {
    expect(downbeatFromChordChanges(beats, [], 4, 3)).toBe(3);
    expect(downbeatFromChordChanges(beats, [0.0, 0.5], 4, 3)).toBe(3);
  });

  it("needs most of the hits, not just a plurality", () => {
    // Two changes on phase 0 and two on phase 1: phase 0 leads only on the tie-break, which is not a majority, so the downbeat stays.
    expect(downbeatFromChordChanges(beats, [0.0, 2.0, 0.5, 2.5], 4, 3)).toBe(3);
  });
});

describe("withChordDownbeat", () => {
  it("moves a phase-1 downbeat to phase 0 and keeps the rest of the grid", () => {
    const grid: BeatGrid = { beatsPerBar: 4, beats: [0.2, 1.2, 2.2, 3.2, 4.2, 5.2, 6.2, 7.2], downbeat: 1, bpm: 60, steady: null };
    const next = withChordDownbeat(grid, [4.2]);
    expect(next.downbeat).toBe(0);
    expect(next.beats).toBe(grid.beats);
    expect(next.bpm).toBe(60);
  });

  it("returns the same grid when the downbeat stays", () => {
    const grid: BeatGrid = { beatsPerBar: 4, beats: [0, 1, 2, 3, 4], downbeat: 0, bpm: 60, steady: null };
    expect(withChordDownbeat(grid, [4])).toBe(grid);
  });

  it("moves the steady first beat of a locked grid with the downbeat", () => {
    const beats = [0.2, 1.2, 2.2, 3.2, 4.2, 5.2, 6.2, 7.2];
    const grid: BeatGrid = { beatsPerBar: 4, beats, downbeat: 1, bpm: 60, steady: { bpm: 60, firstBeat: 1.2 } };
    expect(withChordDownbeat(grid, [4.2]).steady).toEqual({ bpm: 60, firstBeat: 0.2 });
  });
});

describe("chordChangeTimesOf", () => {
  it("gives the times where the name changes, not the first chord", () => {
    const chords = [
      { time: 0, name: "F#m" },
      { time: 4, name: "F#m" },
      { time: 8, name: "E" },
      { time: 12, name: "E" },
      { time: 16, name: "D" },
    ];
    expect(chordChangeTimesOf(chords)).toEqual([8, 16]);
  });
});

describe("fitSteady", () => {
  it("returns null for fewer than four beats or a drifting track", () => {
    expect(fitSteady([0, 0.5, 1])).toBeNull();
    expect(fitSteady([0, 0.5, 1.04, 1.5])).toBeNull();
  });

  it("returns the tempo and first beat of an exact line", () => {
    expect(fitSteady([1, 1.5, 2, 2.5])).toEqual({ bpm: 120, firstBeat: 1 });
  });

  it("ignores one stray last beat when the rest of the line fits", () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.5);
    beats[19] += 0.06;
    const steady = fitSteady(beats);
    expect(steady).not.toBeNull();
    expect(steady!.bpm).toBeCloseTo(120, 1);
    expect(steady!.firstBeat).toBeCloseTo(0, 2);
  });

  it("ignores one stray first beat when the rest of the line fits", () => {
    const beats = Array.from({ length: 20 }, (_, i) => 1 + i * 0.5);
    beats[0] -= 0.06;
    expect(fitSteady(beats)).not.toBeNull();
  });

  it("does not drop a stray beat in the middle", () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.5);
    beats[10] += 0.06;
    expect(fitSteady(beats)).toBeNull();
  });
});

describe("trackBeats", () => {
  it("returns nothing for a silent or zero-tempo curve", () => {
    expect(trackBeats(new Float64Array(100), 86, 120)).toEqual([]);
    expect(trackBeats(new Float64Array(100).fill(1), 86, 0)).toEqual([]);
  });
});

describe("corrections", () => {
  const grid: BeatGrid = {
    beatsPerBar: 4,
    beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    downbeat: 1,
    bpm: 120,
    steady: { bpm: 120, firstBeat: 0 },
  };

  it("halves the tempo, keeping the downbeat's beat", () => {
    const halved = halveTempo(grid);
    expect(halved.beats).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(halved.beats[halved.downbeat]).toBe(0.5);
    expect(halved.bpm).toBeCloseTo(60, 6);
  });

  it("doubles the tempo, adding midpoints and keeping the downbeat's time", () => {
    const doubled = doubleTempo(grid);
    expect(doubled.beats).toHaveLength(15);
    expect(doubled.beats[doubled.downbeat]).toBe(0.5);
    expect(doubled.bpm).toBeCloseTo(240, 6);
  });

  it("moves the downbeat by one beat, wrapping within the bar", () => {
    expect(shiftDownbeat(grid, 1).downbeat).toBe(2);
    expect(shiftDownbeat(grid, -1).downbeat).toBe(0);
    expect(shiftDownbeat({ ...grid, downbeat: 0 }, -1).downbeat).toBe(3);
  });

  it("nudges by at most 0.1 s per call", () => {
    const shifted = nudgeGrid({ ...grid, beats: [0.5, 1.05, 1.55] }, -5);
    expect(shifted.beats[0]).toBeCloseTo(0.4, 9);
    expect(shifted.beats[1]).toBeCloseTo(0.95, 9);
    expect(nudgeGrid(grid, 0.5).beats[0]).toBeCloseTo(0.1, 9);
  });

  it("drops beats that would fall before the start and keeps the downbeat on its beat in time", () => {
    const early: BeatGrid = { ...grid, beats: [0.05, 0.55, 1.05, 1.55, 2.05, 2.55, 3.05, 3.55], downbeat: 2 };
    const nudged = nudgeGrid(early, -0.1);
    expect(nudged.beats).toHaveLength(7);
    expect(nudged.beats[0]).toBeCloseTo(0.45, 9);
    // The downbeat was the beat at 1.05; it is now at 0.95, and its index drops by the one beat removed.
    expect(nudged.downbeat).toBe(1);
    expect(nudged.beats[nudged.downbeat]).toBeCloseTo(0.95, 9);
  });

  it("wraps the downbeat when its own beat is dropped, onto the next beat of the same phase", () => {
    const early: BeatGrid = { ...grid, beats: [0.05, 0.55, 1.05, 1.55, 2.05, 2.55, 3.05, 3.55], downbeat: 0 };
    const nudged = nudgeGrid(early, -0.1);
    expect(nudged.beats).toHaveLength(7);
    expect(nudged.downbeat).toBe(3);
    // The downbeat at 0.05 is gone; the next beat of the same bar phase is the one at 2.05.
    expect(nudged.beats[nudged.downbeat]).toBeCloseTo(1.95, 9);
  });
});

describe("tempo corrections with a downbeat that is not the first beat", () => {
  const grid: BeatGrid = {
    beatsPerBar: 4,
    beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    downbeat: 3,
    bpm: 120,
    steady: { bpm: 120, firstBeat: 0 },
  };

  it("halving keeps the downbeat on the same beat in time", () => {
    const halved = halveTempo(grid);
    expect(halved.beats[halved.downbeat]).toBe(1.5);
  });

  it("doubling keeps the old downbeat as one of the downbeats, at the same bar phase", () => {
    const doubled = doubleTempo(grid);
    const oldDownbeat = doubled.beats.indexOf(1.5);
    expect(oldDownbeat).toBeGreaterThanOrEqual(0);
    expect((((oldDownbeat - doubled.downbeat) % 4) + 4) % 4).toBe(0);
  });
});

describe("parseBeatGrid", () => {
  const stored = { beatsPerBar: 4, beats: [0.5, 1, 1.5, 2, 2.5], downbeat: 1, bpm: 120, steady: null };

  it("reads a valid saved grid and works out its tempo again", () => {
    const grid = parseBeatGrid(stored);
    expect(grid).toEqual({ beatsPerBar: 4, beats: [0.5, 1, 1.5, 2, 2.5], downbeat: 1, bpm: 120, steady: { bpm: 120, firstBeat: 0.5 } });
  });

  it("rejects garbage", () => {
    for (const value of [null, undefined, "grid", 42, [], { beatsPerBar: 4 }, { ...stored, beats: "0.5,1" }, { ...stored, beats: [] }]) {
      expect(parseBeatGrid(value)).toBeNull();
    }
    expect(parseBeatGrid({ ...stored, beats: [0.5, "1", 1.5] })).toBeNull();
    expect(parseBeatGrid({ ...stored, beats: [0.5, Number.NaN, 1.5] })).toBeNull();
    expect(parseBeatGrid({ ...stored, beats: [-0.5, 1] })).toBeNull();
    expect(parseBeatGrid({ ...stored, beatsPerBar: 4.5 })).toBeNull();
    expect(parseBeatGrid({ ...stored, beatsPerBar: 0 })).toBeNull();
    expect(parseBeatGrid({ ...stored, beatsPerBar: 40 })).toBeNull();
  });

  it("rejects beats that do not increase", () => {
    expect(parseBeatGrid({ ...stored, beats: [0.5, 1, 1] })).toBeNull();
    expect(parseBeatGrid({ ...stored, beats: [1, 0.5] })).toBeNull();
  });

  it("rejects a downbeat outside the bar", () => {
    expect(parseBeatGrid({ ...stored, downbeat: 4 })).toBeNull();
    expect(parseBeatGrid({ ...stored, downbeat: -1 })).toBeNull();
    expect(parseBeatGrid({ ...stored, downbeat: 1.5 })).toBeNull();
  });
});

describe("fixedBeatGrid", () => {
  it("lays a beat every 60 / bpm seconds from the metronome's first beat to the end of the song", () => {
    const grid = fixedBeatGrid(120, 0.25, 4, 2);
    expect(grid.beats).toEqual([0.25, 0.75, 1.25, 1.75]);
    expect(grid.downbeat).toBe(0);
    expect(grid.bpm).toBeCloseTo(120, 6);
  });

  it("keeps the bar phase of a first beat that is later in the song", () => {
    const grid = fixedBeatGrid(120, 1.25, 4, 2);
    expect(grid.beats[0]).toBeCloseTo(0.25, 9);
    expect(grid.downbeat).toBe(2);
    expect(grid.beats[grid.downbeat]).toBeCloseTo(1.25, 9);
  });

  it("gives an empty grid for a tempo that cannot be used", () => {
    expect(fixedBeatGrid(0, 0, 4, 10).beats).toEqual([]);
    expect(fixedBeatGrid(120, 0, 4, 0).beats).toEqual([]);
  });
});

describe("estimateMeter", () => {
  // Beats every 0.5 s at a frame rate of 100. The first beat of each bar carries a strong low onset, the others a weak one, and a chord
  // change falls on each bar's first beat, as it does in a real song.
  function accented(beatsPerBar: number, bars = 12) {
    const beats = Array.from({ length: beatsPerBar * bars }, (_, i) => i * 0.5);
    const low = new Float64Array(Math.ceil((beats.length * 0.5 + 1) * 100));
    beats.forEach((beat, i) => {
      low[Math.round(beat * 100)] = i % beatsPerBar === 0 ? 1 : 0.2;
    });
    const chords = beats.filter((_, i) => i % beatsPerBar === 0);
    return { beats, low, chords };
  }

  it("finds three beats in a bar", () => {
    const { beats, low, chords } = accented(3);
    expect(estimateMeter(beats, low, 100, chords).beatsPerBar).toBe(3);
  });

  it("finds four beats in a bar", () => {
    const { beats, low, chords } = accented(4);
    expect(estimateMeter(beats, low, 100, chords).beatsPerBar).toBe(4);
  });

  it("is confident when the accents are clear", () => {
    const { beats, low, chords } = accented(3);
    expect(estimateMeter(beats, low, 100, chords).confidence).toBeGreaterThan(0.6);
  });

  it("has no confidence when every beat sounds the same", () => {
    const beats = Array.from({ length: 48 }, (_, i) => i * 0.5);
    const low = new Float64Array(Math.ceil(25 * 100) + 1).fill(0.5);
    const estimate = estimateMeter(beats, low, 100, []);
    expect(estimate.confidence).toBeLessThan(0.1);
  });

  it("falls back to four beats when there are too few beats to tell", () => {
    expect(estimateMeter([0, 0.5, 1], new Float64Array(200), 100)).toEqual({ beatsPerBar: 4, confidence: 0 });
  });
});
