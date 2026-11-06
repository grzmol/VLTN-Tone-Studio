import { describe, expect, it } from "vitest";
import type { PcmAudio, StemName, Stems } from "../types";
import { bassOf, buildAnalysisAudio, harmonyNameOf, harmonyOf, sectionBoundsOf } from "./analysis-audio";

const tone = (level = 0.5): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4410).fill(level)] });
const silence = (): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4410)] });
const input = { beatsPerBar: 4, chordChanges: [1.5] };

describe("buildAnalysisAudio", () => {
  it("analyses the mix when the song was not split", () => {
    const mix = tone();
    const audio = buildAnalysisAudio({ ...input, mix, stems: null, chordName: "" });
    expect(audio.sources).toEqual([mix]);
    expect(audio.chordSource).toBeNull();
    expect(audio.stems).toBeNull();
    expect(audio.sampleRate).toBe(44100);
    expect(audio.beatsPerBar).toBe(4);
    expect(audio.chordChanges).toEqual([1.5]);
  });

  it("tracks the beat from the drums when the song has them", () => {
    const drums = tone(0.3);
    const stems: Stems = { drums, guitar: tone(0.2) };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "" }).sources).toEqual([drums]);
  });

  it("keeps the song's own sections as bounds, so the key reads them", () => {
    const audio = buildAnalysisAudio({ ...input, mix: tone(), stems: null, chordName: "", sections: [{ start: 0, end: 8 }] });
    expect(audio.sections).toEqual([{ start: 0, end: 8 }]);
    expect(sectionBoundsOf([{ id: "a", name: "Verse", start: 2, end: 9, mode: "loop" }, "nonsense"])).toEqual([{ start: 2, end: 9 }]);
  });

  it("reads the chords from the chosen stem", () => {
    const guitar = tone(0.2);
    const stems: Stems = { guitar, other: tone(0.2) };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "guitar" }).chordSource).toEqual({ name: "guitar", audio: guitar });
  });

  it("gives no chord source when the chosen stem is not in the song", () => {
    const stems: Stems = { guitar: tone(0.2) };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "piano" }).chordSource).toBeNull();
  });

  it("reads the harmony from the performer's chord choice, and the bass from the bass stem", () => {
    const piano = tone(0.2);
    const bass = tone(0.3);
    const stems: Stems = { piano, bass, other: tone(0.1) };
    const audio = buildAnalysisAudio({ ...input, mix: tone(), stems, chordChoice: "piano", chordName: "piano" });
    expect(audio.harmony).toEqual({ name: "piano", audio: piano });
    expect(audio.bass).toBe(bass);
  });
});

describe("harmonyOf and bassOf", () => {
  const mix = tone(0.9);
  it("adds the harmony stems that have a signal, and names them", () => {
    const other = tone(0.1),
      piano = tone(0.2);
    const { name, audio } = harmonyOf({ other, piano, guitar: silence(), bass: tone(0.5) }, mix);
    expect(name).toBe("other+piano");
    expect(audio.channels[0][0]).toBeCloseTo(0.3, 6);
  });

  it("uses the one harmony stem with a signal as it is", () => {
    const guitar = tone(0.2);
    expect(harmonyOf({ guitar, drums: tone(0.5) }, mix)).toEqual({ name: "guitar", audio: guitar });
  });

  it("uses the chosen stem over the sum, when it has a signal", () => {
    const vocals = tone(0.4);
    expect(harmonyOf({ other: tone(0.1), vocals }, mix, "vocals")).toEqual({ name: "vocals", audio: vocals });
  });

  it("falls back to the sum when the chosen stem is silent", () => {
    expect(harmonyOf({ other: tone(0.1), vocals: silence() }, mix, "vocals").name).toBe("other");
  });

  it("uses the mix when no harmony stem has a signal", () => {
    expect(harmonyOf({ drums: tone(0.5) }, mix)).toEqual({ name: "mix", audio: mix });
    expect(harmonyOf(null, mix)).toEqual({ name: "mix", audio: mix });
  });

  it("names the harmony the same way without adding any audio together", () => {
    const cases: Array<[Parameters<typeof harmonyOf>[0], StemName | ""]> = [
      [{ other: tone(0.1), piano: tone(0.2), guitar: silence() }, ""],
      [{ guitar: tone(0.2), drums: tone(0.5) }, ""],
      [{ other: tone(0.1), vocals: tone(0.4) }, "vocals"],
      [{ other: tone(0.1), vocals: silence() }, "vocals"],
      [{ drums: tone(0.5) }, ""],
      [null, ""],
    ];
    for (const [stems, choice] of cases) expect(harmonyNameOf(stems, choice)).toBe(harmonyOf(stems, mix, choice).name);
  });

  it("gives the bass stem only when it has a signal", () => {
    const bass = tone(0.4);
    expect(bassOf({ bass })).toBe(bass);
    expect(bassOf({ bass: silence() })).toBeNull();
    expect(bassOf(null)).toBeNull();
  });
});
