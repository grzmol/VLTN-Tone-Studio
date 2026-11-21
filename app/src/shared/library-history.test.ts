import { describe, expect, it } from "vitest";
import { HISTORY_MAX, type HistoryEntry, type LibrarySong } from "./song-library";
import { appendPlay, countsAsPlayed, playsSince, songsFromHistory, withoutSong } from "./library-history";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const GONE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const song = (id: string): LibrarySong => ({ id, title: id, artist: "", sourceName: "", duration: 1, audio: [], settings: {}, updated: "" });

describe("counting a play", () => {
  it.each([
    [0, 200, false],
    [99.9, 200, false],
    [100, 200, true],
    [200, 200, true],
    [50, 0, false],
    [Number.NaN, 200, false],
  ])("position %s of %s counts: %s", (position, duration, counted) => {
    expect(countsAsPlayed(position, duration)).toBe(counted);
  });
});

describe("the bounded history", () => {
  it("adds a play as the newest entry", () => {
    const history = appendPlay([{ songId: A, at: "2026-01-01T00:00:00.000Z" }], { songId: B, at: "2026-01-02T00:00:00.000Z" });
    expect(history.map((e) => e.songId)).toEqual([A, B]);
  });

  it("keeps only the newest HISTORY_MAX plays", () => {
    let history: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_MAX + 25; i++) history = appendPlay(history, { songId: A, at: new Date(i * 1000).toISOString() });
    expect(history).toHaveLength(HISTORY_MAX);
    expect(history[0].at).toBe(new Date(25 * 1000).toISOString());
  });

  it("does not change the history it was given", () => {
    const before: HistoryEntry[] = [{ songId: A, at: "2026-01-01T00:00:00.000Z" }];
    appendPlay(before, { songId: B, at: "2026-01-02T00:00:00.000Z" });
    expect(before).toHaveLength(1);
  });
});

describe("plays since a date", () => {
  const history: HistoryEntry[] = [
    { songId: A, at: "2026-01-01T10:00:00.000Z" },
    { songId: B, at: "2026-02-01T10:00:00.000Z", setId: "s1" },
    { songId: A, at: "2026-03-01T10:00:00.000Z" },
  ];

  it("keeps the plays from the date on, in play order", () => {
    expect(playsSince(history, "2026-02-01").map((e) => e.songId)).toEqual([B, A]);
  });

  it("gives nothing for a date that cannot be read, rather than every play", () => {
    expect(playsSince(history, "soon")).toEqual([]);
  });

  it("makes a playlist of the songs played since the date, keeping repeats and skipping songs that are gone", () => {
    const songs = [song(A), song(B)];
    const withGone = [...history, { songId: GONE, at: "2026-03-02T00:00:00.000Z" }];
    expect(songsFromHistory(songs, withGone, "2026-02-01")).toEqual([B, A]);
    expect(songsFromHistory(songs, history, "2026-01-01")).toEqual([A, B, A]);
  });

  it("removes a song's plays when the song is removed", () => {
    expect(withoutSong(history, A).map((e) => e.songId)).toEqual([B]);
  });
});
