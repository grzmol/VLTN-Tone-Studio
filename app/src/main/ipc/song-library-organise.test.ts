// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_MAX, LIBRARY_VERSION, emptyLibrary } from "@shared/song-library";
import { SongLibraryStore } from "./song-library-store";
import { flacSong, legacySong, saveFlacSong, writeLegacyLibrary, type FixtureSong } from "./song-library-fixtures";

let root: string, store: SongLibraryStore;
const FOLDER_A = randomUUID(),
  FOLDER_B = randomUUID();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vltn-song-organise-"));
  store = new SongLibraryStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function saved(seed: number): Promise<FixtureSong> {
  const fixture = await flacSong(seed);
  await saveFlacSong(store, fixture);
  return fixture;
}
const songOf = async (id: string) => (await store.index()).songs.find((s) => s.id === id)!;

it("sets song details, and a null clears a field while a missing one is kept", async () => {
  const { song } = await saved(1);
  await store.organise({ kind: "songs", ids: [song.id], patch: { key: "A minor", year: 1999, color: "#3b82f6", keywords: ["encore"], notes: "Capo 2" } });
  expect(await songOf(song.id)).toMatchObject({ key: "A minor", year: 1999, color: "#3b82f6", keywords: ["encore"], notes: "Capo 2" });
  await store.organise({ kind: "songs", ids: [song.id], patch: { year: null, notes: null } });
  const after = await songOf(song.id);
  expect(after.year).toBeUndefined();
  expect(after.notes).toBeUndefined();
  expect(after.key).toBe("A minor");
});

it("applies a batch edit to every selected song in one publish", async () => {
  const a = await saved(1),
    b = await saved(2);
  await store.organise({ kind: "songs", ids: [a.song.id, b.song.id], patch: { keywords: ["ballad"] } });
  expect((await songOf(a.song.id)).keywords).toEqual(["ballad"]);
  expect((await songOf(b.song.id)).keywords).toEqual(["ballad"]);
});

it("refuses an invalid detail and leaves the library exactly as it was", async () => {
  const { song } = await saved(1);
  await expect(store.organise({ kind: "songs", ids: [song.id], patch: { color: "blue" } })).rejects.toThrow("Invalid song details.");
  expect(await songOf(song.id)).not.toHaveProperty("color");
});

it("puts a song in a folder that does not exist, and refuses it", async () => {
  const { song } = await saved(1);
  await expect(store.organise({ kind: "songs", ids: [song.id], patch: { folderId: FOLDER_A } })).rejects.toThrow("A song is in a folder that does not exist.");
});

it("creates nested folders, and deletes only an empty one", async () => {
  const { song } = await saved(1);
  await store.organise({
    kind: "folders",
    folders: [
      { id: FOLDER_A, name: "Gigs" },
      { id: FOLDER_B, name: "Summer", parentId: FOLDER_A },
    ],
  });
  await store.organise({ kind: "songs", ids: [song.id], patch: { folderId: FOLDER_B } });
  await expect(store.organise({ kind: "folders", folders: [{ id: FOLDER_A, name: "Gigs" }] })).rejects.toThrow("Only an empty folder can be deleted.");
  await store.organise({ kind: "songs", ids: [song.id], patch: { folderId: null } });
  await store.organise({ kind: "folders", folders: [{ id: FOLDER_A, name: "Gigs" }] });
  expect((await store.index()).folders).toEqual([{ id: FOLDER_A, name: "Gigs" }]);
});

it("refuses a folder that sits inside itself", async () => {
  await expect(store.organise({ kind: "folders", folders: [{ id: FOLDER_A, name: "Loop", parentId: FOLDER_A }] })).rejects.toThrow(
    "A folder cannot sit inside itself.",
  );
});

it("records a play with its time and set, and bumps the song's play count and last-played time", async () => {
  const { song } = await saved(1);
  const setId = randomUUID();
  await store.organise({ kind: "played", id: song.id, at: "2026-06-01T20:00:00.000Z", setId });
  await store.organise({ kind: "played", id: song.id, at: "2026-06-01T21:00:00.000Z" });
  const index = await store.index();
  expect(index.history).toEqual([
    { songId: song.id, at: "2026-06-01T20:00:00.000Z", setId },
    { songId: song.id, at: "2026-06-01T21:00:00.000Z" },
  ]);
  expect(await songOf(song.id)).toMatchObject({ playCount: 2, lastPlayed: "2026-06-01T21:00:00.000Z" });
});

it("ignores a play for a song that was removed while it played, rather than failing", async () => {
  await expect(store.organise({ kind: "played", id: randomUUID(), at: "2026-06-01T20:00:00.000Z" })).resolves.toBeUndefined();
  expect((await store.index()).history).toEqual([]);
});

it("clears the history, and refuses a history longer than it may hold", async () => {
  const { song } = await saved(1);
  await store.organise({ kind: "played", id: song.id, at: "2026-06-01T20:00:00.000Z" });
  await store.organise({ kind: "history", history: [] });
  expect((await store.index()).history).toEqual([]);
  const long = Array.from({ length: HISTORY_MAX + 1 }, () => ({ songId: song.id, at: "2026-06-01T20:00:00.000Z" }));
  await expect(store.organise({ kind: "history", history: long })).rejects.toThrow("Invalid play history.");
});

it("keeps a song's details, creation time and play count when it is saved again", async () => {
  const { song, ...rest } = await saved(1);
  await store.organise({ kind: "songs", ids: [song.id], patch: { keywords: ["encore"], color: "#22c55e" } });
  await store.organise({ kind: "played", id: song.id, at: "2026-06-01T20:00:00.000Z" });
  const before = await songOf(song.id);
  await saveFlacSong(store, { song, ...rest });
  expect(await songOf(song.id)).toMatchObject({ keywords: ["encore"], color: "#22c55e", playCount: 1, created: before.created });
});

it("sets the tempo from the saved setting, and keeps it in step when the setting changes", async () => {
  const { song } = await saved(1);
  expect((await songOf(song.id)).bpm).toBe(120);
  await store.updateSettings(song.id, { ":bpm": "96" });
  expect((await songOf(song.id)).bpm).toBe(96);
  await store.updateSettings(song.id, { ":bpm": "" });
  expect((await songOf(song.id)).bpm).toBeUndefined();
});

it("takes a song out of a set without leaving a heading on the wrong song", async () => {
  const a = await saved(1),
    b = await saved(2);
  const setId = randomUUID();
  await store.playlists([{ id: randomUUID(), name: "Gig", songs: [a.song.id, b.song.id], sets: [{ id: setId, name: "Set 1", start: 0 }] }]);
  await store.remove(a.song.id);
  const [playlist] = (await store.index()).playlists;
  expect(playlist.songs).toEqual([b.song.id]);
  expect(playlist.sets).toEqual([{ id: setId, name: "Set 1", start: 0 }]);
});

it("drops a song's plays when it is removed from the library", async () => {
  const a = await saved(1),
    b = await saved(2);
  await store.organise({ kind: "played", id: a.song.id, at: "2026-06-01T20:00:00.000Z" });
  await store.organise({ kind: "played", id: b.song.id, at: "2026-06-01T20:05:00.000Z" });
  await store.remove(a.song.id);
  expect((await store.index()).history.map((e) => e.songId)).toEqual([b.song.id]);
});

it("keeps smart playlists as rules, with no entries of their own", async () => {
  const rules = { match: "all" as const, rules: [{ field: "keyword" as const, op: "has" as const, value: "encore" }], sort: "title" as const, limit: 5 };
  await store.playlists([{ id: randomUUID(), name: "Encores", songs: [], smart: rules }]);
  expect((await store.index()).playlists[0].smart).toEqual(rules);
});

it("refuses a smart playlist with a rule that cannot run", async () => {
  const bad = { match: "all" as const, rules: [{ field: "bpm" as const, op: "contains" as unknown as "is", value: "x" }], sort: "title" as const };
  await expect(store.playlists([{ id: randomUUID(), name: "Bad", songs: [], smart: bad }])).rejects.toThrow();
});

it("reads a v3 index as v4 with empty folders and history, and writes it back as v4", async () => {
  const { song } = await saved(1);
  const path = join(root, "library.json");
  const index = JSON.parse(await readFile(path, "utf8"));
  const { folders: _f, history: _h, ...rest } = index;
  await writeFile(
    path,
    JSON.stringify({
      ...rest,
      version: 3,
      songs: rest.songs.map((s: Record<string, unknown>) => ({ ...s, keywords: undefined, playCount: undefined, created: undefined, bpm: undefined })),
    }),
  );
  const read = await new SongLibraryStore(root).index();
  expect(read.version).toBe(LIBRARY_VERSION);
  expect(read.folders).toEqual([]);
  expect(read.history).toEqual([]);
  expect(read.songs.find((s) => s.id === song.id)).toMatchObject({ playCount: 0, keywords: [], bpm: 120 });
  await new SongLibraryStore(root).organise({ kind: "songs", ids: [song.id], patch: { year: 2001 } });
  expect(JSON.parse(await readFile(path, "utf8")).version).toBe(LIBRARY_VERSION);
});

it("upgrades a v1 library with raw audio to v4 without losing a song", async () => {
  const legacy = legacySong(4);
  await writeLegacyLibrary(root, [legacy]);
  const index = await store.index();
  expect(index.version).toBe(LIBRARY_VERSION);
  expect(index.songs.map((s) => s.id)).toEqual([legacy.song.id]);
  expect(index.songs[0]).toMatchObject({ playCount: 0, keywords: [] });
  expect(index.folders).toEqual([]);
});

it("opens an empty library at v4", async () => {
  expect(await store.index()).toEqual(emptyLibrary());
});

it("saves each playlist entry's override with the playlist, and refuses one that does not fit", async () => {
  const a = await saved(1),
    b = await saved(2);
  const id = randomUUID();
  await store.playlists([{ id, name: "Gig", songs: [a.song.id, b.song.id], overrides: [null, { endBehaviour: "loop" }] }]);
  expect((await store.index()).playlists[0].overrides).toEqual([null, { endBehaviour: "loop" }]);
  await expect(store.playlists([{ id, name: "Gig", songs: [a.song.id, b.song.id], overrides: [{ endBehaviour: "repeat" as "loop" }, null] }])).rejects.toThrow(
    "Invalid playlist entry settings.",
  );
  expect((await store.index()).playlists[0].overrides).toEqual([null, { endBehaviour: "loop" }]);
});

it("keeps each remaining entry's override with its song when a song is removed from a playlist", async () => {
  const a = await saved(1),
    b = await saved(2);
  await store.playlists([{ id: randomUUID(), name: "Gig", songs: [a.song.id, b.song.id], overrides: [{ autoplay: false }, { endBehaviour: "stop" }] }]);
  await store.remove(a.song.id);
  const [playlist] = (await store.index()).playlists;
  expect(playlist.songs).toEqual([b.song.id]);
  expect(playlist.overrides).toEqual([{ endBehaviour: "stop" }]);
});
