import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS } from "./arrangement";
import { fixedBeatGrid } from "./beat-grid";
import { readStoredBand, writeStoredBand } from "./stored";

const KEY = "vltn.performance.v1:stored-test:8:44100";
afterEach(() => localStorage.clear());

describe("stored band options", () => {
  it("a grid written by the performer clears the analysis tag, so the analysis leaves it alone", () => {
    const key = "stored-tag-test";
    localStorage.setItem(key + ":options", JSON.stringify({ beatGridSource: "analysis" }));
    writeStoredBand(key, { beatGrid: fixedBeatGrid(100, 0, 4, 10) });
    expect(JSON.parse(localStorage.getItem(key + ":options") ?? "{}").beatGridSource).toBeUndefined();
  });

  it("reads the defaults from a song with nothing saved", () => {
    expect(readStoredBand(KEY)).toEqual({ settings: DEFAULT_BAND_SETTINGS, grid: null, outOfDate: false, noticeDismissed: false });
  });

  it("keeps the other options when a field is written", () => {
    localStorage.setItem(`${KEY}:options`, JSON.stringify({ shift: 2, beats: 3 }));
    const grid = fixedBeatGrid(120, 0, 3, 4);
    writeStoredBand(KEY, { beatGrid: grid, bandOutOfDate: true });
    const saved = JSON.parse(localStorage.getItem(`${KEY}:options`) ?? "{}");
    expect(saved).toMatchObject({ shift: 2, beats: 3, bandOutOfDate: true });
    expect(readStoredBand(KEY).grid?.beats).toEqual(grid.beats);
    expect(readStoredBand(KEY).outOfDate).toBe(true);
  });

  it("falls back to the defaults for a damaged band entry", () => {
    localStorage.setItem(`${KEY}:options`, JSON.stringify({ band: { style: "polka", seed: -1 }, beatGrid: "grid", bandNoticeDismissed: true }));
    const stored = readStoredBand(KEY);
    expect(stored.settings.style).toBe(DEFAULT_BAND_SETTINGS.style);
    expect(stored.settings.seed).toBe(DEFAULT_BAND_SETTINGS.seed);
    expect(stored.grid).toBeNull();
    expect(stored.noticeDismissed).toBe(true);
  });
});
