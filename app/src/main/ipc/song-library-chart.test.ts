// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { c as createTar, x as extractTar } from "tar";
import { CHART_ANNOTATIONS_MAX_BYTES, CHART_PDF_MAX_BYTES, isPdfBytes } from "@shared/song-library";
import { emptyAnnotations, type ChartAnnotations } from "@shared/chart-annotations";
import { SongLibraryStore, libraryFilePath } from "./song-library-store";
import { flacSong, readSaved, saveFlacSong, type FixtureSong } from "./song-library-fixtures";

/** A minimal PDF header and body. The store checks the header and the size; reading the pages is the reader's job. */
const pdf = (text = "chart") => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const annotated = (text = "Verse 1"): ChartAnnotations => ({
  version: 1,
  pages: {
    "1": [
      { kind: "pen", colour: "#111111", width: 0.0025, points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.2 }] },
      { kind: "text", colour: "#38bdf8", x: 0.5, y: 0.5, text },
    ],
  },
  turns: [12.5, 40],
});

let temp: string, root: string, archive: string, store: SongLibraryStore;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "vltn-chart-test-"));
  root = join(temp, "library");
  archive = join(temp, "portable.tar.gz");
  store = new SongLibraryStore(root);
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function savedSong(): Promise<FixtureSong> {
  const fixture = await flacSong();
  await saveFlacSong(store, fixture);
  return fixture;
}
async function unpack(): Promise<string> {
  const dir = join(temp, randomUUID());
  await mkdir(dir);
  await extractTar({ cwd: dir, file: archive, strict: true, maxDecompressionRatio: 2048 });
  return dir;
}

it("recognises a PDF by its header and refuses anything else", () => {
  expect(isPdfBytes(pdf())).toBe(true);
  expect(isPdfBytes(new TextEncoder().encode("hello"))).toBe(false);
  expect(isPdfBytes(new Uint8Array(0))).toBe(false);
});

it("attaches a PDF, keeps it across a restart, and serves it through the library protocol only", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf("lead sheet"));
  const restarted = new SongLibraryStore(root);
  const index = await restarted.index();
  expect(index.songs[0].chart).toMatchObject({ bytes: pdf("lead sheet").length });
  const urls = await restarted.chartUrls(song.song.id);
  const rev = JSON.parse(await readFile(join(root, "library.json"), "utf8")).revisions[song.song.id];
  expect(urls).toEqual({ pdf: `app://library/${rev}/chart.pdf` });
  expect(new TextDecoder().decode(await readSaved(root, song.song.id, "chart.pdf"))).toContain("lead sheet");
  expect(libraryFilePath(root, `app://library/${rev}/chart.pdf`)).toBe(join(root, rev, "chart.pdf"));
  expect(libraryFilePath(root, `app://library/${rev}/chart-annotations.json`)).toBe(join(root, rev, "chart-annotations.json"));
  for (const bad of [`app://library/${rev}/chart.PDF`, `app://library/${rev}/chart.pdf.exe`, `app://library/${rev}/../chart.pdf`, `app://library/${rev}/chart.json`]) {
    expect(libraryFilePath(root, bad)).toBeNull();
  }
});

it("refuses a file that is not a PDF and a PDF over the size limit, and leaves the song without a chart", async () => {
  const song = await savedSong();
  await expect(store.attachChart(song.song.id, new TextEncoder().encode("not a pdf"))).rejects.toThrow("not a PDF");
  await expect(store.attachChart(song.song.id, new Uint8Array(0))).rejects.toThrow();
  const huge = new Uint8Array(CHART_PDF_MAX_BYTES + 1);
  huge.set(pdf());
  await expect(store.attachChart(song.song.id, huge)).rejects.toThrow("larger than 50 MB");
  await expect(store.attachChart("../escape", pdf())).rejects.toThrow();
  expect((await store.index()).songs[0].chart).toBeUndefined();
});

it("replaces a PDF and drops the annotations that belonged to the old one", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf("first"));
  await store.saveAnnotations(song.song.id, JSON.stringify(annotated()));
  await store.attachChart(song.song.id, pdf("second"));
  const index = await store.index();
  expect(index.songs[0].chart?.annotations).toBeUndefined();
  expect(new TextDecoder().decode(await readSaved(root, song.song.id, "chart.pdf"))).toContain("second");
  await expect(readSaved(root, song.song.id, "chart-annotations.json")).rejects.toThrow();
});

it("saves annotations per song, reads them back after a restart, and refuses them without a PDF", async () => {
  const song = await savedSong();
  await expect(store.saveAnnotations(song.song.id, JSON.stringify(annotated()))).rejects.toThrow("Attach a PDF");
  await store.attachChart(song.song.id, pdf());
  await store.saveAnnotations(song.song.id, JSON.stringify(annotated("Chorus")));
  await store.saveAnnotations(song.song.id, JSON.stringify(annotated("Bridge")));
  const restarted = new SongLibraryStore(root);
  const saved = JSON.parse(new TextDecoder().decode(await readSaved(root, song.song.id, "chart-annotations.json")));
  expect(saved).toEqual(annotated("Bridge"));
  const chart = (await restarted.index()).songs[0].chart;
  expect(chart?.annotations?.bytes).toBe(JSON.stringify(annotated("Bridge")).length);
  expect((await restarted.chartUrls(song.song.id))?.annotations).toMatch(/\/chart-annotations\.json$/);
});

it("refuses annotation text that is malformed, oversized or not in the file format, and writes nothing", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf());
  await store.saveAnnotations(song.song.id, JSON.stringify(annotated("Keep")));
  for (const bad of [
    "not json",
    JSON.stringify({ version: 2, pages: {}, turns: [] }),
    JSON.stringify({ version: 1, pages: { "0": [] }, turns: [] }),
    JSON.stringify({ ...annotated(), turns: [-1] }),
    JSON.stringify({ version: 1, pages: { "1": [{ kind: "pen", colour: "red", width: 0.002, points: [{ x: 0.1, y: 0.1 }] }] }, turns: [] }),
    JSON.stringify({ version: 1, pages: { "1": [{ kind: "text", colour: "#111111", x: 2, y: 0, text: "off the page" }] }, turns: [] }),
    "x".repeat(CHART_ANNOTATIONS_MAX_BYTES + 1),
  ]) {
    await expect(store.saveAnnotations(song.song.id, bad)).rejects.toThrow();
  }
  expect(JSON.parse(new TextDecoder().decode(await readSaved(root, song.song.id, "chart-annotations.json")))).toEqual(annotated("Keep"));
  const leftovers = (await readdir(join(root, JSON.parse(await readFile(join(root, "library.json"), "utf8")).revisions[song.song.id]))).filter((f) =>
    f.endsWith(".tmp"),
  );
  expect(leftovers).toEqual([]);
});

it("keeps the PDF and its annotations when the song is saved again, and when its audio is converted", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf("kept"));
  await store.saveAnnotations(song.song.id, JSON.stringify(annotated("Kept")));
  // A re-save from the renderer carries no chart; the library keeps the one it has.
  await saveFlacSong(store, { ...song, song: { ...song.song, title: "Renamed" } });
  const after = await store.index();
  expect(after.songs[0].title).toBe("Renamed");
  expect(after.songs[0].chart).toMatchObject({ annotations: { bytes: expect.any(Number) } });
  expect(new TextDecoder().decode(await readSaved(root, song.song.id, "chart.pdf"))).toContain("kept");
  expect(JSON.parse(new TextDecoder().decode(await readSaved(root, song.song.id, "chart-annotations.json")))).toEqual(annotated("Kept"));
});

it("removes the PDF and its annotations and leaves the audio and text chart in place", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf());
  await store.saveAnnotations(song.song.id, JSON.stringify(annotated()));
  await store.removeChart(song.song.id);
  const index = await store.index();
  expect(index.songs[0].chart).toBeUndefined();
  expect(index.songs[0].settings[""]).toBe(song.song.settings[""]);
  expect(await store.chartUrls(song.song.id)).toBeNull();
  await expect(readSaved(root, song.song.id, "chart.pdf")).rejects.toThrow();
  await expect(readSaved(root, song.song.id, "source.flac")).resolves.toBeDefined();
});

it("keeps the previous PDF when the new one cannot be published", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf("before"));
  // The index path is replaced by a directory, so publishing the new index fails.
  const index = join(root, "library.json"),
    original = await readFile(index);
  await rm(index);
  await mkdir(index);
  await expect(store.attachChart(song.song.id, pdf("after"))).rejects.toThrow();
  await rm(index, { recursive: true });
  await writeFile(index, original);
  expect(new TextDecoder().decode(await readSaved(root, song.song.id, "chart.pdf"))).toContain("before");
  expect((await store.index()).songs[0].chart?.bytes).toBe(pdf("before").length);
});

it("does not keep a PDF on a song that is not in the library", async () => {
  await expect(store.removeChart(randomUUID())).rejects.toThrow("not found");
  await expect(store.chartUrls(randomUUID())).resolves.toBeNull();
});

it("backs up the PDF and its annotations and restores them with the song", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf("backed up"));
  await store.saveAnnotations(song.song.id, JSON.stringify(annotated("Backed")));
  await store.exportBackup(archive);
  const dir = await unpack();
  const manifest = JSON.parse(await readFile(join(dir, "backup-manifest.json"), "utf8"));
  const paths = manifest.files.map((f: { path: string }) => f.path.split("/").pop()).sort();
  expect(paths).toEqual(["chart-annotations.json", "chart.pdf", "guitar.flac", "library.json", "source.flac"]);
  const destination = join(temp, "restored");
  const restored = new SongLibraryStore(destination);
  expect(await restored.restoreBackup(archive)).toEqual({ songs: 1, playlists: 0 });
  const [copy] = (await restored.index()).songs;
  expect(copy.chart).toBeDefined();
  expect(new TextDecoder().decode(await readSaved(destination, copy.id, "chart.pdf"))).toContain("backed up");
  expect(JSON.parse(new TextDecoder().decode(await readSaved(destination, copy.id, "chart-annotations.json")))).toEqual(annotated("Backed"));
});

it("refuses a backup whose PDF was changed after the index was written", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf("original"));
  await store.exportBackup(archive);
  const dir = await unpack();
  const rev = JSON.parse(await readFile(join(dir, "library.json"), "utf8")).revisions[song.song.id];
  await writeFile(join(dir, rev, "chart.pdf"), pdf("tampered!"));
  const files = (await readdir(join(dir, rev))).map((f) => `${rev}/${f}`);
  await createTar({ cwd: dir, file: archive, gzip: true, portable: true }, ["backup-manifest.json", "library.json", ...files]);
  await expect(new SongLibraryStore(join(temp, "restored")).restoreBackup(archive)).rejects.toThrow();
});

it("refuses a backup that carries a file outside the allow-list, even when the manifest lists it", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf());
  await store.exportBackup(archive);
  const dir = await unpack();
  const rev = JSON.parse(await readFile(join(dir, "library.json"), "utf8")).revisions[song.song.id];
  // Each extra name is a file a careless or hostile archive could carry: a longer extension, a different case, a sibling file, a folder.
  const extras = ["chart.pdf.exe", "CHART.pdf", "chart-annotations.json.bak", "chart.pdf.d"];
  const manifest = JSON.parse(await readFile(join(dir, "backup-manifest.json"), "utf8"));
  for (const name of extras) {
    await writeFile(join(dir, rev, name), pdf());
    manifest.files.push({ path: `${rev}/${name}`, bytes: pdf().length, sha256: "0".repeat(64) });
  }
  await writeFile(join(dir, "backup-manifest.json"), JSON.stringify(manifest));
  const names = [...manifest.files.map((f: { path: string }) => f.path), "library.json", "backup-manifest.json"];
  await createTar({ cwd: dir, file: archive, gzip: true, portable: true }, [...new Set(names)]);
  await expect(new SongLibraryStore(join(temp, "restored")).restoreBackup(archive)).rejects.toThrow("Invalid or damaged");
});

it("keeps an empty annotation document readable and writes it as an empty file", async () => {
  const song = await savedSong();
  await store.attachChart(song.song.id, pdf());
  await store.saveAnnotations(song.song.id, JSON.stringify(emptyAnnotations()));
  expect(JSON.parse(new TextDecoder().decode(await readSaved(root, song.song.id, "chart-annotations.json")))).toEqual(emptyAnnotations());
});

it("saves the chart view setting only as pdf or text", async () => {
  const song = await flacSong();
  const settings = (value: string) => ({ ...song.song, settings: { ...song.song.settings, ":chart": value } });
  await expect(store.begin(settings("pdf"))).resolves.toEqual(expect.any(String));
  await expect(store.begin(settings("text"))).resolves.toEqual(expect.any(String));
  await expect(store.begin(settings("image"))).rejects.toThrow("Invalid song settings");
});
