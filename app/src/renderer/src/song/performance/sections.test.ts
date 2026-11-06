import { describe, expect, it } from "vitest";
import {
  armJump,
  clampSections,
  immediateJump,
  cancelJump,
  isBarAligned,
  nextBoundary,
  NO_LIVE,
  parseSections,
  pruneLive,
  releaseLoop,
  saveLiveAsDefault,
  sectionIndexAt,
  sectionIssues,
  snapToBeat,
  startLoop,
  type Section,
  type SectionLive,
  type SectionMode,
} from "./sections";

const section = (id: string, start: number, end: number, mode: SectionMode = "continue"): Section => ({ id, name: id, start, end, mode });

/** Intro 0–8, Verse 8–16, Chorus 16–24, Outro 24–32. Verse mode varies per case. */
const song = (verse: SectionMode = "continue", chorus: SectionMode = "continue"): Section[] => [
  section("intro", 0, 8),
  section("verse", 8, 16, verse),
  section("chorus", 16, 24, chorus),
  section("outro", 24, 32),
];

describe("nextBoundary by mode", () => {
  const cases: { name: string; mode: SectionMode; position: number; live?: SectionLive; expect: Partial<ReturnType<typeof nextBoundary>> & { action: unknown } }[] = [
    { name: "continue plays on at the end", mode: "continue", position: 10, expect: { at: 16, action: { kind: "continue" } } },
    { name: "pause stops at the end", mode: "pause", position: 10, expect: { at: 16, action: { kind: "pause" } } },
    {
      name: "repeat-once jumps back once",
      mode: "repeat-once",
      position: 10,
      expect: { at: 16, action: { kind: "jump", to: 8, target: "verse" } },
    },
    {
      name: "loop jumps back every time it is asked",
      mode: "loop",
      position: 10,
      expect: { at: 16, action: { kind: "jump", to: 8, target: "verse" } },
    },
  ];
  it.each(cases)("$name", ({ mode, position, live = NO_LIVE, expect: wanted }) => {
    const boundary = nextBoundary(song(mode), position, live);
    expect(boundary).toMatchObject(wanted);
  });

  it("repeat-once repeats only once, then continues", () => {
    const first = nextBoundary(song("repeat-once"), 10, NO_LIVE)!;
    expect(first.action).toEqual({ kind: "jump", to: 8, target: "verse" });
    // The jump's pass comes back to the same end; the repeat is already used up.
    const second = nextBoundary(song("repeat-once"), 10, first.live)!;
    expect(second.action).toEqual({ kind: "continue" });
    expect(second.live.repeated).toEqual([]);
  });

  it("a skipped section is jumped over at its start", () => {
    const boundary = nextBoundary(song("continue", "skip"), 10, NO_LIVE)!;
    expect(boundary).toMatchObject({ at: 16, action: { kind: "jump", to: 24, target: null } });
  });

  it("a stored loop released by the performer stops repeating and forgets the release afterwards", () => {
    const released = releaseLoop(NO_LIVE, "verse");
    const boundary = nextBoundary(song("loop"), 10, released)!;
    expect(boundary.action).toEqual({ kind: "continue" });
    expect(boundary.live.released).toEqual([]);
  });
});

describe("live jumps and loops", () => {
  it("a pending jump is taken at the end of the section being played and consumed", () => {
    const boundary = nextBoundary(song(), 10, armJump(NO_LIVE, "chorus"))!;
    expect(boundary).toMatchObject({ at: 16, action: { kind: "jump", to: 16, target: "chorus" } });
    expect(boundary.live.jump).toBeNull();
  });

  it("a jump wins over a loop of the section being left", () => {
    const live = startLoop(armJump(NO_LIVE, "outro"), "verse");
    const boundary = nextBoundary(song(), 10, live)!;
    expect(boundary.action).toEqual({ kind: "jump", to: 24, target: "outro" });
    expect(boundary.live.loop).toBeNull();
  });

  it("a live loop repeats the section every pass until it is released", () => {
    let live = startLoop(NO_LIVE, "verse");
    for (let pass = 0; pass < 3; pass++) {
      const boundary = nextBoundary(song(), 10, live)!;
      expect(boundary.action).toEqual({ kind: "jump", to: 8, target: "verse" });
      live = boundary.live;
    }
    live = releaseLoop(live, "verse");
    const after = nextBoundary(song(), 10, live)!;
    expect(after.action).toEqual({ kind: "continue" });
    expect(after.live.loop).toBeNull();
  });

  it("a jump armed between sections lands at the next section start", () => {
    const gapped = [section("a", 0, 4), section("b", 6, 8), section("c", 10, 12)];
    const boundary = nextBoundary(gapped, 5, armJump(NO_LIVE, "c"));
    expect(boundary).toMatchObject({ at: 6, action: { kind: "jump", to: 10, target: "c" } });
  });

  it("a jump to a section that was deleted is dropped", () => {
    const boundary = nextBoundary(song(), 10, armJump(NO_LIVE, "gone"))!;
    expect(boundary.action).toEqual({ kind: "continue" });
    expect(boundary.live.jump).toBeNull();
  });

  it("cancelling a jump leaves the rest of the live state alone", () => {
    const live = cancelJump({ ...startLoop(NO_LIVE, "verse"), jump: "chorus" });
    expect(live).toEqual({ loop: "verse", jump: null, repeated: [], released: [] });
  });

  it("returns no boundary when nothing lies ahead", () => {
    expect(nextBoundary([], 0, NO_LIVE)).toBeNull();
    expect(nextBoundary(song(), 32, NO_LIVE)).toBeNull();
  });
});

describe("immediateJump", () => {
  it("jumps at once to the section, leaving the one being played: its loop and repeat are forgotten", () => {
    const live = { ...startLoop(NO_LIVE, "verse"), repeated: ["verse"] };
    const boundary = immediateJump(song(), 10, live, "chorus");
    expect(boundary).toEqual({ at: 10, action: { kind: "jump", to: 16, target: "chorus" }, live: NO_LIVE });
  });

  it("returns nothing for a section that does not exist", () => {
    expect(immediateJump(song(), 10, NO_LIVE, "gone")).toBeNull();
  });
});

describe("sectionIndexAt", () => {
  it("finds the section that holds a position, and -1 between sections", () => {
    const sections = [section("a", 0, 4), section("b", 6, 8)];
    expect(sectionIndexAt(sections, 0)).toBe(0);
    expect(sectionIndexAt(sections, 4)).toBe(-1);
    expect(sectionIndexAt(sections, 7)).toBe(1);
  });
});

describe("parseSections", () => {
  it("keeps valid sections in song order and drops the rest", () => {
    const parsed = parseSections([
      { id: "b", name: "  Chorus  ", start: 16, end: 24, mode: "loop", color: "#ff0000" },
      { id: "a", name: "Intro", start: 0, end: 8, mode: "continue" },
      { id: "a", name: "Duplicate", start: 0, end: 8, mode: "continue" },
      { id: "bad", start: 1, end: 0.5, mode: "continue" },
      { id: "mode", start: 1, end: 2, mode: "reverse" },
      { id: "color", name: "Solo", start: 30, end: 40, mode: "pause", color: "red" },
      null,
    ]);
    expect(parsed.map((s) => s.id)).toEqual(["a", "b", "color"]);
    expect(parsed[1]).toMatchObject({ name: "Chorus", color: "#ff0000" });
    expect(parsed[2].color).toBeUndefined();
  });

  it("reads nothing from a value that is not a list", () => {
    expect(parseSections({ id: "a" })).toEqual([]);
    expect(parseSections(undefined)).toEqual([]);
  });

  it("caps the list at 64 sections", () => {
    const raw = Array.from({ length: 70 }, (_, i) => ({ id: `s${i}`, name: "x", start: i * 2, end: i * 2 + 1, mode: "continue" }));
    expect(parseSections(raw)).toHaveLength(64);
  });
});

describe("beat grid helpers", () => {
  it("snaps to the nearest beat from firstBeat, and leaves times alone without a tempo", () => {
    expect(snapToBeat(1.3, 120, 0.25)).toBeCloseTo(1.25);
    expect(snapToBeat(1.4, 120, 0)).toBeCloseTo(1.5);
    expect(snapToBeat(1.3, 0, 0)).toBe(1.3);
    expect(snapToBeat(0.1, 120, 0.5)).toBeCloseTo(0);
  });

  it("checks bar alignment to within 10 ms", () => {
    // 120 BPM, 4 beats: a bar is 2 s.
    expect(isBarAligned(8, 120, 4, 0)).toBe(true);
    expect(isBarAligned(8.005, 120, 4, 0)).toBe(true);
    expect(isBarAligned(8.5, 120, 4, 0)).toBe(false);
    expect(isBarAligned(8.5, 0, 4, 0)).toBe(true);
  });
});

describe("sectionIssues", () => {
  it("warns about sections past the audio, overlaps and boundaries off the bar", () => {
    const issues = sectionIssues(
      [section("a", 0, 8.5), section("b", 8, 40)],
      { duration: 30, bpm: 120, beats: 4, firstBeat: 0 },
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("section-range");
    expect(codes).toContain("section-overlap");
    expect(codes).toContain("section-bar");
  });

  it("is quiet for aligned, in-range sections", () => {
    expect(sectionIssues([section("a", 0, 8), section("b", 8, 16)], { duration: 30, bpm: 120, beats: 4 })).toEqual([]);
  });
});

describe("pruneLive", () => {
  it("drops live state that names deleted sections", () => {
    const live: SectionLive = { loop: "gone", jump: "verse", repeated: ["gone", "verse"], released: ["gone"] };
    expect(pruneLive(live, song())).toEqual({ loop: null, jump: "verse", repeated: ["verse"], released: [] });
  });
});

describe("saveLiveAsDefault", () => {
  it("stores a live loop as the section's loop mode, and a released loop as continue", () => {
    const sections = [section("a", 0, 8), section("b", 8, 16, "loop"), section("c", 16, 24, "pause")];
    const live = { ...startLoop(NO_LIVE, "a"), released: ["b"] };
    expect(saveLiveAsDefault(sections, live).map((s) => s.mode)).toEqual(["loop", "continue", "pause"]);
  });

  it("does not store a pending jump", () => {
    const sections = [section("a", 0, 8)];
    expect(saveLiveAsDefault(sections, armJump(NO_LIVE, "a"))).toEqual(sections);
  });
});

describe("clampSections", () => {
  const verse = { id: "v", name: "Verse", start: 1, end: 9, mode: "continue" as const };
  const chorus = { id: "c", name: "Chorus", start: 9.5, end: 12, mode: "continue" as const };

  it("cuts sections to the trimmed range and drops one that is left empty", () => {
    expect(clampSections([verse, chorus], { start: 2, end: 10 })).toEqual([
      { ...verse, start: 2, end: 9 },
      { ...chorus, start: 9.5, end: 10 },
    ]);
    // A sliver of a section, shorter than the shortest section, is dropped.
    expect(clampSections([chorus], { start: 0, end: 9.55 })).toEqual([]);
  });

  it("returns the same array when every section lies inside the range", () => {
    const sections = [verse];
    expect(clampSections(sections, { start: 0, end: 20 })).toBe(sections);
  });
});
