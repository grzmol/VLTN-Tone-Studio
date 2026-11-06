import { describe, expect, it } from "vitest";
import type { TrackInfo } from "../tracks";
import type { PcmAudio, Stems } from "../types";
import { stemsWithVocals, vocalsOf } from "./vocals";

const pcm = (n: number): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(n)] });
const user = (name: string): TrackInfo => ({ kind: "user", name });

describe("vocalsOf", () => {
  it("uses the split's vocals stem first", () => {
    const vocals = pcm(4);
    expect(vocalsOf({ vocals, drums: pcm(4) }, { a: user("Lead Vox") })).toBe(vocals);
  });

  it("uses a user track named like vocals when there is no vocals stem", () => {
    const lead = pcm(4);
    for (const name of ["Vocals", "vocal", "VOX", "Lead vocals", "lead  vox", " Vocal "]) {
      expect(vocalsOf({ bass: pcm(4), u1: lead }, { u1: user(name) })).toBe(lead);
    }
  });

  it("ignores a user track with another name, and a track of another kind", () => {
    expect(vocalsOf({ u1: pcm(4) }, { u1: user("Guitar") })).toBeNull();
    expect(vocalsOf({ s1: pcm(4) }, { s1: { kind: "stem", name: "Vocals" } as TrackInfo })).toBeNull();
    expect(vocalsOf({ u1: pcm(4) }, { u1: user("Backing vocals") })).toBeNull();
  });

  it("is null with no stems", () => {
    expect(vocalsOf(null, { u1: user("Vocals") })).toBeNull();
    expect(vocalsOf({} as Stems, {})).toBeNull();
  });
});

describe("stemsWithVocals", () => {
  it("adds the vocals to the stems a lyrics step reads, and keeps the rest", () => {
    const drums = pcm(4);
    const vocals = pcm(4);
    expect(stemsWithVocals({ drums }, vocals)).toEqual({ drums, vocals });
    expect(stemsWithVocals({ drums }, null)).toEqual({ drums });
  });
});
