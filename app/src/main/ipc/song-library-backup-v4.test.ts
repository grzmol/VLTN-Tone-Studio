// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { c as createTar, x as extractTar } from "tar";
import { SongLibraryStore } from "./song-library-store";
import { flacSong, saveFlacSong, type FixtureSong } from "./song-library-fixtures";

/*
 * Backups in the v4 model: the metadata, folders, play history and smart playlists round-trip, copies get new folder ids, and an archive
 * written before v4 still restores.
 */
let temp: string, archive: string;
const TRACKS = ["source.flac", "guitar.flac"];
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "vltn-backup-v4-"));
  archive = join(temp, "portable.tar.gz");
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function unpack(): Promise<string> {
  const dir = join(temp, randomUUID());
  await mkdir(dir);
  await extractTar({ cwd: dir, file: archive, strict: true, maxDecompressionRatio: 2048 });
  return dir;
}
async function repack(dir: string): Promise<void> {
  const index = JSON.parse(await readFile(join(dir, "library.json"), "utf8"));
  const files = ["backup-manifest.json", "library.json", ...Object.values<string>(index.revisions).flatMap((rev) => TRACKS.map((name) => `${rev}/${name}`))];
  await createTar({ cwd: dir, file: archive, gzip: true, portable: true }, files);
}
/** Rewrites `library.json` in an unpacked archive and updates the manifest so the archive still checks out. */
async function rewriteIndex(dir: string, next: (index: Record<string, unknown>) => Record<string, unknown>, version: number): Promise<void> {
  const body = Buffer.from(JSON.stringify(next(JSON.parse(await readFile(join(dir, "library.json"), "utf8")))));
  await writeFile(join(dir, "library.json"), body);
  const manifestPath = join(dir, "backup-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  const entry = manifest.files.find((f: { path: string }) => f.path === "library.json");
  entry.bytes = body.length;
  entry.sha256 = createHash("sha256").update(body).digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest));
}

it("round-trips song details, folders, history and smart rules, with new folder ids on a copy", async () => {
  const store = new SongLibraryStore(join(temp, "library"));
  const fixture = await flacSong(1);
  await saveFlacSong(store, fixture);
  const gigs = randomUUID(),
    summer = randomUUID();
  await store.organise({
    kind: "folders",
    folders: [
      { id: gigs, name: "Gigs" },
      { id: summer, name: "Summer", parentId: gigs },
    ],
  });
  await store.organise({ kind: "songs", ids: [fixture.song.id], patch: { folderId: summer, keywords: ["encore"], color: "#22c55e" } });
  await store.organise({ kind: "played", id: fixture.song.id, at: "2026-06-01T20:00:00.000Z" });
  await store.playlists([
    { id: randomUUID(), name: "Summer", songs: [], smart: { match: "all", rules: [{ field: "folder", op: "in", value: [gigs] }], sort: "title" } },
    { id: randomUUID(), name: "Gig", songs: [fixture.song.id], overrides: [{ autoplay: false, endBehaviour: "stop" }] },
  ]);
  await store.exportBackup(archive);

  const restored = new SongLibraryStore(join(temp, "restored"));
  expect(await restored.restoreBackup(archive)).toEqual({ songs: 1, playlists: 2 });
  const index = await restored.index();
  const [song] = index.songs;
  const newGigs = index.folders.find((f) => f.name === "Gigs")!,
    newSummer = index.folders.find((f) => f.name === "Summer")!;
  expect(newGigs.id).not.toBe(gigs);
  expect(newSummer.parentId).toBe(newGigs.id);
  expect(song.folderId).toBe(newSummer.id);
  expect(song).toMatchObject({ keywords: ["encore"], color: "#22c55e", playCount: 1, lastPlayed: "2026-06-01T20:00:00.000Z" });
  expect(index.history).toEqual([{ songId: song.id, at: "2026-06-01T20:00:00.000Z" }]);
  expect(index.playlists[0].smart!.rules[0].value).toEqual([newGigs.id]);
  expect(index.playlists.find((p) => p.name === "Gig")!.overrides).toEqual([{ autoplay: false, endBehaviour: "stop" }]);
});

it("in skip mode keeps the songs already in the library and brings back only the folders a restored song uses", async () => {
  const store = new SongLibraryStore(join(temp, "library"));
  const fixture: FixtureSong = await flacSong(1);
  await saveFlacSong(store, fixture);
  const gigs = randomUUID();
  await store.organise({ kind: "folders", folders: [{ id: gigs, name: "Gigs" }] });
  await store.organise({ kind: "songs", ids: [fixture.song.id], patch: { folderId: gigs } });
  await store.organise({ kind: "played", id: fixture.song.id, at: "2026-06-01T20:00:00.000Z" });
  await store.exportBackup(archive);

  const existing = new SongLibraryStore(join(temp, "existing"));
  await saveFlacSong(existing, await flacSong(1));
  const result = await existing.restoreBackup(archive, undefined, "skip");
  expect(result).toEqual({ songs: 0, playlists: 0, skipped: 1 });
  const index = await existing.index();
  expect(index.folders).toEqual([]);
  expect(index.history).toEqual([{ songId: index.songs[0].id, at: "2026-06-01T20:00:00.000Z" }]);
});

it("restores an archive written before v4, with the metadata it had and the new fields empty", async () => {
  const store = new SongLibraryStore(join(temp, "library"));
  const fixture = await flacSong(2);
  await saveFlacSong(store, fixture);
  await store.exportBackup(archive);

  const dir = await unpack();
  await rewriteIndex(
    dir,
    (index) => {
      const { folders: _folders, history: _history, ...rest } = index;
      const songs = (rest.songs as Record<string, unknown>[]).map(
        ({ bpm: _b, created: _c, keywords: _k, playCount: _p, lastPlayed: _l, folderId: _f, ...song }) => song,
      );
      return { ...rest, version: 3, songs };
    },
    3,
  );
  await repack(dir);

  const restored = new SongLibraryStore(join(temp, "from-v3"));
  expect(await restored.restoreBackup(archive)).toEqual({ songs: 1, playlists: 0 });
  const index = await restored.index();
  expect(index.version).toBe(4);
  expect(index.folders).toEqual([]);
  expect(index.songs[0]).toMatchObject({ title: fixture.song.title, playCount: 0, keywords: [], bpm: 120 });
  expect(index.songs[0].audio.map((a) => a.kind)).toEqual(["source", "stem"]);
});

it("refuses an archive from a version this app does not know", async () => {
  const store = new SongLibraryStore(join(temp, "library"));
  await saveFlacSong(store, await flacSong(3));
  await store.exportBackup(archive);
  const dir = await unpack();
  await rewriteIndex(dir, (index) => index, 9);
  await repack(dir);
  await expect(new SongLibraryStore(join(temp, "nine")).restoreBackup(archive)).rejects.toThrow("Invalid or damaged song-library backup.");
});
