// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { decodeFlac, encodeFlac, matchesQuantized } from "@shared/flac";
import { isLegacySong } from "@shared/song-library";
import { SongLibraryStore, V1_BACKUP, libraryFilePath } from "./song-library-store";
import { FRAMES, flacSong, legacySong, pcm, readSaved, saveFlacSong, writeLegacyLibrary, type FixtureSong } from "./song-library-fixtures";

let root: string, store: SongLibraryStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vltn-song-library-test-"));
  store = new SongLibraryStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
/** The decoded track must equal the stored float32 audio quantized to the fixture's 16 bits (dither included). */
async function expectAudio(fixture: FixtureSong, name: string) {
  const decoded = await decodeFlac(await readSaved(root, fixture.song.id, `${name}.flac`));
  expect(decoded.channels).toHaveLength(fixture.audio[name].length);
  expect(matchesQuantized(decoded, fixture.audio[name], 16)).toBe(true);
}
it("round-trips audio, charts and duplicate playlist entries across restart", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  await saveFlacSong(store, first);
  await saveFlacSong(store, second);
  const playlist = { id: randomUUID(), name: "Gig", songs: [second.song.id, first.song.id, second.song.id] };
  await store.playlists([playlist]);
  store = new SongLibraryStore(root);
  expect((await store.index()).playlists).toEqual([playlist]);
  expect((await store.index()).songs[0]).toMatchObject(first.song);
  await expectAudio(first, "source");
  await expectAudio(first, "guitar");
  await store.updateSettings(first.song.id, { ":bpm": "90" });
  expect((await new SongLibraryStore(root).index()).songs[0].settings).toEqual({ ...first.song.settings, ":bpm": "90" });
});
it("writes a v2 index and hands out protocol URLs instead of audio bytes", async () => {
  const fixture = await flacSong();
  await saveFlacSong(store, fixture);
  const index = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  expect(index.version).toBe(4);
  const urls = await store.audioUrls(fixture.song.id);
  expect(Object.keys(urls).sort()).toEqual(["guitar", "source"]);
  expect(urls.source).toBe(`app://library/${index.revisions[fixture.song.id]}/source.flac`);
  expect(libraryFilePath(root, urls.source)).toBe(join(root, index.revisions[fixture.song.id], "source.flac"));
});
it("keeps the last complete revision after an incomplete replacement", async () => {
  const original = await flacSong();
  await saveFlacSong(store, original);
  const token = await store.begin({ ...original.song, title: "Replacement" });
  await expect(store.commit(token)).rejects.toThrow();
  await store.abort(token);
  expect((await store.index()).songs[0].title).toBe(original.song.title);
  await expectAudio(original, "source");
});
it("rejects path traversal, wrong lengths, wrong digests, raw PCM saves and dangling playlist references", async () => {
  const { song, files } = await flacSong(),
    token = await store.begin(song);
  await expect(store.write(token, "../escape", files["source.flac"])).rejects.toThrow();
  await expect(store.write(token, "source-0.f32", files["source.flac"])).rejects.toThrow();
  await expect(store.write(token, "source.flac", new Uint8Array(3))).rejects.toThrow();
  await expect(
    store.write(
      token,
      "source.flac",
      files["source.flac"].map((b) => b ^ 1),
    ),
  ).rejects.toThrow();
  await expect(store.begin({ ...song, id: "../escape" })).rejects.toThrow();
  await expect(store.begin(legacySong().song)).rejects.toThrow();
  await expect(store.begin({ ...song, audio: [{ ...song.audio[0], file: "../x.flac" }] })).rejects.toThrow();
  await expect(store.playlists([{ id: randomUUID(), name: "Missing", songs: [song.id] }])).rejects.toThrow();
  await store.abort(token);
});
it("serves only exact revision/track.flac URLs", () => {
  const rev = randomUUID();
  expect(libraryFilePath(root, `app://library/${rev}/vocals.flac`)).toBe(join(root, rev, "vocals.flac"));
  for (const bad of [
    `app://library/${rev}/..%2Flibrary.json`,
    `app://library/${rev}/vocals-0.f32`,
    `app://library/${rev}/other.flac/extra`,
    `app://library/${rev}/notatrack.flac`,
    `app://library/not-a-uuid/vocals.flac`,
    `app://bundle/${rev}/vocals.flac`,
  ])
    expect(libraryFilePath(root, bad)).toBeNull();
});
it("deletes a playlist without deleting songs and removes deleted songs from every playlist", async () => {
  const s = await flacSong();
  await saveFlacSong(store, s);
  await store.playlists([{ id: randomUUID(), name: "Set", songs: [s.song.id, s.song.id] }]);
  await store.playlists([]);
  expect((await store.index()).songs).toHaveLength(1);
  await store.playlists([{ id: randomUUID(), name: "Set", songs: [s.song.id, s.song.id] }]);
  await store.remove(s.song.id);
  expect((await store.index()).songs).toEqual([]);
  expect((await store.index()).playlists[0].songs).toEqual([]);
  await expect(store.audioUrls(s.song.id)).rejects.toThrow();
});

it("moves a removed song's folder into the library's .trash rather than deleting it", async () => {
  const s = await flacSong();
  await saveFlacSong(store, s);
  const revision = JSON.parse(await readFile(join(root, "library.json"), "utf8")).revisions[s.song.id];
  await store.remove(s.song.id);
  expect(await readdir(root)).toEqual(expect.arrayContaining([".trash"]));
  expect(await readdir(root)).not.toContain(revision);
  const [entry] = await readdir(join(root, ".trash"));
  expect(entry.endsWith(`-${revision}`)).toBe(true);
  expect((await readdir(join(root, ".trash", entry))).some((f) => f.endsWith(".flac"))).toBe(true);
});

it("preflights saved files without loading them, deduplicates IDs and reports missing or truncated audio", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  await saveFlacSong(store, first);
  await saveFlacSong(store, second);
  const index = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  await writeFile(join(root, index.revisions[first.song.id], "source.flac"), new Uint8Array(1));
  await rm(join(root, index.revisions[second.song.id], "source.flac"));
  const missing = randomUUID();
  const result = await store.preflight([first.song.id, second.song.id, first.song.id, missing]);
  expect(result).toHaveLength(3);
  expect(result[0].errors[0]).toContain("invalid size");
  expect(result[1].errors[0]).toContain("missing or inaccessible");
  expect(result[2].errors).toEqual(["Song is missing from the library."]);
  await expect(store.preflight(["../outside"])).rejects.toThrow("Invalid playlist");
});
it("returns a clean saved snapshot for intact audio", async () => {
  const s = await flacSong();
  await saveFlacSong(store, s);
  expect(await store.preflight([s.song.id])).toMatchObject([{ id: s.song.id, song: s.song, errors: [] }]);
});

it("migrates a v1 library to FLAC with the same audio and settings, and keeps the v1 copy in v1-backup", async () => {
  const first = legacySong(1),
    second = legacySong(2);
  await writeLegacyLibrary(root, [first, second]);
  const before = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  expect((await store.index()).songs.every(isLegacySong)).toBe(true);
  await expect(store.audioUrls(first.song.id)).rejects.toThrow(/converted/);
  const progress: string[] = [];
  expect(await store.migrate((p) => progress.push(`${p.phase} ${p.completed}/${p.total}`))).toEqual({ converted: 2, failed: 0 });
  expect(progress[0]).toBe("Converting saved songs 0/2");
  const index = await new SongLibraryStore(root).index();
  expect(index.version).toBe(4);
  for (const fixture of [first, second]) {
    const song = index.songs.find((s) => s.id === fixture.song.id)!;
    expect(isLegacySong(song)).toBe(false);
    expect(song.settings).toEqual(fixture.song.settings);
    expect(song.title).toBe(fixture.song.title);
    await expectAudio(fixture, "source");
    await expectAudio(fixture, "guitar");
    expect((await store.preflight([song.id]))[0].errors).toEqual([]);
  }
  const revisions = Object.values(before.revisions) as string[];
  for (const revision of revisions) expect(await readdir(root)).not.toContain(revision);
  // The v1 folders moved under their own names, beside the index they came from, so the old library can be put back.
  const kept = await readdir(join(root, V1_BACKUP));
  expect(kept).toEqual(expect.arrayContaining([...revisions, "library.json", "README.txt"]));
  expect(JSON.parse(await readFile(join(root, V1_BACKUP, "library.json"), "utf8"))).toEqual(before);
  expect(await readFile(join(root, V1_BACKUP, "README.txt"), "utf8")).toMatch(/How to go back|To go back/);
  expect(await store.migrate()).toEqual({ converted: 0, failed: 0 });
});
it("keeps the v1 index from the first conversion when a later run resumes", async () => {
  const first = legacySong(1);
  await writeLegacyLibrary(root, [first]);
  const original = await readFile(join(root, "library.json"), "utf8");
  await store.migrate();
  await writeFile(join(root, V1_BACKUP, "library.json"), "kept");
  await writeLegacyLibrary(root, [legacySong(2)]);
  await store.migrate();
  expect(await readFile(join(root, V1_BACKUP, "library.json"), "utf8")).toBe("kept");
  expect(original).toContain('"version":1');
});
it("reports the v1 copy's size and moves it to the Trash when asked", async () => {
  const moved: string[] = [];
  const trash = async (path: string) => {
    moved.push(path);
    await rm(path, { recursive: true, force: true });
  };
  store = new SongLibraryStore(root, Date.now, trash);
  expect(await store.v1BackupBytes()).toBeNull();
  await writeLegacyLibrary(root, [legacySong(1)]);
  await store.migrate();
  const bytes = await store.v1BackupBytes();
  expect(bytes).toBeGreaterThan(0);
  await store.removeV1Backup();
  expect(moved).toEqual([join(root, V1_BACKUP)]);
  expect(await store.v1BackupBytes()).toBeNull();
  expect((await store.index()).songs).toHaveLength(1);
});
