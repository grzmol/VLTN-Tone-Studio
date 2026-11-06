// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { c as createTar, x as extractTar } from "tar";
import { SongLibraryStore } from "./song-library-store";
import { flacSong, saveFlacSong } from "./song-library-fixtures";

/*
 * Backups in the v4 model: folders and play history are carried across as they are, songs keep the fields a later version stored on
 * them, and an archive written before v4 still restores.
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

it("carries folders, play history and fields it does not know across a restore, and follows history to the new song ids", async () => {
  const store = new SongLibraryStore(join(temp, "library"));
  const fixture = await flacSong(1);
  await saveFlacSong(store, fixture);
  await store.exportBackup(archive);
  const gigs = randomUUID();
  const dir = await unpack();
  await rewriteIndex(
    dir,
    (index) => ({
      ...index,
      folders: [{ id: gigs, name: "Gigs" }],
      history: [{ songId: fixture.song.id, at: "2026-06-01T20:00:00.000Z" }],
      songs: (index.songs as Record<string, unknown>[]).map((song) => ({ ...song, folderId: gigs, keywords: ["encore"] })),
    }),
    4,
  );
  await repack(dir);

  const restored = new SongLibraryStore(join(temp, "restored"));
  expect(await restored.restoreBackup(archive)).toEqual({ songs: 1, playlists: 0 });
  const index = await restored.index();
  const [song] = index.songs;
  expect(index.folders).toEqual([{ id: gigs, name: "Gigs" }]);
  expect(song).toMatchObject({ folderId: gigs, keywords: ["encore"] });
  expect(song.id).not.toBe(fixture.song.id);
  expect(index.history).toEqual([{ songId: song.id, at: "2026-06-01T20:00:00.000Z" }]);
});

it("keeps what a later version stored when a song is saved again", async () => {
  const store = new SongLibraryStore(join(temp, "library"));
  const fixture = await flacSong(1);
  await saveFlacSong(store, { ...fixture, song: { ...fixture.song, ...{ keywords: ["encore"] } } });
  const resaved = { ...fixture.song, title: "Renamed" };
  const token = await store.begin(resaved);
  await store.commit(token);
  expect((await store.index()).songs[0]).toMatchObject({ title: "Renamed", keywords: ["encore"] });
});

it("restores an archive written before v4, with the details it had", async () => {
  const store = new SongLibraryStore(join(temp, "library"));
  const fixture = await flacSong(2);
  await saveFlacSong(store, fixture);
  await store.exportBackup(archive);

  const dir = await unpack();
  await rewriteIndex(
    dir,
    (index) => {
      const { folders: _folders, history: _history, ...rest } = index;
      const songs = (rest.songs as Record<string, unknown>[]).map(({ created: _c, ...song }) => song);
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
  expect(index.songs[0]).toMatchObject({ title: fixture.song.title, created: fixture.song.updated });
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
