import { describe, expect, it } from "vitest";
import type { Cue } from "../performance/chart";
import type { Section } from "../performance/sections";
import type { PcmAudio } from "../types";
import { DEFAULT_BAND_SETTINGS, planSections } from "./arrangement";
import type { BandResult } from "./band-job";
import { fixedBeatGrid } from "./beat-grid";
import { bandHarmony, bandRequest, beatSources, gridThroughSections, levelStems, playsThreeFourDefault, plansForMeter, previewMix, sumAudio } from "./request";

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

describe("gridThroughSections", () => {
  // Beats every half second up to 7.5 s, as when the drums stop there, in a song twelve seconds long.
  const grid = fixedBeatGrid(120, 0, 4, 8);
  const section = (id: string, start: number, end: number): Section => ({ id, name: id, start, end, mode: "continue" });

  it("leaves a grid alone when every section starts inside it, so a song that ends on a last hit keeps its ending", () => {
    expect(gridThroughSections(grid, [section("a", 0, 6), section("b", 6, 12)], 12)).toBe(grid);
  });

  it("carries the beats on through a section that starts after the last beat, at the grid's tempo", () => {
    const longer = gridThroughSections(grid, [section("a", 0, 8), section("outro", 10, 12)], 12);
    expect(longer.beats).toHaveLength(24);
    expect(longer.beats.at(-1)).toBeCloseTo(11.5, 6);
    // The outro starts on a bar line, so the bars stay regular and need no bar starts.
    expect(longer.barStarts).toBeUndefined();
  });

  it("starts a bar where the later section starts, even off the grid's bar lines", () => {
    const longer = gridThroughSections(grid, [section("a", 0, 8), section("outro", 9, 12)], 12);
    expect(longer.barStarts).toEqual([0, 4, 8, 12, 16, 18, 22]);
  });

  it("stops at the end of the last section, never past the song", () => {
    expect(gridThroughSections(grid, [section("outro", 9, 10)], 12).beats.at(-1)).toBeCloseTo(9.5, 6);
    expect(gridThroughSections(grid, [section("outro", 9, 20)], 12).beats.at(-1)).toBeCloseTo(11.5, 6);
  });

  it("is the grid a band request plays on", () => {
    const request = bandRequest({
      grid,
      cues: [{ time: 0, text: "[Am]", messages: [] }],
      chords: [],
      sections: [section("a", 0, 8), section("outro", 10, 12)],
      settings: DEFAULT_BAND_SETTINGS,
      songEnd: 12,
      lengthFrames: 12 * 44100,
      sampleUrls: {},
    });
    expect(request.grid.beats).toHaveLength(24);
    expect(request.harmony).toHaveLength(24);
  });
});

describe("plansForMeter", () => {
  const sections: Section[] = [
    { id: "a", name: "Verse", start: 0, end: 6, mode: "continue" },
    { id: "b", name: "Chorus", start: 6, end: 12, mode: "continue" },
  ];
  const settings = { ...DEFAULT_BAND_SETTINGS, sections: { b: { style: "funk" as const } } };

  it("gives a 3/4 song's sections the 3/4 style unless the section chose its own", () => {
    const plans = plansForMeter(fixedBeatGrid(120, 0, 3, 24), planSections(sections, 12, settings), settings);
    expect(plans.map((plan) => plan.style)).toEqual(["three-four", "funk"]);
    const request = bandRequest({
      grid: fixedBeatGrid(120, 0, 3, 24),
      cues: [],
      chords: [],
      sections,
      settings,
      songEnd: 12,
      lengthFrames: 44100,
      sampleUrls: {},
    });
    expect(playsThreeFourDefault(request)).toBe(true);
  });

  it("leaves a 4/4 song's plans alone", () => {
    const plans = plansForMeter(fixedBeatGrid(120, 0, 4, 24), planSections(sections, 12, settings), settings);
    expect(plans.map((plan) => plan.style)).toEqual(["rock", "funk"]);
  });
});
