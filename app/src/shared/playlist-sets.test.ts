import { describe, expect, it } from "vitest";
import type { LibrarySong, Playlist, PlaylistSet } from "./song-library";
import { addSet, blockSummaries, deleteSet, moveEntry, normaliseSets, removeEntry, renameSet } from "./playlist-sets";

const song = (id: string, duration: number): LibrarySong => ({
  id,
  title: id,
  artist: "",
  sourceName: "",
  duration,
  audio: [],
  settings: {},
  updated: "",
});
const S = (n: number) => `0000000${n}-0000-0000-0000-000000000000`;
const songs = [song(S(1), 100), song(S(2), 200), song(S(3), 300), song(S(4), 50)];
const playlist = (sets?: PlaylistSet[]): Playlist => ({ id: S(9), name: "Gig", songs: songs.map((s) => s.id), sets });
const set = (n: number, name: string, start: number): PlaylistSet => ({ id: S(n), name, start });

describe("blocks and their totals", () => {
  it("treats a playlist with no sets as one block", () => {
    expect(blockSummaries(playlist(), songs)).toEqual([{ set: null, name: "", start: 0, end: 4, count: 4, seconds: 650 }]);
  });

  it("gives each set its count and running time, with the entries before the first set as their own block", () => {
    const blocks = blockSummaries(playlist([set(5, "Set 1", 1), set(6, "Encore", 3)]), songs);
    expect(blocks.map((b) => [b.name, b.start, b.end, b.count, b.seconds])).toEqual([
      ["", 0, 1, 1, 100],
      ["Set 1", 1, 3, 2, 500],
      ["Encore", 3, 4, 1, 50],
    ]);
  });

  it("sums the time it is given for each song, so a set can show trimmed running time", () => {
    const blocks = blockSummaries(playlist([set(5, "Set 1", 0)]), songs, (song) => song.duration / 2);
    expect(blocks[0].seconds).toBe(325);
  });

  it("counts a song that is no longer in the library as zero seconds, not an error", () => {
    const blocks = blockSummaries(playlist([set(5, "Set 1", 0)]), songs.slice(0, 2));
    expect(blocks[0].seconds).toBe(300);
  });
});

describe("keeping set starts with the entries", () => {
  it("moves a set start down when an entry before it is removed", () => {
    expect(removeEntry(playlist([set(5, "Set 1", 2)]), 0).sets).toEqual([set(5, "Set 1", 1)]);
  });

  it("leaves a set start alone when an entry after it is removed", () => {
    expect(removeEntry(playlist([set(5, "Set 1", 1)]), 3).sets).toEqual([set(5, "Set 1", 1)]);
  });

  it("drops an empty set when its only song is removed, so no header names the wrong block", () => {
    const result = removeEntry(playlist([set(5, "Set 1", 0), set(6, "Encore", 1)]), 0);
    expect(result.sets).toEqual([set(6, "Encore", 0)]);
  });

  it("drops a set that pointed past the end after its songs are gone", () => {
    expect(removeEntry({ id: S(9), name: "x", songs: [S(1)], sets: [set(5, "Only", 0)] }, 0).sets).toEqual([]);
  });

  it("keeps set headers at their positions when an entry moves", () => {
    const moved = moveEntry(playlist([set(5, "Set 1", 1)]), 0, 3);
    expect(moved.songs).toEqual([S(2), S(3), S(4), S(1)]);
    expect(moved.sets).toEqual([set(5, "Set 1", 1)]);
  });
});

describe("editing sets", () => {
  it("adds a set before an entry, keeping the sets in order", () => {
    const result = addSet(playlist([set(6, "Encore", 3)]), " Set 1 ", 1, S(5));
    expect(result).toEqual({ ok: true, sets: [set(5, "Set 1", 1), set(6, "Encore", 3)] });
  });

  it("refuses a second set on the same entry, or one past the end", () => {
    expect(addSet(playlist([set(5, "Set 1", 1)]), "Other", 1, S(7))).toEqual({ ok: false, reason: "A set already starts there." });
    expect(addSet(playlist(), "Late", 4, S(7))).toEqual({ ok: false, reason: "A set starts on a song in the playlist." });
  });

  it("renames a set, and refuses a blank name rather than leaving the heading empty", () => {
    expect(renameSet([set(5, "Set 1", 0)], S(5), " Main ")).toEqual([set(5, "Main", 0)]);
    expect(renameSet([set(5, "Set 1", 0)], S(5), "  ")).toEqual([set(5, "Set 1", 0)]);
  });

  it("deletes a set's header only", () => {
    expect(deleteSet([set(5, "Set 1", 0), set(6, "Encore", 2)], S(5))).toEqual([set(6, "Encore", 2)]);
  });

  it("normalises starts that fall off the end or repeat", () => {
    expect(normaliseSets([set(5, "A", 9), set(6, "B", 1), set(7, "C", 1)], 4)).toEqual([set(7, "C", 1)]);
  });
});

describe("entry overrides move with their songs", () => {
  const withOverrides = (overrides: (import("./entry-overrides").EntryOverride | null)[]): Playlist => ({ ...playlist(), overrides });

  it("removes an entry's override with the entry", () => {
    const stop = { endBehaviour: "stop" as const };
    expect(removeEntry(withOverrides([null, stop, null, null]), 1).overrides).toEqual([null, null, null]);
  });

  it("moves an override with the entry it belongs to", () => {
    const loop = { endBehaviour: "loop" as const };
    expect(moveEntry(withOverrides([null, null, loop, null]), 2, 0).overrides).toEqual([loop, null, null, null]);
  });

  it("leaves a playlist with no overrides with none", () => {
    expect(removeEntry(playlist(), 0).overrides).toBeUndefined();
    expect(moveEntry(playlist(), 0, 1).overrides).toBeUndefined();
  });
});
