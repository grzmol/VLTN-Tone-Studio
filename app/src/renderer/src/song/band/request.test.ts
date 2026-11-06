import { describe, expect, it } from "vitest";
import type { Cue } from "../performance/chart";
import type { Section } from "../performance/sections";
import type { PcmAudio } from "../types";
import { DEFAULT_BAND_SETTINGS } from "./arrangement";
import type { BandResult } from "./band-job";
import { fixedBeatGrid } from "./beat-grid";
import { bandHarmony, bandRequest, beatSources, levelStems, previewMix, sumAudio } from "./request";

const audio = (values: number[], rate = 44100): PcmAudio => ({ sampleRate: rate, channels: [Float32Array.from(values)] });

describe("beatSources", () => {
  const mix = audio([0.5]);
  it("reads the drums stem when there is one", () => {
    const drums = audio([0.1]);
    expect(beatSources({ drums, other: audio([0.2]) }, mix)).toEqual([drums]);
  });
  it("otherwise reads the pitched stems, leaving out voices", () => {
    const other = audio([0.2]),
      bass = audio([0.3]);
    expect(beatSources({ vocals: audio([0.4]), other, bass }, mix)).toEqual([other, bass]);
  });
  it("otherwise reads the song's mix", () => {
    expect(beatSources(null, mix)).toEqual([mix]);
    expect(beatSources({ vocals: audio([0.4]) }, mix)).toEqual([mix]);
  });
});

describe("bandHarmony", () => {
  const grid = fixedBeatGrid(120, 0, 4, 8);
  const cues: Cue[] = [{ time: 0, text: "[Am] [G]", messages: [] }];
  const bassLine = Array.from({ length: grid.beats.length }, (_, beat) => ({ beat, pc: 4, confidence: 1 }));

  it("takes the original bass where the settings say so", () => {
    const harmony = bandHarmony({ grid, cues, chords: [], songEnd: 8, settings: DEFAULT_BAND_SETTINGS, bassLine });
    expect(harmony[0].chord).toMatchObject({ name: "Am", bass: 4 });
  });

  it("keeps the chords' own bass when the settings say chords, even with a bass line", () => {
    const settings = { ...DEFAULT_BAND_SETTINGS, bassFrom: "chords" as const };
    const harmony = bandHarmony({ grid, cues, chords: [], songEnd: 8, settings, bassLine });
    expect(harmony[0].chord).toMatchObject({ name: "Am", bass: 9 });
  });

  it("is the same as the request's harmony", () => {
    const request = bandRequest({
      grid,
      cues,
      chords: [],
      sections: [],
      settings: DEFAULT_BAND_SETTINGS,
      songEnd: 8,
      lengthFrames: 8 * 44100,
      sampleUrls: {},
      bassLine,
    });
    expect(request.harmony).toEqual(bandHarmony({ grid, cues, chords: [], songEnd: 8, settings: DEFAULT_BAND_SETTINGS, bassLine }));
  });
});

describe("bandRequest", () => {
  it("takes the harmony from the chart's chords and the plans from the sections", () => {
    const grid = fixedBeatGrid(120, 0, 4, 8);
    const cues: Cue[] = [{ time: 0, text: "[Am] [G]", messages: [] }];
    const sections: Section[] = [{ id: "v", name: "Verse", start: 0, end: 4, mode: "continue" }];
    const request = bandRequest({ grid, cues, chords: [], sections, settings: DEFAULT_BAND_SETTINGS, songEnd: 8, lengthFrames: 8 * 44100, sampleUrls: {} });
    expect(request.harmony).toHaveLength(grid.beats.length);
    expect(request.harmony[0].chord?.name).toBe("Am");
    expect(request.plans.map((plan) => plan.sectionId)).toEqual(["v"]);
    expect(request.seed).toBe(DEFAULT_BAND_SETTINGS.seed);
    expect(request.parts).toEqual({ drums: true, bass: true });
  });

  it("sends the song's mix and the split's original stems for the level match, with or without follow", () => {
    const grid = fixedBeatGrid(120, 0, 4, 8);
    const mix = audio([0.5]);
    const originals = levelStems({ drums: audio([0.2]), bass: audio([0.1]), guitar: audio([0.3]) });
    const request = bandRequest({
      grid,
      cues: [],
      chords: [],
      sections: [],
      settings: DEFAULT_BAND_SETTINGS,
      songEnd: 8,
      lengthFrames: 8 * 44100,
      sampleUrls: {},
      mix,
      originals,
    });
    expect(request.mix).toBe(mix);
    expect(request.originals?.bass?.channels[0][0]).toBeCloseTo(0.1);
    expect(request.follow).toBeUndefined();
  });
});

describe("levelStems", () => {
  it("takes the original drums and bass, and nothing else", () => {
    const drums = audio([0.2]);
    const bass = audio([0.1]);
    expect(levelStems({ drums, bass, guitar: audio([0.3]) })).toEqual({ drums, bass });
  });

  it("gives no stems when the song has no split", () => {
    expect(levelStems(null)).toEqual({ drums: undefined, bass: undefined });
  });
});

describe("previewMix", () => {
  it("adds the parts to the song from the start time, and holds the sum to the range", () => {
    const song = audio([0.1, 0.2, 0.3, 0.4]);
    const result: BandResult = {
      drums: { sampleRate: 44100, channels: [Float32Array.from([0.5, 0.5])] },
      notes: { drums: [], bass: [] },
    };
    const mixed = previewMix(song, 2 / 44100, result);
    expect(mixed.channels[0].length).toBe(2);
    expect(Array.from(mixed.channels[0]).map((v) => Math.round(v * 1000) / 1000)).toEqual([0.8, 0.9]);
  });

  it("is silent past the end of the song, and keeps the song's rate", () => {
    const song = audio([0.25], 22050);
    const result: BandResult = { bass: { sampleRate: 22050, channels: [Float32Array.from([0, 0, 0])] }, notes: { drums: [], bass: [] } };
    const mixed = previewMix(song, 0, result);
    expect(mixed.sampleRate).toBe(22050);
    expect(Array.from(mixed.channels[0])).toEqual([0.25, 0, 0]);
  });
});

describe("sumAudio", () => {
  it("adds the sources and pads the shorter ones with silence", () => {
    const sum = sumAudio([audio([0.5, 0.5, 0.5]), audio([0.25])]);
    expect(Array.from(sum.channels[0])).toEqual([0.75, 0.5, 0.5]);
  });
});
