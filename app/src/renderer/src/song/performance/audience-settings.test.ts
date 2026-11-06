import { beforeEach, describe, expect, it } from "vitest";
import { AUDIENCE_SETTINGS_KEY, DEFAULT_AUDIENCE_SETTINGS, parseAudienceSettings, useAudienceSettings } from "./audience-settings";

describe("parseAudienceSettings", () => {
  it("uses the defaults when nothing is stored or the stored text is damaged", () => {
    expect(parseAudienceSettings(null)).toEqual(DEFAULT_AUDIENCE_SETTINGS);
    expect(parseAudienceSettings("{not json")).toEqual(DEFAULT_AUDIENCE_SETTINGS);
  });

  it("keeps good values and replaces bad ones one at a time", () => {
    expect(parseAudienceSettings(JSON.stringify({ showChords: false, fontScale: 1.5, rotation: 270 }))).toEqual({
      showChords: false,
      fontScale: 1.5,
      rotation: 270,
      blackBetweenSongs: false,
      blackout: false,
    });
    expect(parseAudienceSettings(JSON.stringify({ showChords: "yes", fontScale: 99, rotation: 45 }))).toEqual({
      showChords: true,
      fontScale: 2,
      rotation: 0,
      blackBetweenSongs: false,
      blackout: false,
    });
  });

  it("keeps the black-between-songs choice, and defaults it off", () => {
    expect(parseAudienceSettings(null).blackBetweenSongs).toBe(false);
    expect(parseAudienceSettings(JSON.stringify({ blackBetweenSongs: true })).blackBetweenSongs).toBe(true);
  });

  it("never restores a blackout", () => {
    expect(parseAudienceSettings(JSON.stringify({ blackout: true })).blackout).toBe(false);
  });
});

describe("useAudienceSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudienceSettings.setState({ ...DEFAULT_AUDIENCE_SETTINGS });
  });

  it("stores the choices, and keeps the font size in range", () => {
    useAudienceSettings.getState().update({ fontScale: 7, rotation: 180, showChords: false, blackout: true });
    expect(useAudienceSettings.getState()).toMatchObject({ fontScale: 2, rotation: 180, showChords: false, blackout: true });
    const stored = JSON.parse(localStorage.getItem(AUDIENCE_SETTINGS_KEY) ?? "{}");
    expect(stored).toEqual({ showChords: false, fontScale: 2, rotation: 180, blackBetweenSongs: false });
  });
});
