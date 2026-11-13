import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, isBandSettings, parseBandSettings } from "./arrangement";
import { DEFAULT_ENDING, ENDINGS, beatTimeAt, isEnding, parseEnding } from "./ending";

describe("parseEnding", () => {
  it("reads every kind and keeps a section and bars", () => {
    for (const kind of ENDINGS) expect(parseEnding({ kind })).toEqual({ kind });
    expect(parseEnding({ kind: "slow", atSection: "outro", bars: 2 })).toEqual({ kind: "slow", atSection: "outro", bars: 2 });
  });

  it("gives a hit for anything that is not an ending, so a song saved before endings ends as it did", () => {
    for (const value of [undefined, null, "hit", { kind: "fade" }, { kind: "slow", bars: 3 }, { kind: "hit", atSection: 4 }]) {
      expect(parseEnding(value)).toEqual(DEFAULT_ENDING);
    }
    expect(parseBandSettings({}).ending).toEqual({ kind: "hit" });
  });

  it("is part of what makes band settings valid", () => {
    expect(isEnding({ kind: "hold" })).toBe(true);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, ending: { kind: "hold", atSection: null } })).toBe(true);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, ending: { kind: "nope" } })).toBe(false);
    expect(parseBandSettings({ ending: { kind: "hits" } }).ending).toEqual({ kind: "hits" });
  });
});

describe("beatTimeAt", () => {
  it("carries the last beat interval on past the grid", () => {
    expect(beatTimeAt([0, 0.5, 1], 1)).toBe(0.5);
    expect(beatTimeAt([0, 0.5, 1], 4)).toBe(2);
  });
});
