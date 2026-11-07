import { beforeEach, describe, expect, it } from "vitest";
import { defaultStemMix, stemGains, type Mix } from "../stems/mix";
import type { TrackInfo } from "../tracks";
import {
  PRACTICE_MUTE_KEY,
  effectiveMute,
  kindOfTrack,
  noTrackNote,
  parsePracticeMute,
  practiceMutedKeys,
  practiceSummary,
  readCountsAs,
  toggleNotice,
  usePracticeMute,
  type PracticeKind,
  type PracticeTracks,
} from "./practice-mute";

const user = (name: string): TrackInfo => ({ kind: "user", name });
const guitar = new Set<PracticeKind>(["guitar"]);

const split: PracticeTracks = {
  keys: ["vocals", "guitar", "drums", "Drums (generated)", "Lead gtr"],
  info: { "Drums (generated)": user("Drums (generated)"), "Lead gtr": user("Lead gtr") },
  split: true,
};

describe("kindOfTrack", () => {
  it("counts a split stem as its key", () => {
    expect(kindOfTrack("guitar", { kind: "stem", name: "guitar" })).toBe("guitar");
    expect(kindOfTrack("other")).toBe("other");
    expect(kindOfTrack("vocals")).toBe("vocals");
  });

  it("counts the generated drums and bass by their names", () => {
    expect(kindOfTrack("Drums (generated)", user("Drums (generated)"))).toBe("drums");
    expect(kindOfTrack("Bass (generated)", user("Bass (generated)"))).toBe("bass");
  });

  it("counts a user track by its name", () => {
    expect(kindOfTrack("a", user("Rhythm GTR"))).toBe("guitar");
    expect(kindOfTrack("a", user("Lead Vox"))).toBe("vocals");
    expect(kindOfTrack("a", user("Keys"))).toBe("piano");
    expect(kindOfTrack("a", user("Bass guitar"))).toBe("bass");
    expect(kindOfTrack("a", user("Click"))).toBeNull();
  });

  it("lets a user track choose what it counts as", () => {
    expect(kindOfTrack("a", user("Click"), "drums")).toBe("drums");
    expect(kindOfTrack("a", user("Rhythm guitar"), "none")).toBeNull();
  });

  it("never counts the source", () => {
    expect(kindOfTrack("source", { kind: "source", name: "Song" })).toBeNull();
  });
});

describe("practiceMutedKeys and effectiveMute", () => {
  it("mutes the guitar stem and a guitar-named track, and no other", () => {
    expect([...practiceMutedKeys(guitar, split)].sort()).toEqual(["Lead gtr", "guitar"]);
  });

  it("is the song's mix when nothing is practice-muted", () => {
    const mix: Mix = { guitar: { ...defaultStemMix(), volume: 0.4 } };
    expect(effectiveMute(mix, new Set(), split)).toBe(mix);
  });

  it("ORs with the song's mute and leaves the song's mix unchanged", () => {
    const mix: Mix = { vocals: { ...defaultStemMix(), mute: true }, guitar: { ...defaultStemMix(), volume: 0.4 } };
    const before = structuredClone(mix);
    const effective = effectiveMute(mix, guitar, split);
    expect(effective.guitar.mute).toBe(true);
    expect(effective.guitar.volume).toBe(0.4);
    expect(effective.vocals.mute).toBe(true);
    expect(mix).toEqual(before);
    // Turned off again, the song's own mix is back exactly.
    expect(effectiveMute(mix, new Set(), split)).toEqual(before);
  });

  it("silences the practice-muted track in the gains, and the rest keep playing", () => {
    const gains = stemGains(effectiveMute({}, guitar, split), split.keys);
    expect(gains.guitar).toBe(0);
    expect(gains["Lead gtr"]).toBe(0);
    expect(gains.vocals).toBe(1);
  });

  it("does not let a soloed, practice-muted track silence the rest of the song", () => {
    const mix: Mix = { guitar: { ...defaultStemMix(), solo: true } };
    const gains = stemGains(effectiveMute(mix, guitar, split), split.keys);
    expect(gains.guitar).toBe(0);
    expect(gains.vocals).toBe(1);
  });

  it("does not mute a song with no split, which plays its source as one track", () => {
    const whole: PracticeTracks = { keys: ["other"], info: {}, split: false };
    expect(practiceMutedKeys(new Set<PracticeKind>(["other", "guitar"]), whole).size).toBe(0);
    expect(noTrackNote(guitar, whole)).toBe("This song has no guitar track to mute");
  });

  it("says nothing when the song has the track", () => {
    expect(noTrackNote(guitar, split)).toBeNull();
  });

  it("follows a user track's saved choice", () => {
    const tracks: PracticeTracks = { ...split, countsAs: { "Lead gtr": "none" } };
    expect([...practiceMutedKeys(guitar, tracks)]).toEqual(["guitar"]);
  });
});

describe("saved values", () => {
  it("reads the saved choices and drops the unreadable ones", () => {
    expect(readCountsAs({ practiceKinds: { a: "guitar", b: "none", c: "banjo", d: 3 } })).toEqual({ a: "guitar", b: "none" });
    expect(readCountsAs({ practiceKinds: [] })).toEqual({});
    expect(readCountsAs(null)).toEqual({});
  });

  it("reads the stored kinds in order and ignores junk", () => {
    expect(parsePracticeMute('["vocals","guitar","banjo"]')).toEqual(["guitar", "vocals"]);
    expect(parsePracticeMute("not json")).toEqual([]);
    expect(parsePracticeMute(null)).toEqual([]);
  });

  it("words the banner and the notices", () => {
    expect(practiceSummary(new Set())).toBeNull();
    expect(practiceSummary(guitar)).toBe("Guitar muted in every song");
    expect(practiceSummary(new Set<PracticeKind>(["guitar", "vocals"]))).toBe("Guitar and vocals muted in every song");
    expect(toggleNotice("guitar", true, guitar)).toBe("Guitar muted in every song");
    expect(toggleNotice("guitar", false, new Set())).toBe("Guitar back on");
  });
});

describe("the store", () => {
  beforeEach(() => {
    localStorage.clear();
    usePracticeMute.getState().clear();
  });

  it("toggles kinds, keeps them in order and remembers them", () => {
    const { toggle } = usePracticeMute.getState();
    expect(toggle("vocals")).toBe(true);
    expect(toggle("guitar")).toBe(true);
    expect(usePracticeMute.getState().kinds).toEqual(["guitar", "vocals"]);
    expect(JSON.parse(localStorage.getItem(PRACTICE_MUTE_KEY) ?? "[]")).toEqual(["guitar", "vocals"]);
    expect(toggle("guitar")).toBe(false);
    expect(usePracticeMute.getState().kinds).toEqual(["vocals"]);
  });

  it("clears every kind", () => {
    usePracticeMute.getState().toggle("drums");
    usePracticeMute.getState().clear();
    expect(usePracticeMute.getState().kinds).toEqual([]);
  });
});
