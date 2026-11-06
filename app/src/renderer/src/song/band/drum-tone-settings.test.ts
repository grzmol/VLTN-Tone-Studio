import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, isBandSettings, parseBandSettings, parseDrumTone, PART_ROLES, TONE_BLOCK_TYPE, type PartTone } from "./arrangement";

describe("the drum tone setting (spec 104)", () => {
  const outboard = {
    type: "capture",
    role: "outboard",
    file: { source: "tone3000", toneId: 5, modelId: 9, name: "Bus comp" },
    inputDb: 0,
    outputDb: 0,
    mix: 1,
    on: true,
  } as const;
  const room = {
    type: "ir",
    role: "space",
    file: { source: "file", path: "/music/room.wav", name: "Room" },
    inputDb: 0,
    outputDb: 0,
    mix: 0.25,
    on: true,
  } as const;

  it("lists the roles of each part, with outboard a capture", () => {
    expect(PART_ROLES.bass).toEqual(["pedal", "preamp", "amp", "cab", "space"]);
    expect(PART_ROLES.drums).toEqual(["outboard", "preamp", "space"]);
    expect(TONE_BLOCK_TYPE.outboard).toBe("capture");
  });

  it("reads an old song, saved without a drum tone, as clean drums", () => {
    expect(DEFAULT_BAND_SETTINGS.drumTone).toEqual({ kind: "clean" });
    const { drumTone: _dropped, ...older } = DEFAULT_BAND_SETTINGS;
    expect(parseBandSettings(older).drumTone).toEqual({ kind: "clean" });
    expect(parseBandSettings(undefined).drumTone).toEqual({ kind: "clean" });
    expect(parseDrumTone("garbage")).toEqual({ kind: "clean" });
  });

  it("round-trips a drum chain", () => {
    const tone: PartTone = { kind: "chain", blocks: [outboard, room], dryWet: 0.8, fast: true };
    expect(parseDrumTone(tone)).toEqual(tone);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, drumTone: tone })).toBe(true);
    expect(parseBandSettings({ ...DEFAULT_BAND_SETTINGS, drumTone: tone }).drumTone).toEqual(tone);
  });

  it("drops a role the drums do not offer, and an unknown one", () => {
    const amp = { ...outboard, role: "amp" };
    const unknown = { ...outboard, role: "fuzzbox" };
    const parsed = parseDrumTone({ kind: "chain", blocks: [amp, unknown, outboard, room], dryWet: 1, fast: false });
    expect(parsed).toMatchObject({ kind: "chain", blocks: [outboard, room] });
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, drumTone: { kind: "chain", blocks: [amp], dryWet: 1, fast: false } })).toBe(false);
  });

  it("leaves the bass chain without the outboard role, as before", () => {
    const parsed = parseBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: { kind: "chain", blocks: [outboard], dryWet: 1, fast: false } });
    expect(parsed.bassTone).toMatchObject({ kind: "chain", blocks: [] });
  });
});
