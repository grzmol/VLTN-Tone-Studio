import { describe, expect, it } from "vitest";
import { brightSnare, CLICK_LEVEL, THUMP_HZ, THUMP_LEVEL, thumpKick } from "./kit-voicing";
import type { PcmAudio } from "../types";

const RATE = 44100;

/** The size of one frequency in a signal's first `frames` frames, by a single-bin Fourier sum. */
function magnitudeAt(channel: Float32Array, hz: number, frames = channel.length): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < frames; i++) {
    re += channel[i] * Math.cos((2 * Math.PI * hz * i) / RATE);
    im += channel[i] * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return Math.hypot(re, im) / frames;
}

const tone = (hz: number, frames: number, amplitude = 0.5): PcmAudio => {
  const channel = Float32Array.from({ length: frames }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE));
  return { sampleRate: RATE, channels: [channel, channel.slice()] };
};

describe("thumpKick", () => {
  it("adds a 60 Hz thump that the original does not have, at a share of the sample's peak", () => {
    const click = new Float32Array(4000);
    click[10] = 0.8;
    const kick: PcmAudio = { sampleRate: RATE, channels: [click, click.slice()] };
    const out = thumpKick(kick);
    expect(magnitudeAt(out.channels[0], THUMP_HZ, 4000)).toBeGreaterThan(magnitudeAt(click, THUMP_HZ, 4000) * 10);
    // The sine starts at zero and peaks about a quarter period in, so the largest thump sample is under THUMP_LEVEL of the peak.
    const body = out.channels[0].slice(100, 600);
    expect(Math.max(...body.map(Math.abs))).toBeLessThanOrEqual(0.8 * (THUMP_LEVEL + CLICK_LEVEL) + 1e-6);
    expect(Math.max(...body.map(Math.abs))).toBeGreaterThan(0.8 * THUMP_LEVEL * 0.5);
  });

  it("makes a short sample long enough to ring, keeps both channels, and is repeatable", () => {
    const out = thumpKick(tone(100, 500));
    expect(out.channels).toHaveLength(2);
    expect(out.channels[0].length).toBeGreaterThanOrEqual(Math.round(0.25 * RATE));
    expect(Array.from(thumpKick(tone(100, 500)).channels[1])).toEqual(Array.from(out.channels[1]));
  });

  it("adds nothing to silence", () => {
    const silent: PcmAudio = { sampleRate: RATE, channels: [new Float32Array(1000)] };
    expect(Math.max(...thumpKick(silent).channels[0].map(Math.abs))).toBe(0);
  });
});

describe("brightSnare", () => {
  it("raises the highs by about the shelf's gain and leaves the lows alone", () => {
    const high = tone(10000, 8000);
    const low = tone(200, 8000);
    const ratio = (before: PcmAudio, after: PcmAudio, hz: number): number => magnitudeAt(after.channels[0], hz) / magnitudeAt(before.channels[0], hz);
    expect(20 * Math.log10(ratio(high, brightSnare(high, 4), 10000))).toBeCloseTo(4, 0);
    expect(20 * Math.log10(ratio(low, brightSnare(low, 4), 200))).toBeCloseTo(0, 0);
  });

  it("keeps the length and channels", () => {
    const out = brightSnare(tone(1000, 300), 4);
    expect(out.channels).toHaveLength(2);
    expect(out.channels[0]).toHaveLength(300);
  });
});
