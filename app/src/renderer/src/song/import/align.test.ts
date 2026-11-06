import { describe, expect, it } from "vitest";
import { alignChannels, alignPcm, mixDown, stereoOf } from "./align";

const ramp = (length: number, value = 0.5) => Float32Array.from({ length }, () => value);

describe("aligning imported tracks", () => {
  it("pads a short track with silence at its end", () => {
    const [out] = alignChannels([Float32Array.from([1, 2])], 4);
    expect(Array.from(out)).toEqual([1, 2, 0, 0]);
  });

  it("cuts a long track to the song's length", () => {
    const [out] = alignChannels([Float32Array.from([1, 2, 3, 4])], 2);
    expect(Array.from(out)).toEqual([1, 2]);
  });

  it("returns the same arrays when the length already matches", () => {
    const channel = ramp(3);
    expect(alignChannels([channel], 3)[0]).toBe(channel);
  });

  it("copies a mono track to both channels", () => {
    const [left, right] = stereoOf([Float32Array.from([0.25])]);
    expect(left[0]).toBe(0.25);
    expect(right[0]).toBe(0.25);
    expect(left).not.toBe(right);
  });

  it("keeps the first two channels of a multichannel file", () => {
    const [a, b] = [ramp(2, 1), ramp(2, 2)];
    const [left, right] = stereoOf([a, b, ramp(2, 3)]);
    expect(left).toBe(a);
    expect(right).toBe(b);
  });

  it("aligns a stereo PCM to a frame count", () => {
    const pcm = alignPcm({ sampleRate: 44100, channels: [ramp(2)] }, 3);
    expect(pcm.sampleRate).toBe(44100);
    expect(pcm.channels.map((c) => c.length)).toEqual([3, 3]);
  });
});

describe("mixing tracks down to a source", () => {
  it("sums tracks sample by sample, padding the short ones", () => {
    const mono = Float32Array.from([0.5, 0.5, 0.5]);
    const stereo = [Float32Array.from([0.25, 0.25]), Float32Array.from([0.25, 0.25])];
    const [left, right] = mixDown([[mono], stereo], 3);
    expect(Array.from(left)).toEqual([0.75, 0.75, 0.5]);
    expect(Array.from(right)).toEqual([0.75, 0.75, 0.5]);
  });

  it("returns silence for no tracks", () => {
    const [left] = mixDown([], 4);
    expect(Array.from(left)).toEqual([0, 0, 0, 0]);
  });
});
