import { describe, expect, it } from "vitest";
import { fixedBeatGrid } from "./beat-grid";
import { DEFAULT_BAND_SETTINGS, planSections } from "./arrangement";
import {
  assembleRhythm,
  assembleRhythmPart,
  parseRhythmSetup,
  RHYTHM_ROLES,
  rhythmExportFiles,
  rhythmPreview,
  rhythmSources,
  suggestRhythmSetup,
  type RhythmSetup,
  type RhythmSnapshot,
} from "./rhythm-export";
import { parseSmf } from "../performance/smf";

function snapshot(): RhythmSnapshot {
  return {
    name: "My: Song.wav",
    duration: 12,
    grid: fixedBeatGrid(120, 0, 4, 12),
    sections: [],
    plans: [],
    notes: Array.from({ length: 24 }, (_, beat) => ({ time: beat * 0.5, pitch: beat % 2 ? 38 : 36, velocity: 90 + beat, duration: 0.1 })),
  };
}
function setup(source = snapshot()): RhythmSetup {
  const result = suggestRhythmSetup(source);
  RHYTHM_ROLES.forEach((role, index) => {
    result.parts[role] = { source: "song", firstBar: index + 1, bars: 1 };
  });
  return result;
}

describe("rhythm passage export", () => {
  it("packs six parts and emits a matching one-based import table with safe filenames", () => {
    const source = snapshot(),
      choices = setup(source);
    const result = assembleRhythm(source, choices);
    expect(result.parts.map((part) => [part.role, part.startBar, part.bars])).toEqual(RHYTHM_ROLES.map((role, i) => [role, i + 1, 1]));
    expect(result.endTick).toBe(6 * 1920);
    const files = rhythmExportFiles(source, choices);
    expect(files.map((file) => file.name)).toEqual(["My- Song - RC10R.mid", "My- Song - RC10R Import.txt", "My- Song - RC10R.RC0"]);
    const messages = parseSmf(files[0].bytes);
    expect(messages.filter((message) => message.bytes[0] === 0x99)).toHaveLength(24);
    expect(messages.every((message) => [0x99, 0x89].includes(message.bytes[0]))).toBe(true);
    const guide = new TextDecoder().decode(files[1].bytes);
    expect(guide).toContain("Ending\t6\t1\tWhole song\t6");
    expect(guide).toContain("Tempo: 120 quarter-note BPM");
    expect(guide).toContain("All six part assignments are included");
  });

  it("preserves an entire silent last bar after a short ending hit", () => {
    const source = snapshot(),
      choices = setup(source);
    source.notes = [{ time: 0, pitch: 36, velocity: 110, duration: 0.1 }];
    choices.parts.ending = { source: "song", firstBar: 1, bars: 2 };
    const ending = assembleRhythmPart(source, choices, "ending");
    expect(ending.endTick).toBe(3840);
    expect(rhythmPreview(ending, choices).duration).toBe(4);
    expect(ending.notes).toEqual([{ tick: 0, duration: 96, pitch: 36, velocity: 110 }]);
  });

  it("normalises tempo drift by fractional beat, retaining swing and velocity", () => {
    const source = snapshot();
    source.grid.beats = [1, 1.4, 2, 2.5, 3, 3.5, 4, 4.5];
    source.grid.downbeat = 0;
    source.duration = 5;
    source.notes = [{ time: 1.8, pitch: 42, velocity: 71, duration: 0.06 }];
    const choices = setup(source);
    const part = assembleRhythmPart(source, choices, "intro");
    expect(part.notes[0].tick).toBe(800); // 1 + 2/3 of a pulse, not 0.8 seconds at the target tempo.
    expect(part.notes[0].velocity).toBe(71);
    const preview = rhythmPreview(part, choices);
    expect(preview.notes[0].time).toBeCloseTo(5 / 6);
    expect(preview.duration).toBe(2);
  });

  it("starts at the real downbeat, excludes pickup audio and incomplete source bars", () => {
    const source = snapshot();
    source.grid.downbeat = 1;
    source.duration = 3.9;
    source.notes = [
      { time: 0, pitch: 36, velocity: 99, duration: 0.1 },
      { time: 0.5, pitch: 38, velocity: 90, duration: 0.1 },
    ];
    const sources = rhythmSources(source);
    expect(sources[0].bars).toHaveLength(1);
    const part = assembleRhythmPart(source, setup(source), "intro");
    expect(part.notes.map((note) => [note.tick, note.pitch])).toEqual([[0, 38]]);
  });

  it("never leaks a neighbouring passage's note and reports excluded early hits and capped note-offs", () => {
    const source = snapshot(),
      choices = setup(source);
    choices.parts.pattern1.firstBar = 2;
    source.notes = [
      { time: 1.99, pitch: 36, velocity: 90, duration: 0.1 },
      { time: 2, pitch: 38, velocity: 90, duration: 0.1 },
      { time: 3.99, pitch: 49, velocity: 100, duration: 1 },
      { time: 4, pitch: 51, velocity: 100, duration: 0.1 },
    ];
    const part = assembleRhythmPart(source, choices, "pattern1");
    expect(part.notes.map((note) => note.pitch)).toEqual([38, 49]);
    expect(part.notes.at(-1)!.tick + part.notes.at(-1)!.duration).toBe(1920);
    expect(part.warnings.join(" ")).toContain("shortened or adjusted");
    expect(part.warnings.join(" ")).toContain("excluded");
  });

  it("uses dotted-quarter pulses for 6/8 and never mistakes 2/4 for 6/8 automatically", () => {
    const source = snapshot();
    source.grid = fixedBeatGrid(100, 0, 2, 12);
    source.notes = [{ time: 0.6, pitch: 36, velocity: 100, duration: 0.1 }];
    const choices = setup(source);
    expect(choices.meter).toBe("2/4");
    choices.meter = "6/8";
    RHYTHM_ROLES.forEach((role) => {
      choices.parts[role].firstBar = 1;
    });
    const part = assembleRhythmPart(source, choices, "intro");
    expect(part.notes[0].tick).toBe(720);
    expect(part.endTick).toBe(1440);
    expect(rhythmPreview(part, choices).duration).toBeCloseTo(1.2);
    expect(assembleRhythm(source, choices).quarterBpm).toBe(150);
    expect(new TextDecoder().decode(rhythmExportFiles(source, choices)[1].bytes)).toContain("dotted-quarter BPM");
  });

  it("rejects missing, silent, truncated, irregular or mismatched selections and unsupported hits", () => {
    const source = snapshot(),
      choices = setup(source);
    choices.parts.intro.source = null;
    expect(() => assembleRhythmPart(source, choices, "intro")).toThrow("Choose a source");
    choices.parts.intro = { source: "song", firstBar: 6, bars: 2 };
    expect(() => assembleRhythmPart(source, choices, "intro")).toThrow("goes past");
    choices.parts.intro = { source: "song", firstBar: 1, bars: 1 };
    source.notes = [];
    expect(() => assembleRhythmPart(source, choices, "intro")).toThrow("no generated drum hits");
    source.notes = [{ time: 0, pitch: 60, velocity: 100, duration: 0.1 }];
    expect(() => assembleRhythmPart(source, choices, "intro")).toThrow("not supported");
    source.grid.barStarts = [0, 3, 8, 12];
    expect(() => assembleRhythmPart(source, choices, "intro")).toThrow("irregular bar");
    choices.meter = "6/8";
    expect(() => assembleRhythmPart(source, choices, "intro")).toThrow("needs 2 grid beats");
  });

  it("releases repeated pitches before the next hit and merges simultaneous duplicates", () => {
    const source = snapshot();
    source.notes = [
      { time: 0, pitch: 36, velocity: 90, duration: 0.3 },
      { time: 0, pitch: 36, velocity: 100, duration: 0.3 },
      { time: 0.1, pitch: 36, velocity: 70, duration: 0.1 },
    ];
    const part = assembleRhythmPart(source, setup(source), "intro");
    expect(part.notes).toEqual([
      { tick: 0, pitch: 36, velocity: 100, duration: 96 },
      { tick: 96, pitch: 36, velocity: 70, duration: 96 },
    ]);
  });

  it("suggests labelled verse/chorus passages without the opening crash or closing fill", () => {
    const source = snapshot();
    source.duration = 32;
    source.grid = fixedBeatGrid(120, 0, 4, 32);
    source.sections = [
      { id: "v", name: "Verse 1", start: 0, end: 16, mode: "continue" },
      { id: "c", name: "Chorus 1", start: 16, end: 32, mode: "continue" },
    ];
    source.plans = planSections(source.sections, 32, DEFAULT_BAND_SETTINGS);
    const suggestions = suggestRhythmSetup(source);
    expect(suggestions.parts.pattern1).toEqual({ source: "v", firstBar: 2, bars: 4 });
    expect(suggestions.parts.pattern2).toEqual({ source: "c", firstBar: 2, bars: 4 });
    expect(suggestions.parts.intro.source).toBeNull();
    expect(suggestions.parts.ending.source).toBeNull();
    source.plans = source.plans.map((plan) => ({ ...plan, fill: false }));
    expect(suggestRhythmSetup(source).parts.fill1.source).toBeNull();
  });

  it("parses versioned saved choices, keeps valid values and surfaces deleted sections", () => {
    const source = snapshot(),
      choices = setup(source);
    choices.parts.fill1.source = "deleted-section";
    expect(parseRhythmSetup(choices, source).parts.fill1.source).toBeNull();
    expect(parseRhythmSetup({ ...choices, bpm: NaN }, source).bpm).toBe(120);
    expect(parseRhythmSetup({ version: 2, parts: choices.parts }, source).parts.intro.source).toBeNull();
    expect(parseRhythmSetup(choices, source).parts.ending).toEqual(choices.parts.ending);
  });

  it("exports a native rhythm with assignments and enforces the converter's one-bar fills and tempo limits", () => {
    const source = snapshot(),
      choices = setup(source);
    const files = rhythmExportFiles(source, choices);
    const native = files.find((file) => file.name.endsWith(".RC0"))!;
    expect(new TextDecoder().decode(native.bytes.slice(0, 8))).toBe("PTN_0000");
    const view = new DataView(native.bytes.buffer);
    expect(view.getUint16(32 + 3 * 16, true)).toBe(3); // Pattern 2 starts at exported bar4 in this fixture.
    choices.parts.fill1.bars = 2;
    expect(() => rhythmExportFiles(source, choices)).toThrow("one-bar fill");
    choices.parts.fill1.bars = 1;
    choices.bpm = 39;
    expect(() => rhythmExportFiles(source, choices)).toThrow("40–350");
  });
});
