import { describe, expect, it } from "vitest";
import { silenceEnds } from "./silence";

const RATE = 1000;
/** A mono clip where `sound` gives each sample; a window is 50 frames at this rate. */
function clip(seconds: number, sound: (t: number) => number) {
  const channel = Float32Array.from({ length: seconds * RATE }, (_, i) => sound(i / RATE));
  return { sampleRate: RATE, channels: [channel] };
}
const tone = (from: number, to: number) => (t: number) => (t >= from && t < to ? 0.5 : 0);

describe("silenceEnds", () => {
  it("finds the silence before the first sound and after the last", () => {
    const ends = silenceEnds(clip(10, tone(0.8, 6.8)));
    expect(ends?.start).toBeCloseTo(0.8);
    expect(ends?.end).toBeCloseTo(6.8);
  });

  it("ignores silence shorter than a quarter of a second", () => {
    expect(silenceEnds(clip(10, tone(0.1, 9.9)))).toEqual({ start: 0, end: 10 });
  });

  it("reports nothing at a song that is silent throughout", () => {
    expect(silenceEnds(clip(5, () => 0))).toBeNull();
  });

  it("treats a sound quieter than the level as silence", () => {
    expect(silenceEnds(clip(4, () => 0.001))).toBeNull();
  });

  it("uses the loudest channel, so one sounding channel is enough", () => {
    const left = clip(4, tone(1, 3)).channels[0];
    const right = new Float32Array(left.length);
    expect(silenceEnds({ sampleRate: RATE, channels: [new Float32Array(left.length), right] })).toBeNull();
    const ends = silenceEnds({ sampleRate: RATE, channels: [new Float32Array(left.length), left] });
    expect(ends?.start).toBeCloseTo(1);
    expect(ends?.end).toBeCloseTo(3);
  });
});
