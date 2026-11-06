import { describe, expect, it } from "vitest";
import { chordFrameSpans, detectChords, HOP_SECONDS } from "./chords";

it("rejects silence and recognises an opposite-phase stereo major chord", () => {
  const sampleRate = 44100;
  const channel = Float32Array.from({ length: sampleRate * 2 }, (_, i) =>
    [261.626, 329.628, 391.995].reduce((s, f) => s + 0.1 * Math.sin((2 * Math.PI * f * i) / sampleRate), 0),
  );
  const input = (harmony: { sampleRate: number; channels: Float32Array[] }) => ({ harmony, bass: null, beats: null });
  expect(detectChords(input({ sampleRate, channels: [new Float32Array(sampleRate)] }))[0].name).toBe("N");
  const stereo = detectChords(input({ sampleRate, channels: [channel, channel.map((n) => -n)] }));
  expect(stereo[0].name).toBe("C");
});

/** A chord of sine partials, for `seconds` at `rate`. Synthetic audio only. */
function chordSound(notes: number[], seconds: number, rate = 44100): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++)
    for (const hz of notes) out[i] += (0.1 * (Math.sin((2 * Math.PI * hz * i) / rate) + 0.5 * Math.sin((4 * Math.PI * hz * i) / rate))) / notes.length;
  return out;
}

describe("chord frames", () => {
  it("reads beat to beat, with the time before the first beat as its own span", () => {
    expect(chordFrameSpans([0.5, 1, 1.5], 2)).toEqual([
      { start: 0, end: 0.5 },
      { start: 0.5, end: 1 },
      { start: 1, end: 1.5 },
      { start: 1.5, end: 2 },
    ]);
  });

  it("falls back to fixed hops without a grid", () => {
    const spans = chordFrameSpans(null, 1);
    expect(spans).toHaveLength(1 / HOP_SECONDS);
    expect(spans[1].start).toBeCloseTo(HOP_SECONDS, 6);
  });

  it("changes the chord only on a beat when the song has a grid", () => {
    const rate = 44100;
    const c = chordSound([130.81, 164.81, 196], 2, rate),
      g = chordSound([196, 246.94, 293.66], 2, rate);
    const harmony = { sampleRate: rate, channels: [Float32Array.from([...c, ...g])] };
    const beats = Array.from({ length: 8 }, (_, i) => i * 0.5);
    expect(detectChords({ harmony, bass: null, beats }).map(({ name, time }) => [name, time])).toEqual([
      ["C", 0],
      ["G", 2],
    ]);
  });
});

it("names a I-V-vi-IV loop with no key given, so the key prior comes from the harmony itself", () => {
  const sampleRate = 22050,
    seconds = 2;
  const loop = [
    [55, 59, 62, 67],
    [62, 66, 69],
    [64, 67, 71],
    [60, 64, 67],
  ];
  const pcm = Float32Array.from({ length: loop.length * sampleRate * seconds }, (_, i) => {
    const notes = loop[Math.floor(i / (sampleRate * seconds))];
    return notes.reduce((sum, midi) => sum + 0.12 * Math.sin((2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * i) / sampleRate), 0);
  });
  const names = detectChords({ harmony: { sampleRate, channels: [pcm] }, bass: null, beats: null, key: null }).map((chord) => chord.name);
  expect(names).toEqual(["G", "D", "Em", "C"]);
});
