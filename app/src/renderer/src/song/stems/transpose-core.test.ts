// Runs the real Rubber Band WebAssembly build: the pitch really moves by the asked number of semitones, the length and
// the stereo balance stay, and silence stays silent.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { RubberBandInterface } from "rubberband-wasm";
import { detectPitch } from "@/screens/rig/tuner-pitch";
import { MAX_SEMITONES, pitchScale, shiftChannels } from "./transpose-core";

const SR = 44100;
let rb: RubberBandInterface;
beforeAll(async () => {
  const bytes = readFileSync(resolve("node_modules/rubberband-wasm/dist/rubberband.wasm"));
  rb = await RubberBandInterface.initialize(await WebAssembly.compile(bytes));
});

/** A plucked-guitar-ish tone: a few harmonics, 2 s. */
const tone = (hz: number, seconds = 2) =>
  Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => {
    const t = i / SR;
    return 0.4 * Math.sin(2 * Math.PI * hz * t) + 0.2 * Math.sin(2 * Math.PI * 2 * hz * t) + 0.1 * Math.sin(2 * Math.PI * 3 * hz * t);
  });
const middle = (x: Float32Array) => x.subarray(Math.floor(x.length / 2) - 2048, Math.floor(x.length / 2) + 2048);

describe("pitchScale", () => {
  it("is the equal-tempered ratio", () => {
    expect(pitchScale(12)).toBeCloseTo(2, 12);
    expect(pitchScale(-12)).toBeCloseTo(0.5, 12);
    expect(pitchScale(0)).toBe(1);
    expect(MAX_SEMITONES).toBe(12);
  });
});

describe("shiftChannels", () => {
  it.each([[-2], [-1], [3], [12]])("moves a tone by %i semitones", (st) => {
    const hz = 220;
    const [out] = shiftChannels(rb, [tone(hz)], SR, st);
    const found = detectPitch(middle(out), SR)!;
    // within a quarter of a semitone of where it should be
    expect(Math.abs(12 * Math.log2(found / (hz * pitchScale(st))))).toBeLessThan(0.25);
  }, 30_000);

  it("keeps the length and each channel's own balance", () => {
    const left = tone(196);
    const right = left.map((v) => v * 0.25);
    const [l, r] = shiftChannels(rb, [left, right], SR, -2);
    expect(l.length).toBe(left.length);
    expect(r.length).toBe(right.length);
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    expect(rms(r) / rms(l)).toBeGreaterThan(0.2);
    expect(rms(r) / rms(l)).toBeLessThan(0.3);
  }, 30_000);

  it("returns a copy at zero and silence for silence", () => {
    const x = tone(330, 0.5);
    const [same] = shiftChannels(rb, [x], SR, 0);
    expect(same).not.toBe(x);
    expect(Array.from(same.slice(0, 8))).toEqual(Array.from(x.slice(0, 8)));
    const [quiet] = shiftChannels(rb, [new Float32Array(SR)], SR, 5);
    expect(Math.max(...quiet.map(Math.abs))).toBeLessThan(1e-4);
  }, 30_000);

  it("reports progress up to 1", () => {
    const seen: number[] = [];
    shiftChannels(rb, [tone(220, 0.5)], SR, -1, (f) => seen.push(f));
    expect(seen.at(-1)).toBeCloseTo(1, 5);
    expect(seen.every((f, i) => i === 0 || f >= seen[i - 1])).toBe(true);
  }, 30_000);
});
