import { describe, expect, it } from "vitest";
import {
  copyTrackSettings,
  flacName,
  isTrackFileName,
  userTrackNames,
  trackKey,
  upgradeIndex,
  userFileName,
  validateSong,
  type LibraryAudio,
  type LibrarySong,
  type SongLibrary,
} from "./song-library";

const ID = "11111111-2222-3333-4444-555555555555";
const HASH = "a".repeat(64);

/** A saved track as v2 wrote it: a FLAC file with a digest, and no per-track settings. */
function flacTrack(name: string, frames = 44100): LibraryAudio {
  return { name, sampleRate: 44100, frames, channels: 2, file: flacName(name), codec: "flac", bytes: 1000, sha256: HASH };
}

function song(audio: LibraryAudio[]): LibrarySong {
  return { id: ID, title: "Song", artist: "", sourceName: "song.wav", duration: 1, audio, settings: {}, updated: "2026-01-01T00:00:00.000Z" };
}

const legacySix = () => ["source", "drums", "bass", "other", "vocals", "guitar", "piano"].map((name) => flacTrack(name));

describe("v2 to v3 migration", () => {
  it("writes the kind of each saved track and keeps every file, name and digest", () => {
    const v2 = { version: 2 as const, songs: [song(legacySix())], playlists: [] };
    const v3 = upgradeIndex(v2);
    expect(v3.version).toBe(4);
    const before = v2.songs[0].audio;
    const after = v3.songs[0].audio;
    expect(after.map((t) => t.name)).toEqual(before.map((t) => t.name));
    expect(after.map((t) => t.file)).toEqual(before.map((t) => t.file));
    expect(after.map((t) => [t.bytes, t.sha256, t.frames, t.sampleRate, t.channels])).toEqual(
      before.map((t) => [t.bytes, t.sha256, t.frames, t.sampleRate, t.channels]),
    );
    expect(after.map((t) => t.kind)).toEqual(["source", "stem", "stem", "stem", "stem", "stem", "stem"]);
  });

  it("adds no colour, bus, pitch or mute setting that was not saved", () => {
    const [upgraded] = upgradeIndex({ version: 2, songs: [song([flacTrack("source"), flacTrack("vocals")])], playlists: [] }).songs[0].audio.slice(1);
    expect(upgraded).not.toHaveProperty("color");
    expect(upgraded).not.toHaveProperty("bus");
    expect(upgraded).not.toHaveProperty("transpose");
    expect(upgraded).not.toHaveProperty("muteGroups");
  });

  it("leaves a v4 index as it is", () => {
    const index: SongLibrary = { version: 4, songs: [song([flacTrack("source")])], playlists: [], folders: [], history: [] };
    expect(upgradeIndex(index)).toBe(index);
  });

  it("reads a legacy save without a kind as a stem, and still validates it", () => {
    const legacy = song(legacySix());
    expect(() => validateSong(upgradeIndex({ version: 2, songs: [legacy], playlists: [] }).songs[0])).not.toThrow();
    expect(() => validateSong(legacy)).not.toThrow();
  });

  it("gives a v1 raw track no file, so its key is its name", () => {
    const raw: LibraryAudio = { name: "drums", sampleRate: 44100, frames: 10, channels: 2 };
    expect(trackKey(raw)).toBe("drums");
    expect(trackKey(flacTrack("drums"))).toBe("drums");
  });
});

describe("track keys and file names", () => {
  it("keys an imported track by its fixed file name, not its label", () => {
    const imported: LibraryAudio = { ...flacTrack("Keys L"), name: "Keys L", kind: "user", file: userFileName(3) };
    expect(trackKey(imported)).toBe("track3");
  });

  it("accepts the legacy names and track0 to track31, and nothing else", () => {
    expect(isTrackFileName("drums.flac")).toBe(true);
    expect(isTrackFileName("track0.flac")).toBe(true);
    expect(isTrackFileName("track31.flac")).toBe(true);
    expect(isTrackFileName("track32.flac")).toBe(false);
    expect(isTrackFileName("../track1.flac")).toBe(false);
    expect(isTrackFileName("unknown.flac")).toBe(false);
  });
});

describe("validateSong with imported tracks", () => {
  const imported = (index: number, extra: Partial<LibraryAudio> = {}): LibraryAudio => ({
    ...flacTrack(`Track ${index}`),
    kind: "user",
    file: userFileName(index),
    ...extra,
  });

  it("accepts a song with a mixdown source and imported tracks with settings", () => {
    const audio = [flacTrack("source"), imported(0, { color: "#3b82f6", bus: "click", transpose: false, gain: 0.8, pan: -0.3, muteGroups: [1, 2] })];
    expect(() => validateSong(song(audio))).not.toThrow();
  });

  it("accepts two imported tracks with the same label", () => {
    const audio = [flacTrack("source"), imported(0, { name: "Click" }), imported(1, { name: "Click" })];
    expect(() => validateSong(song(audio))).not.toThrow();
  });

  it("refuses an imported track whose file is not a track file", () => {
    const audio = [flacTrack("source"), imported(0, { file: "../escape.flac" })];
    expect(() => validateSong(song(audio))).toThrow("Invalid song audio file.");
  });

  it("refuses more than 32 imported tracks", () => {
    const tracks = Array.from({ length: 33 }, (_, i) => imported(i));
    expect(() => validateSong(song([flacTrack("source"), ...tracks.slice(0, 32)]))).not.toThrow();
    expect(() => validateSong(song([flacTrack("source"), ...tracks]))).toThrow("Invalid song tracks.");
  });

  it("refuses a bus, colour, volume, pan or mute group out of range", () => {
    const bad: Partial<LibraryAudio>[] = [
      { bus: "aux9" as LibraryAudio["bus"] },
      { color: "blue" },
      { gain: 3 },
      { pan: 1.5 },
      { muteGroups: [7] },
      { muteGroups: [1, 1] },
    ];
    for (const extra of bad) expect(() => validateSong(song([flacTrack("source"), imported(0, extra)]))).toThrow();
  });

  it("refuses a song whose keys collide", () => {
    expect(() => validateSong(song([flacTrack("source"), imported(0), imported(0)]))).toThrow("Invalid song tracks.");
  });
});

describe("applying track settings to similar songs", () => {
  const imported = (name: string, index: number, extra: Partial<LibraryAudio> = {}): LibraryAudio => ({
    ...flacTrack(name),
    name,
    kind: "user",
    file: userFileName(index),
    ...extra,
  });
  const from = song([
    flacTrack("source"),
    imported("Click", 0, { bus: "click", transpose: false, muteGroups: [1] }),
    imported("Keys L", 1, { gain: 0.6, pan: -0.4 }),
  ]);

  it("lists a song's imported track names, sorted", () => {
    expect(userTrackNames(from)).toEqual(["Click", "Keys L"]);
  });

  it("copies the settings onto a song with the same tracks, and keeps that song's audio and names", () => {
    const to = { ...song([flacTrack("source"), imported("Keys L", 0), imported("Click", 1)]), id: "22222222-2222-3333-4444-555555555555" };
    const copied = copyTrackSettings(from, to)!;
    expect(copied.audio.map((a) => [a.name, a.file])).toEqual([
      ["source", "source.flac"],
      ["Keys L", "track0.flac"],
      ["Click", "track1.flac"],
    ]);
    expect(copied.audio[1]).toMatchObject({ gain: 0.6, pan: -0.4 });
    expect(copied.audio[2]).toMatchObject({ bus: "click", transpose: false, muteGroups: [1] });
    expect(copied.id).toBe(to.id);
  });

  it("clears a setting the source does not have, so the defaults apply again", () => {
    const to = song([flacTrack("source"), imported("Click", 0, { bus: "aux1", gain: 0.2 }), imported("Keys L", 1)]);
    const copied = copyTrackSettings(from, to)!;
    expect(copied.audio[1]).not.toHaveProperty("gain");
    expect(copied.audio[1]).toMatchObject({ bus: "click" });
  });

  it("does not copy onto a song whose imported tracks are different", () => {
    expect(copyTrackSettings(from, song([flacTrack("source"), imported("Click", 0)]))).toBeNull();
    expect(copyTrackSettings(from, song([flacTrack("source"), imported("Click", 0), imported("Bass", 1)]))).toBeNull();
  });

  it("matches the tracks of a song with a repeated name in order", () => {
    const twin = song([flacTrack("source"), imported("Click", 0, { bus: "click" }), imported("Click", 1, { bus: "aux2" })]);
    const copied = copyTrackSettings(twin, song([flacTrack("source"), imported("Click", 0), imported("Click", 1)]))!;
    expect(copied.audio.slice(1).map((a) => a.bus)).toEqual(["click", "aux2"]);
  });

  it("copies nothing from a song with no imported tracks", () => {
    expect(copyTrackSettings(song([flacTrack("source")]), from)).toBeNull();
  });

  it("copies the drums and bass choice when both songs have a generated part", () => {
    const choice = { drums: "generated", bass: "original" };
    const source = song([flacTrack("source"), imported("Drums (generated)", 0), imported("Click", 1)]);
    const withChoice = { ...source, settings: { ":options": JSON.stringify({ partChoice: choice, generatedParts: { drums: "track0" } }) } };
    const to = { ...song([flacTrack("source"), imported("Drums (generated)", 0), imported("Click", 1)]), id: "22222222-2222-3333-4444-555555555555" };
    const copied = copyTrackSettings(withChoice, to)!;
    expect(JSON.parse(copied.settings[":options"])).toEqual({ partChoice: choice });
  });

  it("removes the target's choice when the source has no generated part to match", () => {
    const to = {
      ...song([flacTrack("source"), imported("Keys L", 0), imported("Click", 1)]),
      id: "22222222-2222-3333-4444-555555555555",
      settings: { ":options": JSON.stringify({ partChoice: { drums: "both", bass: "both" }, beats: 4 }) },
    };
    const copied = copyTrackSettings(from, to)!;
    expect(JSON.parse(copied.settings[":options"])).toEqual({ beats: 4 });
  });

  it("never copies a song's options, so its generated part keys stay with that song", () => {
    // A generated part's track key means something only in the song that made it, so the other song keeps its own options.
    const withRecord = { ...from, settings: { ":options": JSON.stringify({ generatedParts: { drums: "track0" } }) } };
    const to = {
      ...song([flacTrack("source"), imported("Keys L", 0), imported("Click", 1)]),
      id: "22222222-2222-3333-4444-555555555555",
      settings: { ":bpm": "120" },
    };
    const copied = copyTrackSettings(withRecord, to)!;
    expect(copied.settings).toEqual({ ":bpm": "120" });
  });
});
