// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { c as createTar, x as extractTar, Header } from "tar";
import { decodeFlac, encodeFlac, matchesQuantized } from "@shared/flac";
import { CONVERTING_PHASE, isLegacySong } from "@shared/song-library";
import { SongLibraryStore } from "./song-library-store";
import { FRAMES, flacSong, legacySong, pcm, readSaved, saveFlacSong, writeLegacyLibrary, type FixtureSong } from "./song-library-fixtures";

let temp: string, root: string, archive: string, store: SongLibraryStore;
const tracks = ["source.flac", "guitar.flac"];
const save = saveFlacSong;
/** The stored track decodes to the original float32 audio, quantized to the fixture's 16 bits (dither included). */
async function expectAudio(libraryRoot: string, id: string, fixture: FixtureSong) {
  for (const [name, channels] of Object.entries(fixture.audio)) {
    const decoded = await decodeFlac(await readSaved(libraryRoot, id, `${name}.flac`));
    expect(matchesQuantized(decoded, channels, 16)).toBe(true);
  }
}
async function unpack() {
  const dir = join(temp, randomUUID());
  await mkdir(dir);
  await extractTar({ cwd: dir, file: archive, strict: true, maxDecompressionRatio: 2048 });
  return dir;
}
async function repack(dir: string, omit?: string, names?: string[]) {
  const index = JSON.parse(await readFile(join(dir, "library.json"), "utf8"));
  const files = [
    "backup-manifest.json",
    "library.json",
    ...Object.values(index.revisions).flatMap((rev) => (names ?? tracks).map((name) => `${rev}/${name}`)),
  ].filter((p) => p !== omit);
  await createTar({ cwd: dir, file: archive, gzip: true, portable: true }, files);
}
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "vltn-backup-test-"));
  root = join(temp, "library");
  archive = join(temp, "portable.tar.gz");
  store = new SongLibraryStore(root);
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});
it("round-trips all audio/settings and repeated playlist entries as new copies without replacing existing songs", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  second.song.title = "Second demo";
  await save(store, first);
  await save(store, second);
  await store.playlists([{ id: randomUUID(), name: "Demo set", songs: [first.song.id, second.song.id, first.song.id] }]);
  const progress: unknown[] = [];
  await store.exportBackup(archive, (p) => progress.push(p));
  expect(progress.length).toBeGreaterThan(1);
  const restored = new SongLibraryStore(join(temp, "restored")),
    existing = await flacSong(3);
  await save(restored, existing);
  expect(await restored.restoreBackup(archive)).toEqual({ songs: 2, playlists: 1 });
  const index = await new SongLibraryStore(join(temp, "restored")).index();
  expect(index.songs[0]).toMatchObject(existing.song);
  expect(index.songs[1]).toMatchObject({ ...first.song, id: index.songs[1].id });
  expect(index.songs[1].id).not.toBe(first.song.id);
  expect(index.playlists[0].songs).toEqual([index.songs[1].id, index.songs[2].id, index.songs[1].id]);
  await expectAudio(join(temp, "restored"), index.songs[1].id, first);
  await restored.restoreBackup(archive);
  expect((await restored.index()).songs).toHaveLength(5);
});
it("writes a version 4 manifest holding the FLAC files", async () => {
  await save(store, await flacSong());
  await store.exportBackup(archive);
  const manifest = JSON.parse(await readFile(join(await unpack(), "backup-manifest.json"), "utf8"));
  expect(manifest.version).toBe(4);
  expect(manifest.files.map((f: { path: string }) => f.path.split("/").pop()).sort()).toEqual(["guitar.flac", "library.json", "source.flac"]);
});
it("restores a version 1 backup of raw float32 files and converts it to FLAC with the same audio", async () => {
  const old = legacySong(4);
  await writeLegacyLibrary(root, [old]);
  await store.exportBackup(archive);
  const dir = await unpack();
  const manifest = JSON.parse(await readFile(join(dir, "backup-manifest.json"), "utf8"));
  manifest.version = 1;
  await writeFile(join(dir, "backup-manifest.json"), JSON.stringify(manifest));
  await repack(dir, undefined, ["source-0.f32", "guitar-0.f32", "guitar-1.f32"]);
  const destination = join(temp, "restored"),
    restored = new SongLibraryStore(destination);
  const phases: string[] = [];
  expect(await restored.restoreBackup(archive, (p) => phases.push(p.phase))).toEqual({ songs: 1, playlists: 0 });
  // The restore converted the song itself, so it opens at once and a later migrate has nothing left to do.
  expect(isLegacySong((await restored.index()).songs[0])).toBe(false);
  expect(phases).toContain(CONVERTING_PHASE);
  expect(await restored.migrate()).toEqual({ converted: 0, failed: 0 });
  const [song] = (await restored.index()).songs;
  expect(song.settings).toEqual(old.song.settings);
  await expectAudio(destination, song.id, old);
});
it("supports empty libraries and highly compressed silent audio", async () => {
  await store.exportBackup(archive);
  const restored = new SongLibraryStore(join(temp, "restored"));
  expect(await restored.restoreBackup(archive)).toEqual({ songs: 0, playlists: 0 });
  const silent = await flacSong(),
    bytes = await (await import("@shared/flac")).encodeFlac({ sampleRate: 44100, channels: [new Float32Array(1024 * 1024)] });
  silent.song.audio = [
    {
      ...silent.song.audio[0],
      channels: 1,
      frames: 1024 * 1024,
      bytes: bytes.length,
      sha256: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  silent.files = { "source.flac": bytes };
  await save(store, silent);
  await store.exportBackup(archive);
  await restored.restoreBackup(archive);
  const [song] = (await restored.index()).songs;
  expect((await readSaved(join(temp, "restored"), song.id, "source.flac")).byteLength).toBe(bytes.length);
});
it("rolls back moved audio if publishing the restored index fails", async () => {
  await save(store, await flacSong());
  await store.exportBackup(archive);
  const destination = join(temp, "restored"),
    restored = new SongLibraryStore(destination),
    existing = await flacSong(3);
  await save(restored, existing);
  const before = (await readdir(destination)).sort();
  const publish = vi.spyOn(restored as unknown as { publish(index: unknown): Promise<void> }, "publish").mockRejectedValueOnce(new Error("Disk full"));
  await expect(restored.restoreBackup(archive)).rejects.toThrow("Disk full");
  publish.mockRestore();
  expect((await readdir(destination)).sort()).toEqual(before);
  expect((await restored.index()).songs).toMatchObject([existing.song]);
  await expectAudio(destination, existing.song.id, existing);
});
it.each(["checksum", "missing", "version", "duplicate", "truncated", "index-digest"])(
  "rejects %s damage without changing the existing library",
  async (damage) => {
    await save(store, await flacSong());
    await store.exportBackup(archive);
    const dir = await unpack();
    const index = JSON.parse(await readFile(join(dir, "library.json"), "utf8")),
      path = `${Object.values(index.revisions)[0]}/source.flac`;
    if (damage === "checksum") await writeFile(join(dir, path), new Uint8Array((await readFile(join(dir, path))).length).fill(1));
    if (damage === "version") {
      const manifest = JSON.parse(await readFile(join(dir, "backup-manifest.json"), "utf8"));
      manifest.version = 5;
      await writeFile(join(dir, "backup-manifest.json"), JSON.stringify(manifest));
    }
    if (damage === "index-digest") {
      // The manifest and the files agree with each other, but not with the digest the index promises for the track.
      index.songs[0].audio[0].sha256 = "0".repeat(64);
      await writeFile(join(dir, "library.json"), JSON.stringify(index));
      const manifest = JSON.parse(await readFile(join(dir, "backup-manifest.json"), "utf8"));
      const entry = manifest.files.find((f: { path: string }) => f.path === "library.json");
      const bytes = await readFile(join(dir, "library.json"));
      entry.bytes = bytes.length;
      entry.sha256 = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(dir, "backup-manifest.json"), JSON.stringify(manifest));
    }
    await repack(dir, damage === "missing" ? path : undefined);
    if (damage === "duplicate") await createTar({ cwd: dir, file: archive, gzip: true }, ["backup-manifest.json", "library.json", "library.json"]);
    if (damage === "truncated") {
      const bytes = await readFile(archive);
      await writeFile(archive, bytes.subarray(0, Math.floor(bytes.length / 2)));
    }
    const destination = join(temp, "restored"),
      restored = new SongLibraryStore(destination),
      existing = await flacSong(3);
    await save(restored, existing);
    await expect(restored.restoreBackup(archive)).rejects.toThrow();
    expect((await restored.index()).songs).toMatchObject([existing.song]);
    await expectAudio(destination, existing.song.id, existing);
    expect((await readdir(destination)).filter((p) => p.startsWith(".restore-"))).toEqual([]);
  },
);
it.each(["traversal", "symlink"])("rejects %s archive entries before writing outside staging", async (kind) => {
  await save(store, await flacSong());
  await store.exportBackup(archive);
  const dir = await unpack();
  const manifest = await readFile(join(dir, "backup-manifest.json")),
    index = await readFile(join(dir, "library.json"));
  const parts: Buffer[] = [];
  const entry = (path: string, body: Buffer, type: "File" | "SymbolicLink" = "File") => {
    const header = new Header({ path, size: body.length, mode: 0o600, type, linkpath: type === "SymbolicLink" ? "../../escape" : "" });
    header.encode();
    parts.push(header.block!, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  };
  entry("backup-manifest.json", manifest);
  entry("library.json", index);
  entry(kind === "traversal" ? "../escape" : "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/source.flac", Buffer.alloc(0), kind === "symlink" ? "SymbolicLink" : "File");
  parts.push(Buffer.alloc(1024));
  await writeFile(archive, gzipSync(Buffer.concat(parts)));
  await expect(store.restoreBackup(archive)).rejects.toThrow();
  await expect(readFile(join(temp, "escape"))).rejects.toThrow();
});
it("does not overwrite an existing backup if a source asset is missing, and refuses exports inside managed storage", async () => {
  const s = await flacSong();
  await save(store, s);
  await store.exportBackup(archive);
  const original = await readFile(archive);
  await expect(store.exportBackup(join(root, "backup.tar.gz"))).rejects.toThrow(/outside/);
  const index = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  await rm(join(root, index.revisions[s.song.id], "source.flac"));
  await expect(store.exportBackup(archive)).rejects.toThrow();
  expect(await readFile(archive)).toEqual(original);
});
it("restoring twice with skip adds no songs or playlists, and playlist entries point at the existing songs", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  second.song.title = "Second demo";
  await save(store, first);
  await save(store, second);
  await store.playlists([{ id: randomUUID(), name: "Demo set", songs: [first.song.id, second.song.id] }]);
  await store.exportBackup(archive);
  const target = new SongLibraryStore(join(temp, "skip-target"));
  expect(await target.inspectBackup(archive)).toEqual({ songs: 2, playlists: 1, duplicates: 0 });
  expect(await target.restoreBackup(archive, undefined, "skip")).toEqual({ songs: 2, playlists: 1, skipped: 0 });
  const once = await target.index();
  expect(await target.inspectBackup(archive)).toEqual({ songs: 2, playlists: 1, duplicates: 2 });
  expect(await target.restoreBackup(archive, undefined, "skip")).toEqual({ songs: 0, playlists: 0, skipped: 2 });
  const twice = await target.index();
  expect(twice.songs.map((s) => s.id)).toEqual(once.songs.map((s) => s.id));
  expect(twice.playlists).toEqual(once.playlists);
  expect(twice.playlists[0].songs).toEqual(once.songs.map((s) => s.id));
  expect(await readdir(join(temp, "skip-target"))).toHaveLength(2 + 1);
});
it("maps playlist entries to existing songs when only some songs are already in the library", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  await save(store, first);
  await save(store, second);
  await store.playlists([{ id: randomUUID(), name: "Both", songs: [first.song.id, second.song.id] }]);
  await store.exportBackup(archive);
  const target = new SongLibraryStore(join(temp, "partial"));
  await save(target, first);
  expect(await target.restoreBackup(archive, undefined, "skip")).toEqual({ songs: 1, playlists: 1, skipped: 1 });
  const index = await target.index();
  expect(index.songs).toHaveLength(2);
  expect(index.playlists[0].songs[0]).toBe(first.song.id);
  expect(index.songs.map((s) => s.id)).toContain(index.playlists[0].songs[1]);
});
it("restores as copies when asked, even if the songs are already there", async () => {
  const first = await flacSong(1);
  await save(store, first);
  await store.exportBackup(archive);
  expect(await store.restoreBackup(archive, undefined, "copy")).toEqual({ songs: 1, playlists: 0 });
  expect((await store.index()).songs).toHaveLength(2);
});
it("rejects a damaged archive when inspecting", async () => {
  await writeFile(archive, "not an archive");
  await expect(store.inspectBackup(archive)).rejects.toThrow();
});

it("backs up and restores a multitrack song with its imported track and that track's settings", async () => {
  const fixture = await flacSong(4),
    click = pcm(1, 9),
    bytes = await encodeFlac({ sampleRate: 44100, channels: click });
  fixture.files["track0.flac"] = bytes;
  const imported = {
    name: "Click",
    sampleRate: 44100,
    frames: FRAMES,
    channels: 1,
    file: "track0.flac",
    codec: "flac" as const,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: "user" as const,
    color: "#ef4444",
    bus: "click" as const,
    transpose: false,
    gain: 0.5,
    muteGroups: [1, 3],
  };
  fixture.song.audio.push(imported);
  await save(store, fixture);
  await store.exportBackup(archive);
  const destination = join(temp, "restored");
  expect(await new SongLibraryStore(destination).restoreBackup(archive)).toEqual({ songs: 1, playlists: 0 });
  const [song] = (await new SongLibraryStore(destination).index()).songs;
  expect(song.audio.find((a) => a.file === "track0.flac")).toEqual(imported);
  expect(song.audio).toHaveLength(3);
  await expectAudio(destination, song.id, { ...fixture, audio: { track0: click } });
});

it("backs up and restores a rendered drum part with its track and the band record that names it", async () => {
  const fixture = await flacSong(4),
    rendered = pcm(1, 5),
    bytes = await encodeFlac({ sampleRate: 44100, channels: rendered });
  fixture.files["track0.flac"] = bytes;
  fixture.song.audio.push({
    name: "Drums (generated)",
    sampleRate: 44100,
    frames: FRAMES,
    channels: 1,
    file: "track0.flac",
    codec: "flac" as const,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: "user" as const,
    bus: "main" as const,
  });
  const options = {
    band: { rendered: { drums: { name: "drums.wav", importedAt: "2026-10-30T10:00:00.000Z" } }, firstNote: { drums: 0.5 } },
    generatedParts: { drums: "track0" },
  };
  fixture.song.settings[":options"] = JSON.stringify(options);
  await save(store, fixture);
  await store.exportBackup(archive);
  const destination = join(temp, "restored");
  expect(await new SongLibraryStore(destination).restoreBackup(archive)).toEqual({ songs: 1, playlists: 0 });
  const [song] = (await new SongLibraryStore(destination).index()).songs;
  expect(song.audio.find((a) => a.file === "track0.flac")).toMatchObject({ name: "Drums (generated)", kind: "user", bus: "main" });
  expect(JSON.parse(song.settings[":options"])).toEqual(options);
  await expectAudio(destination, song.id, { ...fixture, audio: { track0: rendered } });
});
