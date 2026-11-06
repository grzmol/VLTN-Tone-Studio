import { describe, expect, it } from "vitest";
import { combinedProfile, evidenceIn, keyFramesOf, parseChordRoot, type KeyEvidence, type KeyFrames } from "./key-evidence";
import type { PcmAudio } from "../types";

/** A pure tone at the given pitch class (in A440 terms) and octave, sampled at 22050 Hz. */
function tone(midi: number, seconds: number): PcmAudio {
  const sampleRate = 22050;
  const pcm = Float32Array.from({ length: sampleRate * seconds }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * i) / sampleRate));
  return { sampleRate, channels: [pcm] };
}

const silence = (seconds: number): PcmAudio => ({ sampleRate: 22050, channels: [new Float32Array(22050 * seconds)] });

describe("parseChordRoot", () => {
  it("reads the root and the chord type, and drops the slash bass", () => {
    expect(parseChordRoot("G")).toMatchObject({ root: 7, type: { suffix: "" } });
    expect(parseChordRoot("Em")).toMatchObject({ root: 4, type: { suffix: "m" } });
    expect(parseChordRoot("Bb7")).toMatchObject({ root: 10, type: { suffix: "7" } });
    expect(parseChordRoot("Ab")).toMatchObject({ root: 8 });
    expect(parseChordRoot("F#m7/C#")).toMatchObject({ root: 6, type: { suffix: "m7" } });
  });

  it("gives null for N and for names it does not know", () => {
    expect(parseChordRoot("N")).toBeNull();
    expect(parseChordRoot("Xm")).toBeNull();
    expect(parseChordRoot("G13")).toBeNull();
  });
});

describe("keyFramesOf", () => {
  it("reads one frame per two seconds, with the tone's pitch class at the top", () => {
    const frames = keyFramesOf(tone(69, 4), null, [], []);
    expect(frames.frames).toHaveLength(2);
    const top = Array.from(frames.frames[0].treble).indexOf(Math.max(...frames.frames[0].treble));
    expect(top).toBe(9);
    expect(frames.frames[0].bass).toBeNull();
  });

  it("marks the first and last chords and the chords that end a section as anchors", () => {
    const chords = [
      { time: 0, name: "G", confidence: 1 },
      { time: 2, name: "D", confidence: 1 },
      { time: 4, name: "Em", confidence: 1 },
      { time: 6, name: "C", confidence: 1 },
    ];
    // The section ends at 4 s, where D stops and Em starts.
    const keyFrames = keyFramesOf(silence(8), null, chords, [4]);
    expect(keyFrames.chords.map((chord) => chord.anchor)).toEqual([true, true, false, true]);
  });
});

describe("evidenceIn", () => {
  const runs: KeyFrames = {
    frames: [],
    chords: [
      { start: 0, end: 2, root: 7, quality: "major", tones: [0, 4, 7], anchor: true },
      { start: 2, end: 4, root: 2, quality: "major", tones: [0, 4, 7], anchor: false },
    ],
  };

  it("weights the chord tones with the root counted twice, and the chords by how long they last", () => {
    // Over the first two seconds only G is sounding. Its root (7) counts twice as much as its third (11) or fifth (2).
    const profile = evidenceIn(runs, 0, 2).chordTones!;
    expect(profile[7]).toBeCloseTo(0.5);
    expect(profile[11]).toBeCloseTo(0.25);
    expect(profile[2]).toBeCloseTo(0.25);
    expect(profile.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // Over the whole four seconds G (an anchor) and D (the last chord, also an anchor) weigh the same, so D's root carries the most.
    const whole = evidenceIn(runs, 0, 4).chordTones!;
    expect(whole.indexOf(Math.max(...whole))).toBe(2);
  });

  it("anchors the first and last chord of the window, whatever the song marks", () => {
    const evidence = evidenceIn(runs, 2, 4);
    expect(evidence.runs).toEqual([{ root: 2, quality: "major", tones: [0, 4, 7], seconds: 2, anchor: true }]);
  });

  it("has no chroma or chord evidence for a window with nothing in it", () => {
    const evidence = evidenceIn({ frames: [], chords: [] }, 0, 4);
    expect(evidence.chordTones).toBeNull();
    expect(evidence.bass).toBeNull();
  });
});

describe("combinedProfile", () => {
  const C: Float64Array = Float64Array.from({ length: 12 }, (_, i) => (i === 0 ? 1 : 0));
  const A: Float64Array = Float64Array.from({ length: 12 }, (_, i) => (i === 9 ? 1 : 0));

  it("mixes the sources with the weights, scaling the weights that are present to sum to one", () => {
    const evidence: KeyEvidence = { chroma: C, bass: A, chordTones: null, runs: [] };
    const profile = combinedProfile(evidence)!;
    // Chroma 0.5 and bass 0.2 with no chords: scaled to 0.5 / 0.7 and 0.2 / 0.7.
    expect(profile[0]).toBeCloseTo(0.5 / 0.7);
    expect(profile[9]).toBeCloseTo(0.2 / 0.7);
    expect(profile.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("is null when no source has any weight", () => {
    expect(combinedProfile({ chroma: new Float64Array(12), bass: null, chordTones: null, runs: [] })).toBeNull();
  });
});
