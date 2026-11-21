import { describe, expect, it } from "vitest";
import { warmBassTone } from "./builtin-bass-tone";
import type { PcmAudio } from "../types";

const RATE = 44100;
const sine = (hz: number, amplitude: number, seconds: number, start = 0, length = Math.round(RATE * (start + seconds))): Float32Array => {
  const out = new Float32Array(length);
  for (let i = Math.round(start * RATE); i < Math.min(length, Math.round((start + seconds) * RATE)); i++)
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
};
const mono = (channel: Float32Array): PcmAudio => ({ sampleRate: RATE, channels: [channel] });
const peak = (samples: Float32Array, from = 0, to = samples.length) => samples.slice(from, to).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const rms = (samples: Float32Array, from = 0, to = samples.length) =>
  Math.sqrt(samples.slice(from, to).reduce((sum, value) => sum + value * value, 0) / (to - from));
const crest = (samples: Float32Array) => peak(samples) / rms(samples);
const db = (ratio: number) => 20 * Math.log10(ratio);

describe("warmBassTone", () => {
  it("gives the same samples for the same audio", () => {
    const input = mono(sine(80, 0.5, 0.5));
    expect(warmBassTone(input).channels[0]).toEqual(warmBassTone(input).channels[0]);
  });

  it("keeps the rate, the channels and the length", () => {
    const input: PcmAudio = { sampleRate: RATE, channels: [sine(80, 0.3, 0.2), sine(90, 0.3, 0.2)] };
    const out = warmBassTone(input);
    expect(out.sampleRate).toBe(RATE);
    expect(out.channels).toHaveLength(2);
    expect(out.channels[0]).toHaveLength(input.channels[0].length);
  });

  it("brings a loud note down by about 6 dB more than a soft one, and leaves a soft note nearly alone", () => {
    // A soft note at -30 dBFS, then a loud one at -3 dBFS, an octave apart from the 400 Hz dip, both at 100 Hz.
    const soft = 10 ** (-30 / 20);
    const loud = 10 ** (-3 / 20);
    const input = sine(100, loud, 0.8, 1, RATE * 1.8);
    input.set(sine(100, soft, 0.8, 0, RATE * 0.8), 0);
    const out = warmBassTone(mono(input)).channels[0];
    const softGain = db(rms(out, RATE * 0.4, RATE * 0.8) / rms(input, RATE * 0.4, RATE * 0.8));
    const loudGain = db(rms(out, RATE * 1.4, RATE * 1.8) / rms(input, RATE * 1.4, RATE * 1.8));
    expect(Math.abs(softGain)).toBeLessThan(1);
    expect(softGain - loudGain).toBeGreaterThan(4);
    expect(softGain - loudGain).toBeLessThan(9);
  });

  it("reduces the crest factor of a loud and soft test signal", () => {
    const input = sine(100, 0.9, 0.5, 0, RATE);
    input.set(sine(100, 0.05, 0.5, 0, RATE * 0.5), RATE * 0.5);
    const out = warmBassTone(mono(input)).channels[0];
    // The first tenth of a second is left out: the compressor lets a note's attack through before it comes down on the note, which is
    // what keeps the attack, and it is the settled loud part and the soft part that the crest factor compares.
    const settled = (samples: Float32Array) => samples.slice(Math.round(RATE * 0.1));
    expect(crest(settled(out))).toBeLessThan(crest(settled(input)));
  });

  it("adds no latency: the attack of a step is there within a millisecond", () => {
    // A 2 kHz note that starts at once, soft enough that the compressor is not working. Its first millisecond already reaches most of the
    // level it settles at.
    const input = mono(sine(2000, 0.05, 0.2));
    const out = warmBassTone(input).channels[0];
    const first = peak(out, 0, Math.round(RATE * 0.001));
    const settled = peak(out, Math.round(RATE * 0.1), Math.round(RATE * 0.2));
    expect(first).toBeGreaterThan(0.5 * settled);
  });

  it("cuts below 35 Hz and above 4.5 kHz", () => {
    const rumble = warmBassTone(mono(sine(12, 0.2, 1))).channels[0];
    const hiss = warmBassTone(mono(sine(12000, 0.2, 1))).channels[0];
    const mid = warmBassTone(mono(sine(150, 0.05, 1))).channels[0];
    expect(rms(rumble, RATE / 2, RATE)).toBeLessThan(0.3 * rms(mid, RATE / 2, RATE) * 4);
    expect(rms(hiss, RATE / 2, RATE)).toBeLessThan(0.1 * 0.2);
  });

  it("dips 400 Hz against 150 Hz", () => {
    const at = (hz: number) => rms(warmBassTone(mono(sine(hz, 0.02, 1))).channels[0], RATE / 2, RATE) / rms(sine(hz, 0.02, 1), RATE / 2, RATE);
    expect(db(at(400)) - db(at(150))).toBeLessThan(-2);
  });
});
