import { describe, expect, it } from "vitest";
import type { Section } from "../performance/sections";
import type { PcmAudio, Stems } from "../types";
import { detectMissingParts } from "./detect";

const RATE = 44100;
const SECONDS = 4;
const LENGTH = RATE * SECONDS;

/** Deterministic white noise, so a failing test reproduces the same audio. */
function noise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state / 2 ** 32) * 2 - 1;
  }
  return out;
}

const mix: PcmAudio = { sampleRate: RATE, channels: [noise(LENGTH, 1), noise(LENGTH, 2)] };

/** A copy of `audio` at `db` decibels relative to the mix (the mix's own level is 0 dB). */
function at(audio: PcmAudio, db: number): PcmAudio {
  const gain = 10 ** (db / 20);
  return { sampleRate: audio.sampleRate, channels: audio.channels.map((channel) => channel.map((x) => x * gain)) };
}

const intro: Section = { id: "intro", name: "Intro", start: 0, end: 2, mode: "continue" };
const verse: Section = { id: "verse", name: "Verse", start: 2, end: 4, mode: "continue" };

describe("detectMissingParts", () => {
  it("calls a bass 36 dB below the mix absent, and keeps the drums present", () => {
    const stems: Stems = { drums: at(mix, -20), bass: at(mix, -60) };
    expect(detectMissingParts(mix, stems)).toMatchObject({ drums: "present", bass: "absent", absentSections: { drums: [], bass: [] } });
  });

  it("calls a stem 36 dB below the mix absent, but one 34 dB below present (Demucs leakage)", () => {
    expect(detectMissingParts(mix, { drums: at(mix, -20), bass: at(mix, -36) }).bass).toBe("absent");
    expect(detectMissingParts(mix, { drums: at(mix, -20), bass: at(mix, -34) }).bass).toBe("present");
    expect(detectMissingParts(mix, { drums: at(mix, -34), bass: at(mix, -20) }).drums).toBe("present");
  });

  it("reports drums partial when they are absent from one section only", () => {
    const drums = at(mix, -20);
    for (const channel of drums.channels) channel.fill(0, 0, intro.end * RATE);
    const stems: Stems = { drums, bass: at(mix, -20) };
    expect(detectMissingParts(mix, stems, [intro, verse])).toEqual({
      drums: "partial",
      bass: "present",
      absentSections: { drums: ["intro"], bass: [] },
    });
  });

  it("reports unknown when the split has no drums stem", () => {
    expect(detectMissingParts(mix, { bass: at(mix, -20) })).toEqual({
      drums: "unknown",
      bass: "present",
      absentSections: { drums: [], bass: [] },
    });
  });

  it("reports present for both parts of a silent mix, since nothing is loud enough to judge", () => {
    const silent: PcmAudio = { sampleRate: RATE, channels: [new Float32Array(LENGTH), new Float32Array(LENGTH)] };
    const stems: Stems = { drums: silent, bass: silent };
    expect(detectMissingParts(silent, stems, [intro, verse])).toEqual({
      drums: "present",
      bass: "present",
      absentSections: { drums: [], bass: [] },
    });
  });

  it("compares a mono stem with a stereo mix", () => {
    const monoBass: PcmAudio = { sampleRate: RATE, channels: [at(mix, -60).channels[0]] };
    const monoDrums: PcmAudio = { sampleRate: RATE, channels: [at(mix, -20).channels[0]] };
    expect(detectMissingParts(mix, { drums: monoDrums, bass: monoBass })).toMatchObject({ drums: "present", bass: "absent" });
  });
});
