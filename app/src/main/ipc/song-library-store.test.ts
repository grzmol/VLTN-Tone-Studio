// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { decodeFlac, encodeFlac, matchesQuantized } from "@shared/flac";
import { isLegacySong } from "@shared/song-library";
import { SongLibraryStore, V1_BACKUP, libraryFilePath } from "./song-library-store";
import { FRAMES, flacSong, legacySong, pcm, readSaved, saveFlacSong, writeLegacyLibrary, writePlaylists, type FixtureSong } from "./song-library-fixtures";

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
it("round-trips audio and duplicate playlist entries across restart", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  await saveFlacSong(store, first);
  await saveFlacSong(store, second);
  const playlist = { id: randomUUID(), name: "Gig", songs: [second.song.id, first.song.id, second.song.id] };
  await writePlaylists(root, [playlist]);
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
  // The guitar's audio changed, so its new file must be sent. Nothing is sent here, and a file the save did not send is only carried over when it is unchanged.
  const changed = original.song.audio.map((a) => (a.name === "guitar" ? { ...a, sha256: "c".repeat(64) } : a));
  const token = await store.begin({ ...original.song, audio: changed, title: "Replacement" });
  await expect(store.commit(token)).rejects.toThrow("Incomplete song save.");
  await store.abort(token);
  expect((await store.index()).songs[0].title).toBe(original.song.title);
  await expectAudio(original, "source");
});
it("rejects path traversal, wrong lengths, wrong digests and raw PCM saves", async () => {
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
it("removes a deleted song from every playlist", async () => {
  const s = await flacSong();
  await saveFlacSong(store, s);
  await writePlaylists(root, [{ id: randomUUID(), name: "Set", songs: [s.song.id, s.song.id] }]);
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
    expect(Object.keys(await store.audioUrls(song.id)).sort()).toEqual(["guitar", "source"]);
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
it("at start-up, removes unreferenced folders that are empty or partial whatever their age, and keeps the rest", async () => {
  const clock = Date.now();
  store = new SongLibraryStore(root, () => clock);
  const kept = await flacSong(1);
  await saveFlacSong(store, kept);
  const old = new Date(clock - 5 * 24 * 60 * 60 * 1000);
  const empty = randomUUID(),
    partial = randomUUID(),
    mixed = randomUUID(),
    v1 = randomUUID();
  await mkdir(join(root, empty), { recursive: true });
  await mkdir(join(root, partial), { recursive: true });
  await writeFile(join(root, partial, "source.flac.partial"), "x");
  await writeFile(join(root, partial, "chart-1.tmp"), "x");
  await mkdir(join(root, mixed), { recursive: true });
  await writeFile(join(root, mixed, "drums.flac"), "x");
  await mkdir(join(root, v1), { recursive: true });
  await writeFile(join(root, v1, "drums-0.f32"), "x");
  await mkdir(join(root, V1_BACKUP), { recursive: true });
  // A folder with real audio but no revision is an unfinished save: only the age rule removes it, so it is fresh here.
  for (const dir of [empty, partial, v1, V1_BACKUP]) await utimes(join(root, dir), old, old);
  await store.sweep(true);
  const names = await readdir(root);
  expect(names).not.toContain(empty);
  expect(names).not.toContain(partial);
  expect(names).toContain(mixed);
  expect(names).toContain(v1);
  expect(names).toContain(V1_BACKUP);
  const keptRevision = JSON.parse(await readFile(join(root, "library.json"), "utf8")).revisions[kept.song.id];
  expect(names.sort()).toEqual([keptRevision, mixed, v1, V1_BACKUP, "library.json"].sort());
});
it("leaves a v1 song untouched when its audio is damaged and still converts the others", async () => {
  const bad = legacySong(1),
    good = legacySong(2);
  await writeLegacyLibrary(root, [bad, good]);
  const before = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  await writeFile(join(root, before.revisions[bad.song.id], "guitar-1.f32"), new Uint8Array(5));
  expect(await store.migrate()).toEqual({ converted: 1, failed: 1 });
  const index = await store.index();
  expect(isLegacySong(index.songs.find((s) => s.id === bad.song.id)!)).toBe(true);
  expect(isLegacySong(index.songs.find((s) => s.id === good.song.id)!)).toBe(false);
  expect(await readdir(root)).toContain(before.revisions[bad.song.id]);
  expect((await readdir(root)).filter((p) => p.length === 36)).toHaveLength(2);
});
it("keeps settings edited while a song is being converted", async () => {
  const fixture = legacySong();
  await writeLegacyLibrary(root, [fixture]);
  const running = store.migrate();
  await store.updateSettings(fixture.song.id, { ":bpm": "77" });
  await running;
  expect((await store.index()).songs[0].settings[":bpm"]).toBe("77");
});
it("sweeps only true orphans and expired save sessions", async () => {
  let clock = Date.now();
  store = new SongLibraryStore(root, () => clock);
  const kept = await flacSong(1);
  await saveFlacSong(store, kept);
  const revision = JSON.parse(await readFile(join(root, "library.json"), "utf8")).revisions[kept.song.id];
  const old = new Date(clock - 2 * 60 * 60 * 1000),
    orphan = join(root, randomUUID()),
    fresh = join(root, randomUUID()),
    stage = join(root, ".restore-" + randomUUID());
  for (const dir of [orphan, fresh, stage, join(root, revision)]) await mkdir(dir, { recursive: true });
  for (const dir of [orphan, stage, join(root, revision)]) await utimes(dir, old, old);
  // An abandoned save: begun, never committed.
  const abandoned = await flacSong(2),
    token = await store.begin(abandoned.song);
  clock += 2 * 60 * 60 * 1000;
  await utimes(join(root, token), old, old);
  await utimes(fresh, new Date(clock), new Date(clock));
  await store.sweep();
  const names = await readdir(root);
  expect(names).toContain(revision);
  expect(names).toContain(fresh.slice(root.length + 1));
  expect(names).not.toContain(orphan.slice(root.length + 1));
  expect(names).not.toContain(stage.slice(root.length + 1));
  expect(names).not.toContain(token);
  await expect(store.commit(token)).rejects.toThrow("Save session expired.");
});
it("keeps a save session that is still young", async () => {
  const clock = Date.now();
  store = new SongLibraryStore(root, () => clock);
  const fixture = await flacSong(1);
  const token = await store.begin(fixture.song);
  await store.sweep();
  expect(await readdir(root)).toContain(token);
});
it("merges a settings patch, removes emptied entries, and survives a restart", async () => {
  const fixture = await flacSong(1);
  await saveFlacSong(store, fixture);
  await store.updateSettings(fixture.song.id, { ":lyrics": "[00:01] New words", ":options": "" });
  await store.updateSettings(fixture.song.id, { ":bpm": "98" });
  const settings = (await new SongLibraryStore(root).index()).songs[0].settings;
  expect(settings).toEqual({ "": fixture.song.settings[""], ":lyrics": "[00:01] New words", ":bpm": "98" });
});
it("rejects settings patches for unknown songs, unknown keys and non-string values", async () => {
  const fixture = await flacSong(1);
  await saveFlacSong(store, fixture);
  await expect(store.updateSettings(randomUUID(), { ":bpm": "90" })).rejects.toThrow("Saved song not found.");
  await expect(store.updateSettings(fixture.song.id, { ":other": "x" })).rejects.toThrow("Invalid song settings.");
  await expect(store.updateSettings(fixture.song.id, { ":bpm": 90 as unknown as string })).rejects.toThrow("Invalid song settings.");
  await expect(store.updateSettings("../x", { ":bpm": "90" })).rejects.toThrow("Invalid song settings.");
});

/** The revision folder the index currently points at for a song. */
async function currentRevision(songId: string): Promise<string> {
  return JSON.parse(await readFile(join(root, "library.json"), "utf8")).revisions[songId];
}
it("carries files the save did not send into the new revision by hard link, and removes the old revision", async () => {
  const original = await flacSong(1);
  await saveFlacSong(store, original);
  const oldRevision = await currentRevision(original.song.id);
  const inodes: Record<string, number> = {};
  for (const name of Object.keys(original.files)) inodes[name] = (await stat(join(root, oldRevision, name))).ino;
  const token = await store.begin({ ...original.song, title: "Renamed" });
  await store.commit(token);
  const revision = await currentRevision(original.song.id);
  expect(revision).not.toBe(oldRevision);
  for (const [name, bytes] of Object.entries(original.files)) {
    expect(new Uint8Array(await readFile(join(root, revision, name)))).toEqual(bytes);
    expect((await stat(join(root, revision, name))).ino).toBe(inodes[name]);
  }
  await expect(stat(join(root, oldRevision))).rejects.toThrow();
  expect((await store.index()).songs[0].title).toBe("Renamed");
  await expectAudio(original, "guitar");
});
it("fails the save when a carried file is missing or changed, and keeps the last complete revision", async () => {
  const original = await flacSong(2);
  await saveFlacSong(store, original);
  const oldRevision = await currentRevision(original.song.id);
  const missing = await store.begin({ ...original.song, title: "Missing" });
  await rm(join(root, oldRevision, "guitar.flac"));
  await expect(store.commit(missing)).rejects.toThrow("Incomplete song save.");
  await store.abort(missing);
  await saveFlacSong(store, original);
  const changed = await store.begin({ ...original.song, title: "Changed" });
  const current = await currentRevision(original.song.id);
  await writeFile(join(root, current, "guitar.flac"), new Uint8Array(original.files["guitar.flac"].length).fill(7));
  await expect(store.commit(changed)).rejects.toThrow("Incomplete song save.");
  await store.abort(changed);
  expect((await store.index()).songs[0].title).toBe(original.song.title);
});
it("keeps a 24-bit stem 24-bit when a settings-only save carries its file over", async () => {
  const fixture = await flacSong(3);
  const deep = await encodeFlac({ sampleRate: 44100, channels: fixture.audio.guitar, bits: 24 });
  fixture.files["guitar.flac"] = deep;
  const entry = fixture.song.audio.find((a) => a.name === "guitar")!;
  entry.bytes = deep.length;
  entry.sha256 = createHash("sha256").update(deep).digest("hex");
  await saveFlacSong(store, fixture);
  const token = await store.begin({ ...fixture.song, settings: { ...fixture.song.settings, ":bpm": "96" } });
  await store.commit(token);
  const stored = await readSaved(root, fixture.song.id, "guitar.flac");
  expect(stored).toEqual(deep);
  expect((await decodeFlac(stored)).bits).toBe(24);
});

it("carries files that are not tracks into the new revision, so a re-save keeps them", async () => {
  const original = await flacSong(1);
  await saveFlacSong(store, original);
  await writeFile(join(root, await currentRevision(original.song.id), "chart.pdf"), "pdf bytes");
  const token = await store.begin({ ...original.song, title: "Renamed" });
  await store.commit(token);
  expect(await readFile(join(root, await currentRevision(original.song.id), "chart.pdf"), "utf8")).toBe("pdf bytes");
});
