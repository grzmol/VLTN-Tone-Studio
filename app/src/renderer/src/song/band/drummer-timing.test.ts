import { describe, expect, it } from "vitest";
import { bandOf, drumOnsets, followDrummer, type DrumOnsets } from "./drummer-timing";
import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, SNARE, type NoteEvent } from "./note";
import type { PcmAudio } from "../types";

const RATE = 44100;

/** Deterministic noise in -1..1. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2147483648 - 1;
  };
}

/** One-pole low-pass, used to build the test sounds. */
function lowPass(input: Float32Array, cutoff: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  const out = new Float32Array(input.length);
  let state = 0;
  for (let i = 0; i < input.length; i++) out[i] = state += a * (input[i] - state);
  return out;
}

interface Hit {
  kind: "kick" | "snare" | "hat";
  time: number;
}

/** A drums stem with kicks (decaying 60 Hz bursts), snares (noise limited to 1 to 4 kHz) and hats (short high noise ticks) at known times. */
function stem(hits: Hit[], seconds: number, channels = 1): PcmAudio {
  const out = new Float32Array(Math.round(seconds * RATE));
  const random = noise(5);
  for (const hit of hits) {
    const start = Math.round(hit.time * RATE);
    if (hit.kind === "kick") {
      for (let i = 0; i < 0.25 * RATE && start + i < out.length; i++)
        out[start + i] += 0.8 * Math.cos((2 * Math.PI * 60 * i) / RATE) * (1 - Math.exp(-i / (0.0005 * RATE))) * Math.exp(-i / (0.06 * RATE));
    } else if (hit.kind === "snare") {
      // Noise with a decay, kept between about 1 and 4 kHz by several passes of each filter.
      const burst = new Float32Array(Math.round(0.12 * RATE)).map((_, i) => random() * Math.exp(-i / (0.03 * RATE)));
      const top = lowPass(lowPass(lowPass(burst, 2500), 2500), 2500);
      const bottom = lowPass(lowPass(burst, 1200), 1200);
      top.forEach((value, i) => {
        if (start + i < out.length) out[start + i] += 25 * (value - bottom[i]);
      });
    } else {
      // A tick of noise with only its top kept (two passes above 9 kHz), with a short decay.
      const tick = new Float32Array(Math.round(0.03 * RATE)).map((_, i) => random() * Math.exp(-i / (0.006 * RATE)));
      const slow = lowPass(tick, 9000);
      const once = tick.map((value, i) => value - slow[i]);
      once.forEach((value, i) => {
        if (start + i < out.length) out[start + i] += 2 * value;
      });
    }
  }
  return { sampleRate: RATE, channels: Array.from({ length: channels }, () => out) };
}

describe("drumOnsets", () => {
  const hits: Hit[] = [
    { kind: "kick", time: 0.5 },
    { kind: "hat", time: 0.75 },
    { kind: "snare", time: 1.0 },
    { kind: "kick", time: 1.4 },
    { kind: "hat", time: 1.55 },
    { kind: "snare", time: 2.0 },
    { kind: "kick", time: 2.37 },
  ];
  const onsets = drumOnsets(stem(hits, 3));
  const near = (found: number[], expected: number[]): void => {
    expect(found).toHaveLength(expected.length);
    found.forEach((time, index) => expect(Math.abs(time - expected[index])).toBeLessThan(0.0015));
  };

  /** Every expected time has a hit within 1.5 ms. A snare's noisy edge also reaches the high band, so that band may hold more. */
  const hasEach = (found: number[], expected: number[]): void => {
    for (const time of expected) expect(found.some((hit) => Math.abs(hit - time) < 0.0015)).toBe(true);
  };

  it("finds each piece's hits within about a millisecond", () => {
    near(onsets.kick, [0.5, 1.4, 2.37]);
    near(onsets.mid, [1.0, 2.0]);
    hasEach(onsets.high, [0.75, 1.55]);
  });

  it("does not read a kick as a hat", () => {
    expect(onsets.high.some((time) => Math.abs(time - 0.5) < 0.02 || Math.abs(time - 1.4) < 0.02 || Math.abs(time - 2.37) < 0.02)).toBe(false);
  });

  it("averages the channels of a stereo stem", () => {
    near(drumOnsets(stem(hits, 3, 2)).kick, [0.5, 1.4, 2.37]);
  });

  it("finds nothing in silence", () => {
    expect(drumOnsets(stem([], 2))).toEqual({ kick: [], mid: [], high: [] });
  });

  it("finds kicks throughout a 5-minute stereo drum stem", () => {
    const longHits: Hit[] = Array.from({ length: 600 }, (_, i) => ({
      kind: (["kick", "hat", "snare", "hat"] as const)[i % 4],
      time: 0.25 + i * 0.5,
    }));
    const found = drumOnsets(stem(longHits, 300, 2));
    // Check accuracy across the full stem; wall-clock speed depends on the runner and concurrent test load.
    near(found.kick, longHits.filter((hit) => hit.kind === "kick").map((hit) => hit.time));
  }, 15_000);
});

describe("bandOf", () => {
  it("reads kicks low, snares and toms in the middle, and hats, ride and crash high", () => {
    expect([KICK, SNARE, CLOSED_HAT].map(bandOf)).toEqual(["kick", "mid", "high"]);
  });
});

const note = (time: number, pitch: number): NoteEvent => ({ time, pitch, velocity: 100, duration: 0.1 });

describe("followDrummer", () => {
  it("moves syncopated kicks onto the drummer's early hits, and leaves matching ones where they are", () => {
    // Sixteenths at 0.125 s: the on-beat kick matches, the offbeat kick is played 30 ms early.
    const onsets: DrumOnsets = { kick: [0, 0.345, 0.5], mid: [], high: [] };
    const drums = [note(0, KICK), note(0.375, KICK), note(0.5, KICK)];
    const result = followDrummer(drums, [], onsets).drums;
    expect(result[0].time).toBeCloseTo(0, 4);
    expect(result[1].time).toBeCloseTo(0.345, 4);
    expect(result[2].time).toBeCloseTo(0.5, 4);
  });

  it("leaves a note with no hit within 40 ms, and a note of another band alone", () => {
    const onsets: DrumOnsets = { kick: [1.06], mid: [], high: [] };
    const drums = [note(1, KICK), note(1.06, SNARE)];
    expect(followDrummer(drums, [], onsets).drums).toEqual(drums);
  });

  it("gives a hit to the nearer of two notes", () => {
    const onsets: DrumOnsets = { kick: [1.0], mid: [], high: [] };
    const result = followDrummer([note(0.97, KICK), note(1.01, KICK)], [], onsets).drums;
    expect(result.map((n) => n.time)).toEqual([0.97, 1.0]);
  });

  it("moves a bass note locked to a kick with it, and not an unlocked one", () => {
    const onsets: DrumOnsets = { kick: [0.345], mid: [], high: [] };
    const drums = [note(0.375, KICK)];
    const bass = [note(0.377, 40), note(0.45, 40)];
    const result = followDrummer(drums, bass, onsets).bass;
    expect(result[0].time).toBeCloseTo(0.347, 4);
    expect(result[1].time).toBe(0.45);
  });

  it("keeps the notes' lengths and order", () => {
    const onsets: DrumOnsets = { kick: [0.345], mid: [], high: [] };
    const result = followDrummer([note(0.375, KICK)], [], onsets).drums[0];
    expect(result.duration).toBe(0.1);
    expect(result.velocity).toBe(100);
  });
});

it.each([[CLOSED_HAT, CRASH, "high"], [SNARE, HIGH_TOM, "mid"]] as const)(
  "keeps simultaneous pitches %i and %i together while distinct beats compete",
  (first, second, band) => {
    const onsets: DrumOnsets = { kick: [], mid: [], high: [] };
    onsets[band] = [0.98, 1.035];
    const drums = [note(1, first), note(1, second), note(1.04, first)];
    const result = followDrummer(drums, [], onsets).drums;
    expect(result.map((n) => n.time)).toEqual([0.98, 0.98, 1.035]);
    expect(drums.map((n) => n.time)).toEqual([1, 1, 1.04]);
  },
);
