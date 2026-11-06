import { describe, expect, it } from "vitest";
import type { BeatGrid } from "../band/beat-grid";
import { ANALYSIS_VERSION, type SongAnalysis } from "./song-analysis";
import { planWriteBack, tempoMayChange, type BatchSong } from "./apply";

const song = (id: string, over: Record<string, string> = {}, options: Record<string, unknown> = {}): BatchSong => ({
  id,
  title: `Song ${id}`,
  settings: { ":bpm": "120", ":options": JSON.stringify(options), ...over },
});
const grid: BeatGrid = { beatsPerBar: 4, beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], downbeat: 0, bpm: 120, steady: null };

describe("tempoMayChange", () => {
  it("keeps a manual, tap or chart tempo unless the performer asked to replace it", () => {
    for (const source of ["manual", "tap", "chart"]) {
      expect(tempoMayChange(song("e", { ":bpm": "95" }, { tempoSource: source }), false)).toBe(false);
      expect(tempoMayChange(song("e", { ":bpm": "95" }, { tempoSource: source }), true)).toBe(true);
    }
  });

  it("changes a detected tempo and a legacy 120 with no source", () => {
    expect(tempoMayChange(song("f", { ":bpm": "95" }, { tempoSource: "detected" }), false)).toBe(true);
    expect(tempoMayChange(song("f", { ":bpm": "120" }), false)).toBe(true);
  });
});

describe("planWriteBack", () => {
  const analysis: SongAnalysis = {
    audioId: "x",
    version: ANALYSIS_VERSION,
    tempo: { bpm: 98, firstBeat: 0.4, steady: true },
    meter: { beatsPerBar: 4, confidence: 0.9 },
    loudness: { lufs: -14, peakDb: -1 },
  };

  it("sets the detected tempo, first beat, grid and meter, and records the tempo change", () => {
    const plan = planWriteBack(song("i", { ":bpm": "120" }), analysis, grid, false);
    expect(plan.values[":bpm"]).toBe("98");
    expect(plan.tempoChange).toEqual({ from: 120, to: 98 });
    const options = JSON.parse(plan.values[":options"]);
    expect(options).toMatchObject({ tempoSource: "detected", firstBeat: 0.4, beatGridSource: "analysis", beats: 4, songLufs: -14, songPeakDb: -1 });
    expect(options.analysis).toEqual(analysis);
  });

  it("keeps a manual tempo and the performer's grid when the performer did not ask for them to be replaced", () => {
    const performer = song("j", { ":bpm": "95" }, { tempoSource: "manual", beatGrid: { performer: true }, beatGridSource: undefined });
    const options = JSON.parse(planWriteBack(performer, analysis, grid, false).values[":options"]);
    expect(options.tempoSource).toBe("manual");
    expect(options.beatGrid).toEqual({ performer: true });
    expect(planWriteBack(performer, analysis, grid, false).values[":bpm"]).toBeUndefined();
  });

  it("does not apply a 3/4 reading, which the Performance screen only offers", () => {
    const three: SongAnalysis = { ...analysis, meter: { beatsPerBar: 3, confidence: 0.9 } };
    const options = JSON.parse(planWriteBack(song("k"), three, grid, false).values[":options"]);
    expect(options.beats).toBeUndefined();
  });

  it("keeps a loudness the song already has", () => {
    const options = JSON.parse(planWriteBack(song("l", {}, { songLufs: -10 }), analysis, grid, false).values[":options"]);
    expect(options.songLufs).toBe(-10);
  });

  it("reports no tempo change when the tempo is the same", () => {
    expect(planWriteBack(song("m", { ":bpm": "98" }), analysis, grid, false).tempoChange).toBeNull();
  });
});
