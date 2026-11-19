import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import { fadesOut, fadesOutCached, keptOriginals } from "./fade-check";

const RATE = 100;
/** A steady track of `seconds` whose last `tailSeconds` play at `tailLevel` times the rest. */
function track(seconds: number, tailLevel = 1, tailSeconds = 0): PcmAudio {
  const data = new Float32Array(seconds * RATE).fill(0.5);
  data.fill(0.5 * tailLevel, (seconds - tailSeconds) * RATE);
  return { sampleRate: RATE, channels: [data, data] };
}

describe("fadesOut", () => {
  it("is false for a steady song", () => {
    expect(fadesOut([track(30)])).toBe(false);
  });

  it("is true when the last two seconds are far below the song", () => {
    expect(fadesOut([track(30, 0.01, 4)])).toBe(true);
  });

  it("is false for a modest dip", () => {
    expect(fadesOut([track(30, 0.5, 4)])).toBe(false);
  });

  it("is false for silence and for no audio", () => {
    expect(fadesOut([{ sampleRate: RATE, channels: [new Float32Array(3000)] }])).toBe(false);
    expect(fadesOut([])).toBe(false);
  });

  it("is false for audio shorter than four seconds", () => {
    expect(fadesOut([track(3, 0.01, 3)])).toBe(false);
  });

  it("mixes the tracks: a quiet one fading does not matter beside a steady one", () => {
    expect(fadesOut([track(30, 0.01, 4), track(30)])).toBe(false);
  });
});

describe("fadesOutCached", () => {
  it("answers the same audio without reading it again", () => {
    const audio = track(30, 0.01, 4);
    expect(fadesOutCached([audio])).toBe(true);
    audio.channels = [new Float32Array(3000).fill(0.5)];
    expect(fadesOutCached([audio])).toBe(true);
  });
});

describe("keptOriginals", () => {
  const [drums, bass, guitar, mix] = [track(5), track(5), track(5), track(5)];
  it("leaves out the drums and bass the band replaces", () => {
    expect(keptOriginals({ drums, bass, guitar }, mix)).toEqual([guitar]);
  });
  it("falls back to the mix when no other stem is there", () => {
    expect(keptOriginals({ drums, bass }, mix)).toEqual([mix]);
    expect(keptOriginals(null, undefined)).toEqual([]);
  });
});
