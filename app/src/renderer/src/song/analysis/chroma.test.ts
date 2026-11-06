import { describe, expect, it } from "vitest";
import { chromaFrames, estimateTuningCents, windowFor } from "./chroma";
import type { PcmAudio } from "../types";

const RATE = 44100;

/** Sine partials of one note: `partials[k]` is the level of harmonic k + 1. Synthetic audio only. */
function note(hz: number, seconds: number, partials: number[] = [1]): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    partials.forEach((level, k) => (sum += level * Math.sin((2 * Math.PI * hz * (k + 1) * i) / RATE)));
    out[i] = 0.3 * sum;
  }
  return out;
}

function mono(channel: Float32Array): PcmAudio {
  return { sampleRate: RATE, channels: [channel] };
}

/** Consecutive spans of `width` seconds covering `seconds`. */
function spansOf(seconds: number, width = 1): { start: number; end: number }[] {
  return Array.from({ length: Math.floor(seconds / width) }, (_, i) => ({ start: i * width, end: (i + 1) * width }));
}

const argmax = (values: ArrayLike<number>) => Array.from(values).indexOf(Math.max(...Array.from(values)));

describe("chroma", () => {
  it("puts a pure A440 on the A pitch class", () => {
    const { treble, tuningCents } = chromaFrames(mono(note(440, 2)), spansOf(2));
    expect(argmax(treble[0])).toBe(9);
    expect(treble[0][9]).toBeGreaterThan(0.5);
    expect(tuningCents).toBe(0);
  });

  it("corrects an A432 tuning: the note lands on A and the tuning reads about −32 cents", () => {
    const audio = mono(note(432, 2));
    const { treble, tuningCents } = chromaFrames(audio, spansOf(2));
    expect(tuningCents).toBeGreaterThanOrEqual(-36);
    expect(tuningCents).toBeLessThanOrEqual(-28);
    expect(argmax(treble[0])).toBe(9);
  });

  it("reads a low E1 (41 Hz) on the E pitch class of the bass chroma", () => {
    const harmony = mono(note(440, 2));
    const bass = mono(note(41.2, 2));
    const { bass: bassChroma } = chromaFrames(harmony, spansOf(2), bass);
    expect(bassChroma).not.toBeNull();
    expect(argmax(bassChroma![0])).toBe(4);
  });

  it("keeps the E of an A4 with an E5 as loud as the A, not lost between sampled bins", () => {
    // Above a few hundred hertz a log bin is wider than an FFT bin, so the peak of the E5 must not fall between two sampled points.
    const pair = Float32Array.from({ length: RATE * 2 }, (_, i) => 0.1 * (Math.sin((2 * Math.PI * 440 * i) / RATE) + Math.sin((2 * Math.PI * 659.255 * i) / RATE)));
    const { treble } = chromaFrames(mono(pair), spansOf(2));
    expect(treble[0][4]).toBeGreaterThan(0.35);
    expect(treble[0][9]).toBeGreaterThan(0.35);
  });

  it("does not light up the fifth of a harmonic-rich tone more than its root", () => {
    // A C3 with partials falling off as 1/k: the fifth only sounds from the third harmonic, so it must stay below the root.
    const partials = Array.from({ length: 8 }, (_, k) => 1 / (k + 1));
    const { treble } = chromaFrames(mono(note(130.81, 2, partials)), spansOf(2));
    expect(treble[0][0]).toBeGreaterThan(treble[0][7]);
    expect(argmax(treble[0])).toBe(0);
  });

  it("gives an all-zero chroma for silence and no tuning", () => {
    const { treble, bass, tuningCents } = chromaFrames(mono(new Float32Array(RATE * 2)), spansOf(2), mono(new Float32Array(RATE * 2)));
    expect(Array.from(treble[0]).every((v) => v === 0)).toBe(true);
    expect(Array.from(bass![0]).every((v) => v === 0)).toBe(true);
    expect(tuningCents).toBe(0);
  });

  it("normalises each non-silent span to a sum of one", () => {
    const { treble } = chromaFrames(mono(note(329.63, 2, [1, 0.5, 0.3])), spansOf(2));
    const sum = Array.from(treble[0]).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it("reads short spans through a window centred on the span, at least 0.4 s and at most the FFT size", () => {
    // 0.1 s asks for a 0.4 s window (17640 samples), which is over the 16384-sample FFT, so the window is the FFT size.
    const short = windowFor({ start: 1, end: 1.1 }, RATE, RATE * 3);
    expect(short).toEqual({ from: Math.round(1.05 * RATE) - 8192, size: 16384 });
    const clamped = windowFor({ start: 0, end: 0.1 }, RATE, 10000);
    expect(clamped).toEqual({ from: 0, size: 10000 });
  });

  it("estimates no tuning from too little material", () => {
    expect(estimateTuningCents(mono(new Float32Array(10)), [])).toBe(0);
  });
});
