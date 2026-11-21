import { describe, expect, it } from "vitest";
import { decodeFlac } from "@shared/flac";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDER_RATE } from "./render";
import { addRoom, convolveStereo, ROOM_HIGH_PASS_HZ } from "./room";
import type { PcmAudio } from "../types";

const ROOM_FILE = join(dirname(fileURLToPath(import.meta.url)), "samples", "room", "drum-room.flac");

/** The same result as the FFT, the slow way. */
function direct(signal: Float32Array, impulse: Float32Array): Float32Array {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) for (let k = 0; k < impulse.length && k <= i; k++) out[i] += signal[i - k] * impulse[k];
  return out;
}

/** A repeatable stand-in for noise, so the tests need no random numbers. */
const wave = (length: number, step: number): Float32Array => Float32Array.from({ length }, (_, i) => Math.sin(i * step) * Math.cos(i * step * 0.37));

describe("the room impulse response", () => {
  it("is a short 44.1 kHz stereo file whose peak is in its first 2 ms", async () => {
    const ir = await decodeFlac(new Uint8Array(readFileSync(ROOM_FILE)));
    expect(ir.sampleRate).toBe(RENDER_RATE);
    expect(ir.channels).toHaveLength(2);
    expect(ir.channels[0].length / ir.sampleRate).toBeGreaterThanOrEqual(0.4);
    expect(ir.channels[0].length / ir.sampleRate).toBeLessThanOrEqual(0.6);
    for (const channel of ir.channels) {
      let peakAt = 0;
      for (let i = 0; i < channel.length; i++) if (Math.abs(channel[i]) > Math.abs(channel[peakAt])) peakAt = i;
      expect(peakAt / ir.sampleRate).toBeLessThan(0.002);
    }
  });
});

describe("convolveStereo", () => {
  it("matches direct convolution on each channel, across more than one block", () => {
    const left = wave(150000, 0.011);
    const right = wave(150000, 0.017);
    const irLeft = wave(300, 0.05);
    const irRight = wave(250, 0.09);
    const [outLeft, outRight] = convolveStereo([left, right], [irLeft, irRight]);
    const wantLeft = direct(left.subarray(0, 3000), irLeft);
    const wantRight = direct(right.subarray(0, 3000), irRight);
    for (let i = 0; i < 3000; i += 7) {
      expect(outLeft[i]).toBeCloseTo(wantLeft[i], 3);
      expect(outRight[i]).toBeCloseTo(wantRight[i], 3);
    }
    // Past the first block's edge (65536 - 300 + 1 frames per block) the tail of one block must join the next.
    const edge = 65536 - 300 + 1;
    const around = direct(left.subarray(edge - 400, edge + 400), irLeft);
    for (let i = 300; i < 800; i += 11) expect(outLeft[edge - 400 + i]).toBeCloseTo(around[i], 3);
  });
});

describe("addRoom", () => {
  const lone = (frames: number): PcmAudio => {
    const channel = new Float32Array(frames);
    channel[1000] = 1;
    return { sampleRate: RENDER_RATE, channels: [channel, channel.slice()] };
  };
  const tail = (): PcmAudio => {
    const channel = new Float32Array(20000);
    channel[0] = 0.5;
    channel[5000] = 0.4;
    return { sampleRate: RENDER_RATE, channels: [channel, channel.slice()] };
  };

  it("returns the drums unchanged at amount 0 or without a room", () => {
    const drums = lone(30000);
    expect(addRoom(drums, tail(), 0)).toBe(drums);
    expect(addRoom(drums, undefined, 0.5)).toBe(drums);
  });

  it("adds the room's tail after a lone hit, scaled by the amount", () => {
    const drums = lone(30000);
    const quarter = addRoom(drums, tail(), 0.25).channels[0];
    const half = addRoom(drums, tail(), 0.5).channels[0];
    expect(quarter).toHaveLength(30000);
    // The reflection 5000 frames after the hit: the high-pass leaves most of a click this narrow.
    const echo = quarter[6000];
    expect(Math.abs(echo)).toBeGreaterThan(0.05);
    expect(half[6000]).toBeCloseTo(echo * 2, 5);
    expect(drums.channels[0][6000]).toBe(0);
  });

  it("high-passes the wet signal, so a steady offset in the drums gets no room", () => {
    const steady: PcmAudio = { sampleRate: RENDER_RATE, channels: [new Float32Array(40000).fill(0.3), new Float32Array(40000).fill(0.3)] };
    const out = addRoom(steady, tail(), 1).channels[0];
    // Dry 0.3 plus a wet signal that has decayed to near zero (cut-off ROOM_HIGH_PASS_HZ, about a 47 ms time constant at 150 Hz).
    expect(ROOM_HIGH_PASS_HZ).toBe(150);
    expect(out[39999]).toBeCloseTo(0.3, 2);
  });

  it("takes a mono part as two equal channels", () => {
    const mono: PcmAudio = { sampleRate: RENDER_RATE, channels: [lone(30000).channels[0]] };
    const out = addRoom(mono, tail(), 0.25);
    expect(out.channels).toHaveLength(2);
    for (let i = 0; i < 30000; i += 13) expect(out.channels[1][i]).toBeCloseTo(out.channels[0][i], 6);
  });
});
