import { beforeEach, describe, expect, it } from "vitest";
import {
  chartSourceOf,
  lrcTexts,
  lyricsMadeOf,
  lyricsSaveValues,
  markLyricsEdited,
  previousChartOf,
  restoreLyricsChart,
  saveLyricsChart,
} from "./lyrics-chart";
import { clearSettingsCache, getSetting, readOptions, setSetting } from "./settings";

beforeEach(() => {
  localStorage.clear();
  clearSettingsCache();
});

describe("chartSourceOf", () => {
  it("reads the recorded source", () => {
    expect(chartSourceOf({ chartSource: "transcribed" })).toBe("transcribed");
    expect(chartSourceOf({ chartSource: "aligned" })).toBe("aligned");
    expect(chartSourceOf({ chartSource: "user" })).toBe("user");
  });

  it("reads a chart with no recorded source, or an unknown one, as unknown, never as the performer's", () => {
    expect(chartSourceOf({})).toBe("unknown");
    expect(chartSourceOf({ chartSource: "bogus" })).toBe("unknown");
  });
});

describe("lrcTexts", () => {
  it("returns the lines' words in order, keeping section breaks and dropping trailing ones", () => {
    const lrc = "[00:01.00] Hold on\n[00:03.00] \n[00:03.00] I'm coming\n[00:09.00] \nnot a timed line";
    expect(lrcTexts(lrc)).toEqual(["Hold on", "", "I'm coming"]);
  });

  it("is empty for an empty chart", () => {
    expect(lrcTexts("")).toEqual([]);
  });
});

describe("lyricsMadeOf and previousChartOf", () => {
  it("read only well-formed records", () => {
    expect(lyricsMadeOf({ lyricsMade: { model: "small", quality: "fast", language: "auto", at: "x" } })).toMatchObject({ model: "small" });
    expect(lyricsMadeOf({ lyricsMade: { model: 3 } })).toBeNull();
    expect(previousChartOf({ previousChart: { text: "Old", source: "transcribed" } })).toEqual({ text: "Old", source: "transcribed" });
    expect(previousChartOf({ previousChart: { text: "  " } })).toBeNull();
  });
});

describe("lyricsSaveValues", () => {
  it("keeps the replaced chart once, with its source, and records the new source", () => {
    const values = lyricsSaveValues({ shift: 1 }, "[00:01.00] Old", { text: "[00:02.00] New", source: "transcribed" });
    expect(values[":lyrics"]).toBe("[00:02.00] New");
    expect(JSON.parse(values[":options"])).toEqual({ shift: 1, chartSource: "transcribed", previousChart: { text: "[00:01.00] Old", source: "unknown" } });
  });

  it("keeps nothing when there was no chart to replace", () => {
    const options = JSON.parse(lyricsSaveValues({}, "", { text: "[00:02.00] New", source: "transcribed" })[":options"]);
    expect(options.previousChart).toBeUndefined();
  });
});

describe("saving, editing and restoring a chart", () => {
  it("saves the chart with its source and the chart it replaced, and restores that once", () => {
    setSetting("song", ":lyrics", "[00:01.00] Typed by hand");
    saveLyricsChart("song", { text: "[00:02.00] Heard", source: "transcribed", made: { model: "small", quality: "fast", language: "auto", at: "t" } });
    expect(getSetting("song", ":lyrics")).toBe("[00:02.00] Heard");
    const saved = readOptions<Record<string, unknown>>("song", {});
    expect(saved.chartSource).toBe("transcribed");
    expect(saved.previousChart).toEqual({ text: "[00:01.00] Typed by hand", source: "unknown" });

    expect(restoreLyricsChart("song")).toBe(true);
    expect(getSetting("song", ":lyrics")).toBe("[00:01.00] Typed by hand");
    const restored = readOptions<Record<string, unknown>>("song", {});
    expect(restored.chartSource).toBe("unknown");
    expect(restored.previousChart).toBeUndefined();
    expect(restoreLyricsChart("song")).toBe(false);
  });

  it("turns a transcribed or aligned chart into the performer's when it is edited, and leaves a user chart alone", () => {
    saveLyricsChart("song", { text: "[00:02.00] Heard", source: "aligned" });
    markLyricsEdited("song");
    expect(readOptions<Record<string, unknown>>("song", {}).chartSource).toBe("user");
    markLyricsEdited("song");
    expect(readOptions<Record<string, unknown>>("song", {}).chartSource).toBe("user");
  });

  it("records an edit to a chart from before 0.9.2 as the performer's, explicitly", () => {
    setSetting("old", ":lyrics", "[00:02.00] Heard before 0.9.2");
    markLyricsEdited("old");
    expect(readOptions<Record<string, unknown>>("old", {}).chartSource).toBe("user");
  });
});
