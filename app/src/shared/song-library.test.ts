import { describe, expect, it } from "vitest";
import {
  emptyLibrary,
  flacName,
  isTrackFileName,
  trackKey,
  upgradeIndex,
  validatePlaylists,
  validateSong,
  type LibraryAudio,
  type LibrarySong,
  type StoredLibrary,
} from "./song-library";

const ID = "11111111-2222-3333-4444-555555555555";
const OTHER = "22222222-2222-3333-4444-555555555555";
const HASH = "a".repeat(64);

/** A saved track as v2 wrote it: a FLAC file with a digest, and no per-track settings. */
function flacTrack(name: string, frames = 44100): LibraryAudio {
  return { name, sampleRate: 44100, frames, channels: 2, file: flacName(name), codec: "flac", bytes: 1000, sha256: HASH };
}

function song(audio: LibraryAudio[], extra: Partial<LibrarySong> = {}): LibrarySong {
  return { id: ID, title: "Song", artist: "", sourceName: "song.wav", duration: 1, audio, settings: {}, updated: "2026-01-01T00:00:00.000Z", ...extra };
}

const sixStems = () => ["source", "drums", "bass", "other", "vocals", "guitar", "piano"].map((name) => flacTrack(name));

describe("upgrading an older index", () => {
  it("upgrades a v1 index with raw tracks, keeping every song, track and playlist", () => {
    const raw: LibraryAudio = { name: "source", sampleRate: 44100, frames: 10, channels: 2 };
    const v1: StoredLibrary = { version: 1, songs: [song([raw])], playlists: [{ id: OTHER, name: "Set", songs: [ID] }] };
    const v4 = upgradeIndex(v1);
    expect(v4.version).toBe(4);
    expect(v4.songs[0].audio).toEqual([{ ...raw, kind: "source" }]);
    expect(v4.playlists).toEqual([{ id: OTHER, name: "Set", songs: [ID] }]);
    expect(v4.folders).toEqual([]);
    expect(v4.history).toEqual([]);
  });

  it("writes the kind of each saved track and keeps every file, name and digest", () => {
    const v2: StoredLibrary = { version: 2, songs: [song(sixStems())], playlists: [] };
    const before = v2.songs[0].audio;
    const after = upgradeIndex(v2).songs[0].audio;
    expect(after.map((t) => [t.name, t.file, t.bytes, t.sha256, t.frames])).toEqual(before.map((t) => [t.name, t.file, t.bytes, t.sha256, t.frames]));
    expect(after.map((t) => t.kind)).toEqual(["source", "stem", "stem", "stem", "stem", "stem", "stem"]);
  });

  it("changes no saved setting, and takes the update time as the creation time", () => {
    const v3: StoredLibrary = { version: 3, songs: [song([flacTrack("source")], { settings: { ":bpm": "96", ":options": "x" } })], playlists: [] };
    const [upgraded] = upgradeIndex(v3).songs;
    expect(upgraded.settings).toEqual({ ":bpm": "96", ":options": "x" });
    expect(upgraded.created).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps a song's own creation time", () => {
    const index = upgradeIndex({ version: 3, songs: [song([flacTrack("source")], { created: "2025-05-05T00:00:00.000Z" })], playlists: [] });
    expect(index.songs[0].created).toBe("2025-05-05T00:00:00.000Z");
  });

  it("leaves a v4 index as it is", () => {
    const index = { version: 4 as const, songs: [song([flacTrack("source")])], playlists: [], folders: [], history: [] };
    expect(upgradeIndex(index)).toBe(index);
  });

  it("fills in a damaged v4 index's missing folders and history rather than failing", () => {
    const damaged = { version: 4 as const, songs: [], playlists: [] } as unknown as StoredLibrary;
    expect(upgradeIndex(damaged)).toMatchObject({ folders: [], history: [] });
  });

  it("starts an empty library at v4", () => {
    expect(emptyLibrary()).toEqual({ version: 4, songs: [], playlists: [], folders: [], history: [] });
  });
});

describe("track keys and file names", () => {
  it("gives a v1 raw track no file, so its key is its name", () => {
    expect(trackKey({ name: "drums", sampleRate: 44100, frames: 10, channels: 2 })).toBe("drums");
    expect(trackKey(flacTrack("drums"))).toBe("drums");
  });

  it("keys an imported track by its fixed file name, not its label", () => {
    expect(trackKey({ ...flacTrack("Keys L"), kind: "user", file: "track3.flac" })).toBe("track3");
  });

  it("accepts the stem names and track0 to track31, and nothing else", () => {
    expect(isTrackFileName("drums.flac")).toBe(true);
    expect(isTrackFileName("track0.flac")).toBe(true);
    expect(isTrackFileName("track31.flac")).toBe(true);
    expect(isTrackFileName("track32.flac")).toBe(false);
    expect(isTrackFileName("../track1.flac")).toBe(false);
    expect(isTrackFileName("unknown.flac")).toBe(false);
  });
});

describe("validateSong", () => {
  it("accepts a song with a source and six stems, and reads a save without kinds as stems", () => {
    expect(() => validateSong(song(sixStems()))).not.toThrow();
  });

  it("refuses a song whose first track is not the source", () => {
    expect(() => validateSong(song([flacTrack("drums")]))).toThrow("Invalid song tracks.");
  });

  it("refuses a track file that is not named for its track", () => {
    expect(() => validateSong(song([flacTrack("source"), { ...flacTrack("drums"), file: "../escape.flac" }]))).toThrow("Invalid song audio file.");
  });

  it("refuses a digest that is not SHA-256, and a track that claims FLAC without a size", () => {
    expect(() => validateSong(song([{ ...flacTrack("source"), sha256: "abc" }]))).toThrow("Invalid song audio file.");
    expect(() => validateSong(song([{ ...flacTrack("source"), bytes: undefined }]))).toThrow("Invalid song audio file.");
  });

  it("refuses an empty title, a bad id, and settings keys it does not know", () => {
    expect(() => validateSong(song([flacTrack("source")], { title: "  " }))).toThrow("Invalid saved song.");
    expect(() => validateSong(song([flacTrack("source")], { id: "../x" }))).toThrow("Invalid saved song.");
    expect(() => validateSong(song([flacTrack("source")], { settings: { ":other": "x" } }))).toThrow("Invalid song settings.");
  });

  it("refuses more than 32 imported tracks and tracks whose keys collide", () => {
    const imported = (i: number): LibraryAudio => ({ ...flacTrack(`Track ${i}`), kind: "user", file: `track${i}.flac` });
    const many = Array.from({ length: 33 }, (_, i) => imported(i));
    expect(() => validateSong(song([flacTrack("source"), ...many.slice(0, 32)]))).not.toThrow();
    expect(() => validateSong(song([flacTrack("source"), ...many]))).toThrow("Invalid song tracks.");
    expect(() => validateSong(song([flacTrack("source"), imported(0), imported(0)]))).toThrow("Invalid song tracks.");
  });
});

describe("validatePlaylists", () => {
  it("accepts entries that exist, including repeated ones", () => {
    expect(() => validatePlaylists([{ id: OTHER, name: "Set", songs: [ID, ID] }], [song([flacTrack("source")])])).not.toThrow();
  });

  it("refuses a missing song, a repeated id and a blank name", () => {
    const songs = [song([flacTrack("source")])];
    expect(() => validatePlaylists([{ id: OTHER, name: "Set", songs: [OTHER] }], songs)).toThrow("invalid or missing song");
    expect(() => validatePlaylists([{ id: OTHER, name: "A", songs: [] }, { id: OTHER, name: "B", songs: [] }], songs)).toThrow();
    expect(() => validatePlaylists([{ id: OTHER, name: " ", songs: [] }], songs)).toThrow();
  });
});
