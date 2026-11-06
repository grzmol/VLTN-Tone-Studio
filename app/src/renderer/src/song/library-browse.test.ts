import { expect, it } from "vitest";
import type { LibraryFolder, LibrarySong } from "@shared/song-library";
import { NO_BROWSE, browseSongs, folderRows } from "./library-browse";

const F1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const F2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const folders: LibraryFolder[] = [
  { id: F1, name: "Gigs" },
  { id: F2, name: "Summer", parentId: F1 },
];
const song = (id: string, title: string, extra: Partial<LibrarySong> = {}): LibrarySong => ({
  id,
  title,
  artist: "Band",
  sourceName: "",
  duration: 100,
  audio: [],
  settings: {},
  updated: "",
  ...extra,
});
const songs = [song("1", "Charlie", { folderId: F2 }), song("2", "Alpha", { folderId: F1, keywords: ["encore"] }), song("3", "Bravo")];
const titles = (list: LibrarySong[]) => list.map((s) => s.title);

it("lists every song A to Z with no search, folder or filter", () => {
  expect(titles(browseSongs(songs, folders, NO_BROWSE).songs)).toEqual(["Alpha", "Bravo", "Charlie"]);
});

it("searches as the person types, across title, artist and keywords", () => {
  expect(titles(browseSongs(songs, folders, { ...NO_BROWSE, query: "encore" }).songs)).toEqual(["Alpha"]);
});

it("shows a folder and everything inside it", () => {
  expect(titles(browseSongs(songs, folders, { ...NO_BROWSE, folderId: F1 }).songs)).toEqual(["Alpha", "Charlie"]);
});

it("applies a filter, and reports a filter that cannot run with no songs", () => {
  const ok = browseSongs(songs, folders, { ...NO_BROWSE, filter: { match: "all", rules: [{ field: "keyword", op: "has", value: "encore" }], sort: "title" } });
  expect(titles(ok.songs)).toEqual(["Alpha"]);
  expect(ok.problems).toEqual([]);
  const broken = browseSongs(songs, folders, {
    ...NO_BROWSE,
    filter: { match: "all", rules: [{ field: "bpm", op: "between", value: [9, 1] }], sort: "title" },
  });
  expect(broken.songs).toEqual([]);
  expect(broken.problems).toEqual(["Enter a range from the smaller to the larger number."]);
});

it("reverses the order", () => {
  expect(titles(browseSongs(songs, folders, { ...NO_BROWSE, reverse: true }).songs)).toEqual(["Charlie", "Bravo", "Alpha"]);
});

it("gives an A to Z index only for a long list", () => {
  expect(browseSongs(songs, folders, NO_BROWSE).letters).toEqual([]);
  const many = Array.from({ length: 25 }, (_, i) => song(String(i), `${String.fromCharCode(65 + (i % 26))} song ${i}`, { artist: `Artist ${i}` }));
  expect(browseSongs(many, folders, NO_BROWSE).letters.length).toBeGreaterThan(5);
});

it("lists folders in tree order with their depth, and keeps a folder whose parent is missing at the top", () => {
  const tree: LibraryFolder[] = [
    { id: F2, name: "Summer", parentId: F1 },
    { id: F1, name: "Gigs" },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Orphan", parentId: "dddddddd-dddd-dddd-dddd-dddddddddddd" },
  ];
  expect(folderRows(tree).map((row) => [row.folder.name, row.depth])).toEqual([
    ["Gigs", 0],
    ["Summer", 1],
    ["Orphan", 0],
  ]);
});
