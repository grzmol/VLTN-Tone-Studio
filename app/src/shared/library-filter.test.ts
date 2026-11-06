import { describe, expect, it } from "vitest";
import {
  compileRule,
  evaluateSmart,
  folderScope,
  letterIndex,
  ruleProblem,
  searchSongs,
  sortSongs,
  validateSmartRules,
  type FilterRule,
  type SmartRules,
} from "./library-filter";
import type { LibraryFolder, LibrarySong } from "./song-library";

const F_ROOT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const F_CHILD = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const F_GRAND = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const F_OTHER = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const folders: LibraryFolder[] = [
  { id: F_ROOT, name: "Gigs" },
  { id: F_CHILD, name: "Summer", parentId: F_ROOT },
  { id: F_GRAND, name: "Festival", parentId: F_CHILD },
  { id: F_OTHER, name: "Practice" },
];

let counter = 0;
function make(extra: Partial<LibrarySong> = {}): LibrarySong {
  counter++;
  return {
    id: `00000000-0000-0000-0000-${String(counter).padStart(12, "0")}`,
    title: `Song ${counter}`,
    artist: "Band",
    sourceName: "a.wav",
    duration: 200,
    audio: [],
    settings: {},
    updated: "2026-01-01T00:00:00.000Z",
    keywords: [],
    playCount: 0,
    ...extra,
  };
}

const songs = {
  alpha: make({
    title: "Alpha",
    artist: "The Band",
    key: "A minor",
    bpm: 96,
    year: 1999,
    color: "#ff0000",
    keywords: ["ballad"],
    playCount: 5,
    created: "2026-03-01",
    lastPlayed: "2026-06-01",
    folderId: F_GRAND,
    notes: "Capo two",
  }),
  bravo: make({
    title: "Bravo",
    artist: "Other",
    key: "C",
    bpm: 140,
    year: 2010,
    color: "#00ff00",
    keywords: ["encore"],
    playCount: 1,
    created: "2026-02-01",
    folderId: F_OTHER,
    duration: 320,
  }),
  charlie: make({ title: "charlie", artist: "Band", bpm: undefined, year: undefined, playCount: 0, created: "2025-12-01" }),
  delta: make({
    title: "Delta",
    artist: "Band",
    key: "a minor",
    bpm: 120,
    keywords: ["Encore", "ballad"],
    playCount: 9,
    created: "2026-04-01",
    lastPlayed: "2026-05-01",
    folderId: F_CHILD,
  }),
};
const all = [songs.alpha, songs.bravo, songs.charlie, songs.delta];
const ids = (list: LibrarySong[]) => list.map((s) => s.title);

describe("rule validation", () => {
  it.each<[string, FilterRule, boolean]>([
    ["text contains", { field: "title", op: "contains", value: "al" }, true],
    ["empty text", { field: "title", op: "contains", value: "  " }, false],
    ["unknown field", { field: "tempo" as FilterRule["field"], op: "is", value: 1 }, false],
    ["operator a field does not take", { field: "bpm", op: "contains", value: "1" }, false],
    ["number is", { field: "bpm", op: "is", value: 120 }, true],
    ["NaN number", { field: "bpm", op: "lt", value: Number.NaN }, false],
    ["between in order", { field: "year", op: "between", value: [1990, 2000] }, true],
    ["between reversed", { field: "year", op: "between", value: [2000, 1990] }, false],
    ["folder with ids", { field: "folder", op: "in", value: [F_ROOT] }, true],
    ["folder with none", { field: "folder", op: "in", value: [] }, false],
    ["colour", { field: "colour", op: "is", value: "#abcdef" }, true],
    ["colour not hex", { field: "colour", op: "is", value: "red" }, false],
    ["date", { field: "added", op: "before", value: "2026-01-01" }, true],
    ["date not ISO", { field: "added", op: "before", value: "1 Jan 2026" }, false],
    ["never played takes no value", { field: "lastPlayed", op: "never" }, true],
    ["keyword has", { field: "keyword", op: "has", value: "ballad" }, true],
  ])("%s", (_, rule, ok) => {
    expect(ruleProblem(rule) === null).toBe(ok);
  });

  it("refuses a malformed smart playlist when it is saved", () => {
    expect(() => validateSmartRules({ match: "some" as "all", rules: [], sort: "title" })).toThrow("Invalid smart playlist.");
    expect(() => validateSmartRules({ match: "all", rules: [], sort: "rating" as "title" })).toThrow("Invalid sort order.");
    expect(() => validateSmartRules({ match: "all", rules: [], sort: "title", limit: 0 })).toThrow("Invalid song limit.");
    expect(() => validateSmartRules({ match: "all", rules: [{ field: "bpm", op: "is", value: "fast" as unknown as number }], sort: "title" })).toThrow(
      "Enter a number.",
    );
  });
});

describe("rule evaluation, table-driven", () => {
  it.each<[string, FilterRule, string[]]>([
    ["title contains, ignoring case", { field: "title", op: "contains", value: "ALP" }, ["Alpha"]],
    ["artist is, exact apart from case", { field: "artist", op: "is", value: "band" }, ["charlie", "Delta"]],
    ["notes contains", { field: "notes", op: "contains", value: "capo" }, ["Alpha"]],
    ["key is, ignoring case", { field: "key", op: "is", value: "A MINOR" }, ["Alpha", "Delta"]],
    ["keyword has", { field: "keyword", op: "has", value: "encore" }, ["Bravo", "Delta"]],
    ["colour is", { field: "colour", op: "is", value: "#FF0000" }, ["Alpha"]],
    ["bpm is", { field: "bpm", op: "is", value: 96 }, ["Alpha"]],
    ["bpm less than leaves out songs with no bpm", { field: "bpm", op: "lt", value: 130 }, ["Alpha", "Delta"]],
    ["bpm greater than", { field: "bpm", op: "gt", value: 100 }, ["Bravo", "Delta"]],
    ["bpm between is inclusive", { field: "bpm", op: "between", value: [96, 120] }, ["Alpha", "Delta"]],
    ["year between, songs without a year do not match", { field: "year", op: "between", value: [1990, 2020] }, ["Alpha", "Bravo"]],
    ["play count above", { field: "playCount", op: "gt", value: 1 }, ["Alpha", "Delta"]],
    ["play count is zero", { field: "playCount", op: "is", value: 0 }, ["charlie"]],
    ["duration less than", { field: "duration", op: "lt", value: 250 }, ["Alpha", "charlie", "Delta"]],
    ["added before a date", { field: "added", op: "before", value: "2026-02-15" }, ["Bravo", "charlie"]],
    ["added after a date", { field: "added", op: "after", value: "2026-02-15" }, ["Alpha", "Delta"]],
    ["last played before a date", { field: "lastPlayed", op: "before", value: "2026-05-15" }, ["Delta"]],
    ["never played", { field: "lastPlayed", op: "never" }, ["Bravo", "charlie"]],
  ])("%s", (_, rule, expected) => {
    const predicate = compileRule(rule, folders);
    expect(predicate).not.toBeNull();
    expect(ids(all.filter(predicate!))).toEqual(expected);
  });

  it("matches a folder and every folder below it", () => {
    const predicate = compileRule({ field: "folder", op: "in", value: [F_ROOT] }, folders)!;
    expect(ids(all.filter(predicate))).toEqual(["Alpha", "Delta"]);
  });

  it("matches a folder that is in the list, not only its own songs", () => {
    const predicate = compileRule({ field: "folder", op: "in", value: [F_OTHER, F_CHILD] }, folders)!;
    expect(ids(all.filter(predicate))).toEqual(["Alpha", "Bravo", "Delta"]);
  });

  it("returns null for a rule that cannot run, rather than throwing", () => {
    expect(compileRule({ field: "bpm", op: "contains", value: "x" } as unknown as FilterRule, folders)).toBeNull();
  });
});

describe("folder scope", () => {
  it("includes the selected folder and all its descendants, with unlimited depth", () => {
    expect([...folderScope(folders, [F_ROOT])].sort()).toEqual([F_ROOT, F_CHILD, F_GRAND].sort());
  });

  it("stops at a folder that refers back to itself, rather than looping", () => {
    const loop: LibraryFolder[] = [
      { id: F_ROOT, name: "A", parentId: F_CHILD },
      { id: F_CHILD, name: "B", parentId: F_ROOT },
    ];
    expect(folderScope(loop, [F_ROOT]).size).toBe(2);
  });
});

describe("evaluating a smart playlist", () => {
  const base = (extra: Partial<SmartRules> = {}): SmartRules => ({ match: "all", rules: [], sort: "title", ...extra });

  it("matches every song when there are no rules", () => {
    expect(evaluateSmart(all, folders, base()).songs).toHaveLength(4);
  });

  it("requires every rule with match all, and any rule with match any", () => {
    const rules: FilterRule[] = [
      { field: "artist", op: "is", value: "Band" },
      { field: "keyword", op: "has", value: "ballad" },
    ];
    expect(ids(evaluateSmart(all, folders, base({ rules })).songs)).toEqual(["Delta"]);
    expect(ids(evaluateSmart(all, folders, base({ rules, match: "any" })).songs)).toEqual(["Alpha", "charlie", "Delta"]);
  });

  it("sorts and then limits, so a limit keeps the first songs in the sort order", () => {
    const result = evaluateSmart(all, folders, base({ sort: "playCount", limit: 2 }));
    expect(ids(result.songs)).toEqual(["Delta", "Alpha"]);
  });

  it("returns nothing and names the problem when a rule cannot run", () => {
    const result = evaluateSmart(all, folders, base({ rules: [{ field: "bpm", op: "between", value: [200, 100] }] }));
    expect(result.songs).toEqual([]);
    expect(result.problems).toEqual(["Enter a range from the smaller to the larger number."]);
  });

  it("is the same every time it runs on the same songs", () => {
    const smart = base({ rules: [{ field: "bpm", op: "gt", value: 90 }], sort: "bpm" });
    expect(ids(evaluateSmart(all, folders, smart).songs)).toEqual(ids(evaluateSmart(all, folders, smart).songs));
  });
});

describe("sorting, search and the A to Z index", () => {
  it("sorts text A to Z, ignoring case, and breaks ties by title", () => {
    expect(ids(sortSongs(all, "title"))).toEqual(["Alpha", "Bravo", "charlie", "Delta"]);
    expect(ids(sortSongs(all, "artist"))).toEqual(["charlie", "Delta", "Bravo", "Alpha"]);
  });

  it("puts the most recent dates and the highest play counts first, with empty values last", () => {
    expect(ids(sortSongs(all, "added"))).toEqual(["Delta", "Alpha", "Bravo", "charlie"]);
    expect(ids(sortSongs(all, "lastPlayed"))).toEqual(["Alpha", "Delta", "Bravo", "charlie"]);
    expect(ids(sortSongs(all, "playCount"))).toEqual(["Delta", "Alpha", "Bravo", "charlie"]);
  });

  it("sorts a number ascending with empty values last, and can reverse", () => {
    expect(ids(sortSongs(all, "bpm"))).toEqual(["Alpha", "Delta", "Bravo", "charlie"]);
    expect(ids(sortSongs(all, "bpm", true))).toEqual(["charlie", "Bravo", "Delta", "Alpha"]);
  });

  it("does not change the list it was given", () => {
    const copy = [...all];
    sortSongs(all, "title");
    expect(all).toEqual(copy);
  });

  it("searches every word across title, artist, notes and keywords", () => {
    expect(ids(searchSongs(all, "band ballad"))).toEqual(["Alpha", "Delta"]);
    expect(ids(searchSongs(all, "capo"))).toEqual(["Alpha"]);
    expect(ids(searchSongs(all, "   "))).toEqual(ids(all));
  });

  it("gives an A to Z index only for a long list, with non-letters under #", () => {
    expect(letterIndex(all)).toEqual([]);
    const many = Array.from({ length: 22 }, (_, i) => make({ title: i === 0 ? "1 Intro" : i < 12 ? `Alpha ${i}` : `Zeta ${i}` }));
    const sorted = sortSongs(many, "title");
    expect(letterIndex(sorted).map((entry) => entry.letter)).toEqual(["#", "A", "Z"]);
  });
});
