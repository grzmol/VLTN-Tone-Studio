import { describe, expect, it } from "vitest";
import {
  emptyLibrary,
  flacName,
  upgradeIndex,
  validateOrganisation,
  validatePlaylists,
  validateSong,
  validateSongMeta,
  validateSongPatch,
  validateFolders,
  type LibraryAudio,
  type LibrarySong,
  type Playlist,
  type SongLibrary,
  type StoredLibrary,
} from "./song-library";

const ID = "11111111-2222-3333-4444-555555555555";
const OTHER = "22222222-2222-3333-4444-555555555555";
const FOLDER = "33333333-2222-3333-4444-555555555555";
const HASH = "a".repeat(64);

function flac(name: string): LibraryAudio {
  return { name, sampleRate: 44100, frames: 44100, channels: 2, file: flacName(name), codec: "flac", bytes: 1000, sha256: HASH };
}
function song(extra: Partial<LibrarySong> = {}, id = ID): LibrarySong {
  return {
    id,
    title: "Song",
    artist: "Band",
    sourceName: "song.wav",
    duration: 180,
    audio: [flac("source")],
    settings: {},
    updated: "2026-02-03T04:05:06.000Z",
    ...extra,
  };
}
/** A raw v1 song: float32 channels with no file and no digest. */
const raw = (): LibrarySong => ({
  ...song(),
  audio: [{ name: "source", sampleRate: 44100, frames: 10, channels: 2 }],
});

describe("index migration to v4", () => {
  it("upgrades a v1 index with raw tracks, keeping every song, track and playlist", () => {
    const v1: StoredLibrary = {
      version: 1,
      songs: [raw()],
      playlists: [{ id: OTHER, name: "Set", songs: [ID] }],
    };
    const v4 = upgradeIndex(v1);
    expect(v4.version).toBe(4);
    expect(v4.songs.map((s) => s.id)).toEqual([ID]);
    expect(v4.songs[0].audio).toEqual([{ ...raw().audio[0], kind: "source" }]);
    expect(v4.playlists).toEqual([{ id: OTHER, name: "Set", songs: [ID], sets: [] }]);
    expect(v4.folders).toEqual([]);
    expect(v4.history).toEqual([]);
  });

  it("upgrades a v2 index and keeps each FLAC file, digest and size", () => {
    const v2: StoredLibrary = { version: 2, songs: [song({ audio: [flac("source"), flac("vocals")] })], playlists: [] };
    const v4 = upgradeIndex(v2);
    expect(v4.songs[0].audio.map((a) => [a.name, a.file, a.bytes, a.sha256])).toEqual([
      ["source", "source.flac", 1000, HASH],
      ["vocals", "vocals.flac", 1000, HASH],
    ]);
    expect(v4.songs[0].audio.map((a) => a.kind)).toEqual(["source", "stem"]);
  });

  it("upgrades a v3 index with defaults and changes no saved value", () => {
    const v3: StoredLibrary = {
      version: 3,
      songs: [song({ settings: { ":bpm": "96", ":options": "pitch=2" } })],
      playlists: [{ id: OTHER, name: "Gig", songs: [ID] }],
    };
    const [upgraded] = upgradeIndex(v3).songs;
    expect(upgraded.keywords).toEqual([]);
    expect(upgraded.playCount).toBe(0);
    expect(upgraded.created).toBe("2026-02-03T04:05:06.000Z");
    expect(upgraded.settings).toEqual({ ":bpm": "96", ":options": "pitch=2" });
    expect(upgraded.bpm).toBe(96);
    expect(upgraded.lastPlayed).toBeUndefined();
    expect(upgraded.folderId).toBeUndefined();
  });

  it("leaves the tempo unset when the saved one is not a usable number", () => {
    const [upgraded] = upgradeIndex({ version: 3 as const, songs: [song({ settings: { ":bpm": "fast" } })], playlists: [] }).songs;
    expect(upgraded.bpm).toBeUndefined();
  });

  it("keeps a v4 song's own metadata when it is upgraded again", () => {
    const meta = song({ bpm: 120, keywords: ["encore"], playCount: 4, created: "2026-01-01T00:00:00.000Z" });
    const index = upgradeIndex({ version: 4 as const, songs: [meta], playlists: [], folders: [], history: [] });
    expect(index.songs[0]).toMatchObject({ bpm: 120, keywords: ["encore"], playCount: 4, created: "2026-01-01T00:00:00.000Z" });
  });

  it("fills in a damaged v4 index's missing folders and history rather than failing", () => {
    const damaged = { version: 4 as const, songs: [], playlists: [] } as unknown as StoredLibrary;
    expect(upgradeIndex(damaged)).toMatchObject({ folders: [], history: [] });
  });

  it("starts an empty library at v4", () => {
    expect(emptyLibrary()).toEqual({ version: 4, songs: [], playlists: [], folders: [], history: [] });
  });
});

describe("song metadata validation", () => {
  it.each([
    ["an out-of-range tempo", { bpm: 500 }],
    ["a year out of range", { year: 999 }],
    ["a colour that is not hex", { color: "blue" }],
    ["too many keywords", { keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }],
    ["an empty keyword", { keywords: [" "] }],
    ["a folder that is not an id", { folderId: "not-a-folder" }],
    ["a negative play count", { playCount: -1 }],
    ["a last-played time that is not a date", { lastPlayed: "yesterday" }],
    ["a key with a control character", { key: "A\u0007" }],
  ])("refuses %s", (_, extra) => {
    expect(() => validateSong(song(extra as Partial<LibrarySong>))).toThrow("Invalid song details.");
  });

  it("accepts a fully described song", () => {
    expect(() =>
      validateSong(
        song({
          key: "A minor",
          bpm: 96,
          year: 2024,
          color: "#3b82f6",
          keywords: ["encore", "ballad"],
          notes: "Capo 2",
          folderId: FOLDER,
          playCount: 3,
          lastPlayed: "2026-02-03T04:05:06.000Z",
          created: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).not.toThrow();
  });

  it("treats null in a patch as a request to clear, not as a value", () => {
    expect(() => validateSongPatch({ key: null, year: null, color: null, notes: null, folderId: null })).not.toThrow();
    expect(() => validateSongPatch({ year: 99 })).toThrow("Invalid song details.");
  });

  it("checks a patch's keywords and colour the same way as a saved song", () => {
    expect(() => validateSongPatch({ keywords: ["ok"], color: "#ffffff" })).not.toThrow();
    expect(() => validateSongPatch({ keywords: [""] })).toThrow();
    expect(() => validateSongMeta({ notes: "x".repeat(2001) })).toThrow();
  });
});

describe("folder and history validation", () => {
  const folder = (id: string, parentId?: string) => ({ id, name: `Folder ${id.slice(0, 2)}`, ...(parentId ? { parentId } : {}) });
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  it("accepts folders nested to any depth", () => {
    expect(() => validateFolders([folder(A), folder(B, A), folder(C, B)])).not.toThrow();
  });

  it("refuses a folder that sits inside itself, directly or through another folder", () => {
    expect(() => validateFolders([folder(A, A)])).toThrow("A folder cannot sit inside itself.");
    expect(() => validateFolders([folder(A, B), folder(B, A)])).toThrow("A folder cannot sit inside itself.");
  });

  it("refuses a parent that does not exist and a folder with a blank name", () => {
    expect(() => validateFolders([folder(A, C)])).toThrow("Invalid folders.");
    expect(() => validateFolders([{ id: A, name: " " }])).toThrow("Invalid folder name.");
  });

  it("refuses a song in a folder that does not exist", () => {
    const index: SongLibrary = { ...emptyLibrary(), songs: [song({ folderId: A })] };
    expect(() => validateOrganisation(index)).toThrow("A song is in a folder that does not exist.");
  });

  it("refuses history that names a song not in the library, and caps its length", () => {
    const index: SongLibrary = { ...emptyLibrary(), songs: [song()], history: [{ songId: OTHER, at: "2026-01-01T00:00:00.000Z" }] };
    expect(() => validateOrganisation(index)).toThrow("Invalid play history.");
    const long = Array.from({ length: 501 }, () => ({ songId: ID, at: "2026-01-01T00:00:00.000Z" }));
    expect(() => validateOrganisation({ ...emptyLibrary(), songs: [song()], history: long })).toThrow("Invalid play history.");
  });
});

describe("playlist validation: sets and smart playlists", () => {
  const playlist = (extra: Partial<Playlist> = {}): Playlist => ({ id: FOLDER, name: "Gig", songs: [ID, OTHER], ...extra });
  const songs = [song(), song({}, OTHER)];

  it("accepts sets that start on entries, in order", () => {
    const sets = [
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Set 1", start: 0 },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Encore", start: 1 },
    ];
    expect(() => validatePlaylists([playlist({ sets })], songs)).not.toThrow();
  });

  it.each([
    ["a set that starts past the end", [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "X", start: 2 }]],
    [
      "sets out of order",
      [
        { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "X", start: 1 },
        { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Y", start: 0 },
      ],
    ],
    [
      "two sets starting on the same entry",
      [
        { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "X", start: 0 },
        { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Y", start: 0 },
      ],
    ],
  ])("refuses %s", (_, sets) => {
    expect(() => validatePlaylists([playlist({ sets })], songs)).toThrow("Invalid playlist sets.");
  });

  it("accepts a smart playlist that holds no entries", () => {
    const smart = { match: "all" as const, rules: [{ field: "playCount" as const, op: "gt" as const, value: 2 }], sort: "title" as const };
    expect(() => validatePlaylists([{ id: FOLDER, name: "Often", songs: [], smart }], songs)).not.toThrow();
  });

  it("refuses a smart playlist that also holds entries, or a rule that cannot run", () => {
    const smart = { match: "all" as const, rules: [], sort: "title" as const };
    expect(() => validatePlaylists([playlist({ smart })], songs)).toThrow("A smart playlist holds no entries of its own.");
    const bad = { match: "all" as const, rules: [{ field: "bpm" as const, op: "contains" as const, value: "x" }], sort: "title" as const };
    expect(() => validatePlaylists([{ id: FOLDER, name: "Bad", songs: [], smart: bad }], songs)).toThrow();
  });
});

describe("per-entry overrides in a playlist", () => {
  const entries = ["00000001-0000-0000-0000-000000000000", "00000002-0000-0000-0000-000000000000"];
  const withSongs = () => [song({ id: entries[0] }), song({ id: entries[1] })];
  const gig = (overrides?: unknown): Playlist => ({ id: FOLDER, name: "Gig", songs: entries, overrides: overrides as Playlist["overrides"] });

  it("accepts one override, or null, for each entry", () => {
    expect(() => validatePlaylists([gig([{ endBehaviour: "loop" }, null])], withSongs())).not.toThrow();
  });

  it("refuses an override list that is not as long as the entries, or holds an unknown setting", () => {
    expect(() => validatePlaylists([gig([null])], withSongs())).toThrow("Invalid playlist entry settings.");
    expect(() => validatePlaylists([gig([{ endBehaviour: "repeat" }, null])], withSongs())).toThrow("Invalid playlist entry settings.");
  });

  it("refuses overrides on a smart playlist, which has no entries of its own", () => {
    const smart: Playlist = { id: FOLDER, name: "Rules", songs: [], overrides: [null], smart: { match: "all", rules: [], sort: "title" } };
    expect(() => validatePlaylists([smart], withSongs())).toThrow("A smart playlist holds no entries of its own.");
  });

  it("reads a playlist saved before overrides as having none on any entry", () => {
    const old = upgradeIndex({ version: 3 as const, songs: withSongs(), playlists: [{ id: FOLDER, name: "Gig", songs: entries }] });
    expect(old.playlists[0].overrides).toBeUndefined();
    expect(() => validatePlaylists(old.playlists, old.songs)).not.toThrow();
  });
});
