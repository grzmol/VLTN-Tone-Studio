import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import { BASS_LINE_CONFIDENT, bassLineOf, pitchClassOfMidi, smoothBassLine, withSecondOpinion, yinPitch } from "./bass-line";

const RATE = 44100;
const BEAT = 0.5;

/** A bass note: a sine at `hz` with its second and third harmonics, decaying from its start. */
function plucked(hz: number, seconds: number, rate = RATE): number[] {
  return Array.from({ length: Math.round(seconds * rate) }, (_, i) => {
    const t = i / rate;
    const decay = Math.exp(-3 * t);
    return decay * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * 2 * hz * t) + 0.25 * Math.sin(2 * Math.PI * 3 * hz * t));
  });
}

/** A stem with one note per beat (null is a rest), each beat `BEAT` seconds long from time 0. */
function stemOf(notes: (number | null)[], rate = RATE): PcmAudio {
  const out = new Float32Array(Math.round(notes.length * BEAT * rate));
  notes.forEach((hz, beat) => {
    if (hz === null) return;
    const start = Math.round(beat * BEAT * rate);
    plucked(hz, BEAT, rate).forEach((sample, i) => {
      if (start + i < out.length) out[start + i] += 0.5 * sample;
    });
  });
  return { sampleRate: rate, channels: [out] };
}

const beatTimes = (count: number) => Array.from({ length: count }, (_, i) => i * BEAT);

describe("pitchClassOfMidi", () => {
  it("gives the pitch class of a MIDI note, with the octave removed", () => {
    expect(pitchClassOfMidi(45)).toBe(9); // A2
    expect(pitchClassOfMidi(40)).toBe(4); // E2
    expect(pitchClassOfMidi(48)).toBe(0); // C3
    expect(pitchClassOfMidi(44.6)).toBe(9);
  });
});

describe("yinPitch", () => {
  it("finds the frequency of a plain sine", () => {
    const frame = Float32Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * 110 * i) / 11025));
    const pitch = yinPitch(frame, 11025);
    expect(pitch?.hz).toBeCloseTo(110, 0);
    expect(pitch?.aperiodicity).toBeLessThan(0.1);
  });

  it("finds nothing in silence", () => {
    expect(yinPitch(new Float32Array(2048), 11025)).toBeNull();
  });
});

describe("bassLineOf", () => {
  it("reads the pitch class of each beat's note, from a bass with harmonics", () => {
    // A2, E2, C3, G2, F#2, D2 (110, 82.41, 130.81, 98, 92.5, 73.42 Hz), repeated.
    const hz = [110, 82.41, 130.81, 98, 92.5, 73.42];
    const expected = [9, 4, 0, 7, 6, 2];
    const notes = Array.from({ length: 12 }, (_, i) => hz[i % hz.length]);
    const line = bassLineOf(stemOf(notes), beatTimes(notes.length)).beats;
    expect(line.map((entry) => entry.pc)).toEqual(notes.map((_, i) => expected[i % expected.length]));
    for (const entry of line) expect(entry.confidence).toBeGreaterThanOrEqual(BASS_LINE_CONFIDENT);
  });

  it("gives null with no confidence on a beat of silence", () => {
    const notes: (number | null)[] = [110, 110, null, 110, 110];
    const line = bassLineOf(stemOf(notes), beatTimes(notes.length)).beats;
    expect(line[2]).toEqual({ beat: 2, pc: null, confidence: 0 });
    expect(line[0].pc).toBe(9);
  });

  it("reads a beat as unclear when the stem is noise, not a note", () => {
    let seed = 7;
    const noise = Float32Array.from({ length: 8 * BEAT * RATE }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff - 0.5) * 0.4;
    });
    const line = bassLineOf({ sampleRate: RATE, channels: [noise] }, beatTimes(8)).beats;
    for (const entry of line) expect(entry.confidence < BASS_LINE_CONFIDENT || entry.pc === null).toBe(true);
  });

  it("gives one entry per beat, with the last beat read over the length of the beat before it", () => {
    const notes = [110, 110, 110];
    const line = bassLineOf(stemOf(notes), beatTimes(notes.length)).beats;
    expect(line.map((entry) => entry.beat)).toEqual([0, 1, 2]);
    expect(line[2].pc).toBe(9);
  });

  it("works at 11 kHz as well as 44.1 kHz", () => {
    const notes = [110, 82.41, 130.81, 98];
    const line = bassLineOf(stemOf(notes, 11025), beatTimes(notes.length)).beats;
    expect(line.map((entry) => entry.pc)).toEqual([9, 4, 0, 7]);
  });

  it("gives an empty line for no beats", () => {
    expect(bassLineOf(stemOf([110]), []).beats).toEqual([]);
  });
});

describe("smoothBassLine", () => {
  const read = (pc: number | null, confidence = 1, sounding = true) => ({ pc, confidence, sounding });

  it("takes the note of two equal neighbours for a single different beat between them", () => {
    const out = smoothBassLine([read(4), read(9, 0.9), read(4)]);
    expect(out[1].pc).toBe(4);
    // The smoothed beat keeps 0.8 of the lower neighbour's confidence, not its own.
    expect(out[1].confidence).toBeCloseTo(0.8, 5);
  });

  it("keeps a beat whose neighbours differ, and a beat at either end", () => {
    expect(smoothBassLine([read(4), read(9), read(7)]).map((entry) => entry.pc)).toEqual([4, 9, 7]);
    expect(smoothBassLine([read(9), read(4), read(9)])[0].pc).toBe(9);
  });

  it("gives a sounding beat with no clear pitch the previous beat's note, at a lower confidence", () => {
    const out = smoothBassLine([read(9, 1), read(null, 0, true), read(null, 0, true)]);
    expect(out[1].pc).toBe(9);
    expect(out[1].confidence).toBeCloseTo(0.8, 5);
    expect(out[2].pc).toBe(9);
    expect(out[2].confidence).toBeCloseTo(0.64, 5);
  });

  it("leaves a quiet beat null", () => {
    expect(smoothBassLine([read(9, 1), read(null, 0, false)])[1]).toEqual({ pc: null, confidence: 0 });
  });
});

/** A stem with one note per beat, each note a set of harmonics with the given amplitudes (index 0 is the fundamental). */
function stemWithHarmonics(notes: (number | null)[], amplitudes: number[], centsOff = 0): PcmAudio {
  const out = new Float32Array(Math.round(notes.length * BEAT * RATE));
  notes.forEach((hz, beat) => {
    if (hz === null) return;
    const tuned = hz * 2 ** (centsOff / 1200);
    const start = Math.round(beat * BEAT * RATE);
    for (let i = 0; i < BEAT * RATE && start + i < out.length; i++) {
      const t = i / RATE;
      let sample = 0;
      amplitudes.forEach((amp, h) => (sample += amp * Math.sin(2 * Math.PI * tuned * (h + 1) * t)));
      out[start + i] += (0.3 * Math.exp(-2 * t) * sample) / amplitudes.length;
    }
  });
  return { sampleRate: RATE, channels: [out] };
}

describe("tuning and harmonic summation", () => {
  it("reads the right classes from a stem 40 cents flat, and finds the tuning", () => {
    // A2, E2, C3, G2 (110, 82.41, 130.81, 98 Hz), each played 40 cents flat.
    const notes = [110, 82.41, 130.81, 98, 110, 82.41, 130.81, 98];
    const line = bassLineOf(stemWithHarmonics(notes, [1, 0.5, 0.25], -40), beatTimes(notes.length));
    expect(line.beats.map((entry) => entry.pc)).toEqual([9, 4, 0, 7, 9, 4, 0, 7]);
    expect(line.tuningCents).toBeGreaterThanOrEqual(-46);
    expect(line.tuningCents).toBeLessThanOrEqual(-34);
  });

  it("reads the fundamental's class when the second harmonic is louder than the fundamental, as in a bass", () => {
    const notes = [110, 110, 110, 110];
    const line = bassLineOf(stemWithHarmonics(notes, [0.3, 1, 0.4, 0.2]), beatTimes(notes.length));
    expect(line.beats.map((entry) => entry.pc)).toEqual([9, 9, 9, 9]);
  });

  it("keeps the tuning at zero for a stem in tune", () => {
    const notes = [110, 82.41, 130.81, 98];
    const line = bassLineOf(stemWithHarmonics(notes, [1, 0.5, 0.25]), beatTimes(notes.length));
    expect(Math.abs(line.tuningCents)).toBeLessThanOrEqual(5);
  });
});

describe("withSecondOpinion", () => {
  it("adds 0.2 when YIN agrees with the reading, capped at 1", () => {
    expect(withSecondOpinion(0.5, 9, 9)).toBeCloseTo(0.7, 5);
    expect(withSecondOpinion(0.95, 9, 9)).toBe(1);
  });

  it("changes nothing when YIN disagrees or has no reading", () => {
    expect(withSecondOpinion(0.5, 9, 4)).toBe(0.5);
    expect(withSecondOpinion(0.5, 9, null)).toBe(0.5);
  });
});
