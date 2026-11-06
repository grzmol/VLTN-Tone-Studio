import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSong } from "./store";
import { applyPracticeMute, loadSongAudio, useSongLibrary } from "./library";
import { usePracticeMute } from "./performance/practice-mute";
import { clearSettingsCache, flushSettings, getSetting, performanceKey, setSetting } from "./performance/settings";
import { useNav } from "@/state/nav";

const api = vi.hoisted(() => ({
  index: vi.fn(),
  save: vi.fn(),
  audioUrls: vi.fn(),
  applyTrackSettings: vi.fn(),
  playlists: vi.fn(),
  remove: vi.fn(),
  updateSettings: vi.fn(),
  exportBackup: vi.fn(),
  inspectBackup: vi.fn(),
  restoreBackup: vi.fn(),
  onTransferProgress: vi.fn(),
  organise: vi.fn(),
}));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
vi.mock("./stems/engine", () => ({ separateStems: vi.fn() }));
const audio = { sampleRate: 44100, channels: [new Float32Array([0, 0.25, -0.25])] };
const codec = vi.hoisted(() => ({ decodeTrack: vi.fn(), encodeTrack: vi.fn() }));
vi.mock("./codec/flac-client", () => codec);
const fetchFile = vi.fn();
vi.stubGlobal("fetch", fetchFile);
const file = (bytes = 8) => new Response(new Uint8Array(bytes));
const saved: LibrarySong = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  title: "Saved song",
  artist: "",
  sourceName: "same.mp3",
  duration: 3 / 44100,
  audio: [
    { name: "source", sampleRate: 44100, frames: 3, channels: 1, file: "source.flac", codec: "flac", bytes: 8, sha256: "a".repeat(64) },
    { name: "guitar", sampleRate: 44100, frames: 3, channels: 1, file: "guitar.flac", codec: "flac", bytes: 8, sha256: "b".repeat(64) },
  ],
  settings: { ":bpm": "95", "": "[00:00] [Am]", ":lyrics": "[00:00] Words" },
  updated: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearSettingsCache();
  api.exportBackup.mockResolvedValue(null);
  api.inspectBackup.mockResolvedValue(null);
  api.onTransferProgress.mockReturnValue(vi.fn());
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
  api.audioUrls.mockResolvedValue({ source: "app://library/rev/source.flac", guitar: "app://library/rev/guitar.flac" });
  fetchFile.mockReset();
  fetchFile.mockImplementation(async () => file());
  codec.decodeTrack.mockReset();
  codec.decodeTrack.mockResolvedValue(audio);
  codec.encodeTrack.mockReset();
  codec.encodeTrack.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  api.updateSettings.mockResolvedValue(undefined);
  api.save.mockResolvedValue(undefined);
  useSong.setState({ source: null, stems: null, status: { kind: "idle" } });
  useSongLibrary.setState({ index: emptyLibrary(), busy: false, error: "", notice: "", queue: [], position: -1, playlistPlaying: false, midiSession: null });
});
it("loads a saved song's audio for an analysis without opening it or changing the open song", async () => {
  const loaded = await loadSongAudio(saved.id);
  expect(loaded.source.channels[0]).toEqual(audio.channels[0]);
  expect(Object.keys(loaded.stems)).toEqual(["guitar"]);
  expect(useSong.getState().source).toBeNull();
  expect(useSong.getState().stems).toBeNull();
  expect(useNav.getState().param).not.toBe("performance");
});

it("refuses to load audio for a song that is not in the library", async () => {
  await expect(loadSongAudio("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).rejects.toThrow("Song is missing from the library.");
});

it("loads saved source/stems and preserves queue positions for repeated entries", async () => {
  await useSongLibrary.getState().load(saved.id, [saved.id, saved.id], 1);
  expect(useSong.getState().source?.audio.channels[0]).toEqual(audio.channels[0]);
  expect(useSong.getState().stems?.guitar?.channels[0]).toEqual(audio.channels[0]);
  expect(getSetting(performanceKey(useSong.getState().source), ":lyrics")).toBe("[00:00] Words");
  expect(useSongLibrary.getState().position).toBe(1);
  expect(useNav.getState().param).toBe("performance");
});
it("keeps a saved song's own track beside its imported tracks when it has no split", async () => {
  const imported: LibrarySong = {
    ...saved,
    audio: [saved.audio[0], { ...saved.audio[1], name: "Keys", kind: "user", bus: "main" }],
  };
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [imported] });
  await useSongLibrary.getState().load(imported.id, [imported.id], 0);
  expect(Object.keys(useSong.getState().stems ?? {}).sort()).toEqual(["guitar", "source"]);
  expect(useSong.getState().tracks.source).toMatchObject({ kind: "source", name: "Song" });
  expect(useSong.getState().tracks.guitar).toMatchObject({ kind: "user", name: "Keys" });
});

describe("missing parts on load", () => {
  // Two seconds of audio, long enough for the 400 ms windows the check reads. The byte count tells the decode mock which file it is.
  const LENGTH = 88200;
  const split: LibrarySong = {
    ...saved,
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    title: "Split song",
    duration: LENGTH / 44100,
    audio: [
      { name: "source", sampleRate: 44100, frames: LENGTH, channels: 1, file: "source.flac", codec: "flac", bytes: 8, sha256: "c".repeat(64) },
      { name: "drums", sampleRate: 44100, frames: LENGTH, channels: 1, file: "drums.flac", codec: "flac", bytes: 9, sha256: "d".repeat(64) },
      { name: "bass", sampleRate: 44100, frames: LENGTH, channels: 1, file: "bass.flac", codec: "flac", bytes: 10, sha256: "e".repeat(64) },
    ],
  };
  // A song with the source alone: no stems, so nothing to check.
  const plain: LibrarySong = { ...split, id: "dddddddd-dddd-dddd-dddd-dddddddddddd", title: "Plain song", audio: [split.audio[0]] };
  const sizes: Record<string, number> = { "app://split/source.flac": 8, "app://split/drums.flac": 9, "app://split/bass.flac": 10 };
  const tone = () => new Float32Array(LENGTH).map((_, i) => 0.5 * Math.sin(i * 0.05));

  beforeEach(() => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [split, plain] });
    api.audioUrls.mockImplementation(async (id: string) =>
      id === split.id
        ? { source: "app://split/source.flac", drums: "app://split/drums.flac", bass: "app://split/bass.flac" }
        : { source: "app://split/source.flac" },
    );
    fetchFile.mockImplementation(async (url: string) => file(sizes[url]));
    // The 9-byte file is the drums stem, and it is silent. Every other file is the tone.
    codec.decodeTrack.mockImplementation(async (bytes: ArrayBuffer) => ({
      sampleRate: 44100,
      channels: [bytes.byteLength === 9 ? new Float32Array(LENGTH) : tone()],
    }));
  });

  it("a hand load leaves the check empty, even for a split song, until the Band panel asks for it", async () => {
    await useSongLibrary.getState().load(split.id);
    expect(useSong.getState().missingParts).toBeNull();
    useSong.getState().checkMissingParts();
    expect(useSong.getState().missingParts).toMatchObject({ drums: "absent", bass: "present" });
  });

  it("a playlist advance leaves the check empty", async () => {
    await useSongLibrary.getState().playPlaylist([plain.id, split.id]);
    await useSongLibrary.getState().advancePlaylist();
    expect(useSong.getState().source?.libraryId).toBe(split.id);
    expect(useSong.getState().stems?.drums).toBeDefined();
    expect(useSong.getState().missingParts).toBeNull();
  });

  it("loading a song clears the check of the song before", async () => {
    await useSongLibrary.getState().load(split.id);
    useSong.getState().checkMissingParts();
    expect(useSong.getState().missingParts).not.toBeNull();
    await useSongLibrary.getState().load(plain.id);
    expect(useSong.getState().missingParts).toBeNull();
  });
});

it("keeps the MIDI remembered by the last song when a song is loaded by hand", async () => {
  const midi = { access: null, portId: "usb", inputId: "in", armed: false, output: undefined };
  useSongLibrary.getState().rememberMidi(midi);
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().midiSession).toEqual(midi);
});
it("skips a track whose asset read fails, names it, and loads the song without blocking", async () => {
  const current = { name: "Current", audio };
  useSong.setState({ source: current });
  fetchFile.mockRejectedValueOnce(new Error("Missing audio"));
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().error).toBe("");
  expect(useSongLibrary.getState().notice).toContain("Skipped source: missing or damaged audio.");
  expect(useSong.getState().source?.libraryId).toBe(saved.id);
  expect(useSong.getState().source?.audio).not.toBe(current.audio);
  expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["guitar"]);
  expect(useNav.getState().param).toBe("performance");
});
it("saves copied audio and settings under a unique ID instead of the filename", async () => {
  const source = { name: "same.mp3", audio };
  useSong.setState({ source, stems: { guitar: audio } });
  localStorage.setItem(performanceKey(source), "[00:00] [C]");
  await useSongLibrary.getState().save("My song", "Artist");
  const [metadata, assets] = api.save.mock.calls[0];
  expect(metadata.id).not.toBe(saved.id);
  expect(metadata.settings[""]).toBe("[00:00] [C]");
  expect(assets.map((a: { name: string }) => a.name)).toEqual(["source.flac", "guitar.flac"]);
  expect(metadata.audio.map((a: { file: string; codec: string; bytes: number }) => [a.file, a.codec, a.bytes])).toEqual([
    ["source.flac", "flac", 4],
    ["guitar.flac", "flac", 4],
  ]);
  expect(metadata.audio[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(codec.encodeTrack).toHaveBeenCalledTimes(2);
  expect(useSong.getState().source?.libraryId).toBe(metadata.id);
  expect(getSetting(performanceKey(useSong.getState().source), "")).toBe("[00:00] [C]");
});

it("plays every playlist entry including repeats, persists outgoing settings, and stops at the end", async () => {
  const second = { ...saved, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "Second song", settings: { ":bpm": "130" } };
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved, second] });
  const queue = [saved.id, second.id, saved.id];
  await useSongLibrary.getState().playPlaylist(queue);
  expect(useSongLibrary.getState().playlistPlaying).toBe(true);
  expect(useSongLibrary.getState().position).toBe(0);
  setSetting(performanceKey(useSong.getState().source), "", "[00:02] Changed words");
  await useSongLibrary.getState().advancePlaylist();
  expect(api.updateSettings).toHaveBeenCalledWith(saved.id, expect.objectContaining({ "": "[00:02] Changed words" }));
  expect(useSong.getState().source?.libraryId).toBe(second.id);
  expect(getSetting(performanceKey(useSong.getState().source), ":bpm")).toBe("130");
  await useSongLibrary.getState().advancePlaylist();
  expect(useSong.getState().source?.libraryId).toBe(saved.id);
  expect(useSongLibrary.getState().position).toBe(2);
  await useSongLibrary.getState().advancePlaylist();
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().notice).toBe("Playlist finished.");
});

it("cancels autoplay when Stop is pressed during an audio load", async () => {
  await useSongLibrary.getState().load(saved.id);
  const previous = useSong.getState().source;
  let resolve!: (value: Response) => void;
  fetchFile.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const loading = useSongLibrary.getState().playPlaylist([saved.id, saved.id], 1);
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  useSongLibrary.getState().pausePlaylist();
  resolve(file());
  await loading;
  expect(useSong.getState().source).toBe(previous);
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().position).toBe(0);
});

it("plays on to the next song when a track is missing", async () => {
  await useSongLibrary.getState().playPlaylist([saved.id, saved.id]);
  fetchFile.mockRejectedValueOnce(new Error("Missing audio"));
  await useSongLibrary.getState().advancePlaylist();
  expect(useSongLibrary.getState().playlistPlaying).toBe(true);
  expect(useSongLibrary.getState().error).toBe("");
  expect(useSongLibrary.getState().position).toBe(1);
});

it("keeps lyrics and key updates that finish during the first audio save", async () => {
  const source = { name: "draft.wav", audio };
  useSong.setState({ source, stems: null });
  let finish!: () => void;
  api.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const saving = useSongLibrary.getState().save("Demo", "");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  setSetting(performanceKey(source), ":lyrics", "[00:00] Finished during save");
  setSetting(performanceKey(source), ":options", JSON.stringify({ songKey: "D minor" }));
  finish();
  await saving;
  const key = performanceKey(useSong.getState().source);
  expect(getSetting(key, ":lyrics")).toBe("[00:00] Finished during save");
  expect(JSON.parse(getSetting(key, ":options")).songKey).toBe("D minor");
  expect(api.updateSettings).toHaveBeenCalledWith(useSong.getState().source?.libraryId, expect.objectContaining({ ":lyrics": "[00:00] Finished during save" }));
});

it("flushes current saved-song edits before exporting, reports progress, and cleans up the listener", async () => {
  const source = { name: saved.sourceName, audio, libraryId: saved.id };
  useSong.setState({ source });
  setSetting(performanceKey(source), ":lyrics", "[00:00] Latest lyrics");
  const unsubscribe = vi.fn();
  api.onTransferProgress.mockImplementationOnce((callback) => {
    callback({ phase: "Checking files", completed: 1, total: 4 });
    return unsubscribe;
  });
  api.exportBackup.mockResolvedValueOnce({ songs: 1, playlists: 2, fileName: "demo.tar.gz" });
  await useSongLibrary.getState().exportBackup();
  expect(api.updateSettings).toHaveBeenCalledWith(saved.id, expect.objectContaining({ ":lyrics": "[00:00] Latest lyrics" }));
  expect(api.exportBackup).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalled();
  expect(useSongLibrary.getState()).toMatchObject({ busy: false, transfer: "", notice: "Exported 1 songs and 2 playlists to demo.tar.gz." });
});
it("treats a cancelled backup picker as cancellation and preserves the library", async () => {
  const index = { ...emptyLibrary(), songs: [saved] };
  useSongLibrary.setState({ index });
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().index).toBe(index);
  expect(useSongLibrary.getState().notice).toBe("Backup restore cancelled.");
  expect(useSongLibrary.getState().error).toBe("");
});
it("refreshes restored copies without loading a song or arming MIDI, and reports failures without clearing the index", async () => {
  api.inspectBackup.mockResolvedValue({ fileName: "demo.tar.gz", songs: 1, playlists: 1, duplicates: 0 });
  api.restoreBackup.mockResolvedValueOnce({ songs: 1, playlists: 1, fileName: "demo.tar.gz" });
  await useSongLibrary.getState().restoreBackup();
  expect(api.restoreBackup).toHaveBeenCalledWith("copy");
  expect(useSongLibrary.getState()).toMatchObject({ index: { songs: [saved] }, queue: [], midiSession: null, playlistPlaying: false });
  expect(useSong.getState().source).toBeNull();
  const index = useSongLibrary.getState().index;
  api.restoreBackup.mockRejectedValueOnce(new Error("Checksum mismatch"));
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().index).toBe(index);
  expect(useSongLibrary.getState()).toMatchObject({ error: "Checksum mismatch", busy: false, transfer: "" });
});

it("skips a saved track whose file size or decoded shape does not match the library", async () => {
  fetchFile.mockResolvedValueOnce(file(3));
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().error).toBe("");
  expect(useSongLibrary.getState().notice).toContain("Skipped source: missing or damaged audio.");
  codec.decodeTrack.mockResolvedValueOnce({ sampleRate: 44100, channels: [new Float32Array(2)] });
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().error).toBe("");
  expect(useSongLibrary.getState().notice).toContain("Skipped source: missing or damaged audio.");
  expect(useSong.getState().source).not.toBeNull();
});
it("reports a clear error for a song that is still being converted", async () => {
  api.audioUrls.mockRejectedValueOnce(new Error("This song is still being converted to the compact library format. Try again in a moment."));
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().error).toContain("still being converted");
  expect(fetchFile).not.toHaveBeenCalled();
});
it("asks before restoring when the backup holds songs that are already saved, and restores with the chosen mode", async () => {
  const preview = { fileName: "demo.tar.gz", songs: 3, playlists: 1, duplicates: 2 };
  api.inspectBackup.mockResolvedValue(preview);
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().backupPreview).toEqual(preview);
  expect(api.restoreBackup).not.toHaveBeenCalled();
  api.restoreBackup.mockResolvedValueOnce({ songs: 1, playlists: 0, skipped: 2, fileName: "demo.tar.gz" });
  await useSongLibrary.getState().finishRestore("skip");
  expect(api.restoreBackup).toHaveBeenCalledWith("skip");
  expect(useSongLibrary.getState()).toMatchObject({ backupPreview: null, notice: expect.stringContaining("Skipped 2 songs") });
});
it("cancelling the duplicate prompt restores nothing", async () => {
  api.inspectBackup.mockResolvedValue({ fileName: "demo.tar.gz", songs: 1, playlists: 0, duplicates: 1 });
  await useSongLibrary.getState().restoreBackup();
  await useSongLibrary.getState().finishRestore(null);
  expect(api.restoreBackup).not.toHaveBeenCalled();
  expect(useSongLibrary.getState()).toMatchObject({ backupPreview: null, notice: "Backup restore cancelled." });
});

it("applies the open song's track settings, and says how many similar songs changed", async () => {
  useSong.setState({ source: { name: "Open", libraryId: saved.id, audio } });
  api.applyTrackSettings.mockResolvedValueOnce(2);
  await useSongLibrary.getState().applyTrackSettings();
  expect(api.applyTrackSettings).toHaveBeenCalledWith(saved.id);
  expect(useSongLibrary.getState().notice).toBe("Applied the track settings to 2 similar songs.");
});

it("says so when no other saved song has the same imported tracks, and needs the song to be saved first", async () => {
  useSong.setState({ source: { name: "Open", libraryId: saved.id, audio } });
  api.applyTrackSettings.mockResolvedValueOnce(0);
  await useSongLibrary.getState().applyTrackSettings();
  expect(useSongLibrary.getState().notice).toBe("No other saved song has the same imported tracks.");
  useSong.setState({ source: { name: "Unsaved", audio } });
  await useSongLibrary.getState().applyTrackSettings();
  expect(useSongLibrary.getState().error).toBe("Save the song before applying its track settings.");
});

it("releases a handed-over song that no session takes up: a claim for another song, a pause, or a release stops it", () => {
  const held = (id: string) => {
    const dispose = vi.fn(() => Promise.resolve());
    const unwire = vi.fn();
    return { handover: { id, player: { dispose } as never, countInMs: 0, join: 0, unwire }, dispose, unwire };
  };
  const library = () => useSongLibrary.getState();

  const other = held("b");
  library().setHandover(other.handover);
  expect(library().claimHandover("c")).toBeNull();
  expect(other.dispose).toHaveBeenCalledTimes(1);
  expect(other.unwire).toHaveBeenCalledTimes(1);
  expect(library().handover).toBeNull();

  // The session for the song it was handed to takes it up. The library lets go of it, and does not stop it.
  const taken = held("b");
  library().setHandover(taken.handover);
  expect(library().claimHandover("b")).toBe(taken.handover);
  expect(taken.dispose).not.toHaveBeenCalled();
  expect(library().handover).toBeNull();

  const paused = held("b");
  useSongLibrary.setState({ playlistPlaying: true });
  library().setHandover(paused.handover);
  library().pausePlaylist();
  expect(paused.dispose).toHaveBeenCalledTimes(1);
  expect(paused.unwire).toHaveBeenCalledTimes(1);
  expect(library().handover).toBeNull();
  expect(library().playlistPlaying).toBe(false);

  // A second hand-over replaces a held one, and releases it.
  const first = held("b"),
    second = held("c");
  library().setHandover(first.handover);
  library().setHandover(second.handover);
  expect(first.dispose).toHaveBeenCalledTimes(1);
  library().releaseHandover();
  expect(second.dispose).toHaveBeenCalledTimes(1);
  expect(second.unwire).toHaveBeenCalledTimes(1);
  expect(library().handover).toBeNull();
});

const songNamed = (id: string, title: string): LibrarySong => ({ ...saved, id, title, audio: [], settings: {} });

it("sets a saved song's MIDI trigger, keeps its other options, saves it, and removes it on request", async () => {
  const withOptions = { ...saved, settings: { ...saved.settings, ":options": JSON.stringify({ sections: [{ id: "a" }] }) } };
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs: [withOptions] } });
  useSongLibrary.getState().setSongTrigger(saved.id, { type: "pc", channel: 2, program: 9 });
  const options = JSON.parse(useSongLibrary.getState().index.songs[0].settings[":options"]);
  expect(options).toEqual({ sections: [{ id: "a" }], midiTrigger: { type: "pc", channel: 2, program: 9 } });
  await flushSettings();
  expect(api.updateSettings).toHaveBeenCalledWith(saved.id, { ":options": JSON.stringify(options) });
  useSongLibrary.getState().setSongTrigger(saved.id, null);
  expect(JSON.parse(useSongLibrary.getState().index.songs[0].settings[":options"])).toEqual({ sections: [{ id: "a" }] });
  expect(() => useSongLibrary.getState().setSongTrigger("missing", null)).toThrow("Song is missing from the library.");
});

it("arms a song as next in a playing playlist, and says why it did not move", () => {
  const songs = [songNamed("one", "One"), songNamed("two", "Two"), songNamed("three", "Three")];
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs }, queue: ["one", "two", "three"], position: 0, playlistPlaying: true });
  expect(useSongLibrary.getState().armNext("three")).toBeNull();
  expect(useSongLibrary.getState().queue).toEqual(["one", "three", "two"]);
  expect(useSongLibrary.getState().notice).toBe("Three plays next.");
  expect(useSongLibrary.getState().armNext("three")).toBe("Three is already next.");
  expect(useSongLibrary.getState().armNext("one")).toBe("One is playing.");
  useSongLibrary.setState({ position: 2 });
  expect(useSongLibrary.getState().armNext("two")).toBe("Two is playing.");
  expect(useSongLibrary.getState().armNext("three")).toBe("Three has already played in this set.");
});

it("does not arm a song as next when no playlist is playing", () => {
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs: [songNamed("one", "One")] }, queue: ["one"], position: 0, playlistPlaying: false });
  expect(useSongLibrary.getState().armNext("one")).toBe("Arming a song as next needs a playlist that is playing.");
  expect(useSongLibrary.getState().queue).toEqual(["one"]);
});

it("hands a MIDI autoplay request to the one song it names, once", () => {
  useSongLibrary.getState().requestAutoplay("one");
  expect(useSongLibrary.getState().takeAutoplay("two")).toBe(false);
  expect(useSongLibrary.getState().takeAutoplay(undefined)).toBe(false);
  expect(useSongLibrary.getState().takeAutoplay("one")).toBe(true);
  expect(useSongLibrary.getState().takeAutoplay("one")).toBe(false);
});

describe("the queue, play recording and organisation", () => {
  const songs = () => [songNamed("one", "One"), songNamed("two", "Two"), songNamed("three", "Three"), songNamed("four", "Four")];
  const reset = (extra: Partial<ReturnType<typeof useSongLibrary.getState>> = {}) =>
    useSongLibrary.setState({
      index: { ...emptyLibrary(), songs: songs() },
      queue: ["one", "two", "three"],
      position: 0,
      playlistPlaying: true,
      playingSet: null,
      chainHold: null,
      prepared: null,
      error: "",
      notice: "",
      ...extra,
    });
  beforeEach(() => {
    api.organise.mockResolvedValue(undefined);
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: songs() });
  });

  it("puts a song after the playing one, and leaves the playing song and the songs before it alone", () => {
    reset({ queue: ["one", "two", "three"], position: 1 });
    expect(useSongLibrary.getState().playNextSong("four")).toBeNull();
    expect(useSongLibrary.getState().queue).toEqual(["one", "two", "four", "three"]);
    expect(useSongLibrary.getState().position).toBe(1);
    expect(useSongLibrary.getState().removeFromQueue(1)).toBe("That song is playing or has already played.");
    expect(useSongLibrary.getState().moveInQueue(0, 3)).toBe("That song is playing or has already played.");
    expect(useSongLibrary.getState().queue).toEqual(["one", "two", "four", "three"]);
  });

  it("adds to the end and removes or moves upcoming entries", () => {
    reset();
    expect(useSongLibrary.getState().addToQueue(["four"])).toBeNull();
    expect(useSongLibrary.getState().queue).toEqual(["one", "two", "three", "four"]);
    expect(useSongLibrary.getState().moveInQueue(3, 1)).toBeNull();
    expect(useSongLibrary.getState().queue).toEqual(["one", "four", "two", "three"]);
    expect(useSongLibrary.getState().removeFromQueue(2)).toBeNull();
    expect(useSongLibrary.getState().queue).toEqual(["one", "four", "three"]);
  });

  it("turns a lone loaded song into a queue that plays on, and refuses edits with nothing loaded", () => {
    reset({ queue: ["one"], position: 0, playlistPlaying: false });
    expect(useSongLibrary.getState().addToQueue(["two"])).toBeNull();
    expect(useSongLibrary.getState()).toMatchObject({ queue: ["one", "two"], playlistPlaying: true });
    reset({ queue: [], position: -1, playlistPlaying: false });
    expect(useSongLibrary.getState().addToQueue(["two"])).toBe("Load a song first.");
    expect(useSongLibrary.getState().playNextSong("two")).toBe("Load a song first.");
    expect(useSongLibrary.getState().queue).toEqual([]);
  });

  it("releases a chained song before its prepared player is disposed, when a queue edit changes the next song", () => {
    const order: string[] = [];
    const prepared = { id: "two", title: "Two", player: { dispose: vi.fn(() => (order.push("dispose"), Promise.resolve())) } };
    reset({ prepared: prepared as never, chainHold: { id: "two", release: () => order.push("release") } });
    expect(useSongLibrary.getState().moveInQueue(2, 1)).toBeNull();
    expect(order).toEqual(["release", "dispose"]);
    expect(useSongLibrary.getState().chainHold).toBeNull();
  });

  it("keeps a chained song when a queue edit leaves the next song as it is", () => {
    const prepared = { id: "two", title: "Two", player: { dispose: vi.fn(() => Promise.resolve()) } };
    const release = vi.fn();
    reset({ prepared: prepared as never, chainHold: { id: "two", release } });
    expect(useSongLibrary.getState().addToQueue(["four"])).toBeNull();
    expect(useSongLibrary.getState().removeFromQueue(3)).toBeNull();
    expect(release).not.toHaveBeenCalled();
    expect(prepared.player.dispose).not.toHaveBeenCalled();
    expect(useSongLibrary.getState().chainHold).toEqual({ id: "two", release });
  });

  it("records a play with its time and set, and refreshes the index without blocking the load", async () => {
    reset();
    useSongLibrary.getState().recordPlay("two", "set-1");
    await vi.waitFor(() => expect(api.organise).toHaveBeenCalledTimes(1));
    const [change] = api.organise.mock.calls[0];
    expect(change).toMatchObject({ kind: "played", id: "two", setId: "set-1" });
    expect(Number.isNaN(Date.parse(change.at))).toBe(false);
    expect(useSongLibrary.getState().busy).toBe(false);
  });

  it("records a play that fails as a log line, not an error on the screen", async () => {
    reset();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    api.organise.mockRejectedValueOnce(new Error("Disk full"));
    useSongLibrary.getState().recordPlay("two");
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("Could not record the play", expect.any(Error)));
    expect(useSongLibrary.getState().error).toBe("");
    log.mockRestore();
  });

  it("applies one batch edit to every selected song in a single save", async () => {
    reset();
    await useSongLibrary.getState().organiseSongs(["one", "two"], { keywords: ["encore"] });
    expect(api.organise).toHaveBeenCalledTimes(1);
    expect(api.organise).toHaveBeenCalledWith({ kind: "songs", ids: ["one", "two"], patch: { keywords: ["encore"] } });
    expect(useSongLibrary.getState().notice).toBe("Updated 2 songs.");
  });

  it("makes a playlist from the plays since a date, and clears the history", async () => {
    api.playlists.mockResolvedValue(undefined);
    reset({
      index: {
        ...emptyLibrary(),
        songs: songs(),
        history: [
          { songId: "two", at: "2026-03-01T00:00:00.000Z" },
          { songId: "four", at: "2025-01-01T00:00:00.000Z" },
        ],
      },
    });
    await useSongLibrary.getState().playlistFromHistory("  March  ", "2026-01-01");
    expect(api.playlists).toHaveBeenCalledWith([expect.objectContaining({ name: "March", songs: ["two"], sets: [] })]);
    await expect(useSongLibrary.getState().playlistFromHistory("Empty", "2030-01-01")).resolves.toBeUndefined();
    expect(useSongLibrary.getState().error).toBe("No songs were played since that date.");
    await useSongLibrary.getState().clearHistory();
    expect(api.organise).toHaveBeenCalledWith({ kind: "history", history: [] });
  });

  it("remembers the playlist set a play came from, and forgets it when a single song loads", async () => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
    reset({ index: { ...emptyLibrary(), songs: [saved] }, playingSet: null });
    await useSongLibrary.getState().playPlaylist([saved.id, saved.id], 0, "set-1");
    expect(useSongLibrary.getState().playingSet).toBe("set-1");
    await useSongLibrary.getState().load(saved.id);
    expect(useSongLibrary.getState().error).toBe("");
    expect(useSongLibrary.getState().playingSet).toBeNull();
  });

  it("keeps the playing set when Next song is pressed while the set is paused", async () => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
    reset({ index: { ...emptyLibrary(), songs: [saved] }, queue: [saved.id, saved.id], playlistPlaying: false, playingSet: "set-1", busy: false });
    await useSongLibrary.getState().skipPlaylist(1);
    expect(useSongLibrary.getState()).toMatchObject({ position: 1, playlistPlaying: false, playingSet: "set-1" });
  });

  it("keeps the playing set when Previous song is pressed while the set is paused", async () => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
    reset({ index: { ...emptyLibrary(), songs: [saved] }, queue: [saved.id, saved.id], position: 1, playlistPlaying: false, playingSet: "set-1", busy: false });
    await useSongLibrary.getState().skipPlaylist(-1);
    expect(useSongLibrary.getState()).toMatchObject({ position: 0, playlistPlaying: false, playingSet: "set-1" });
  });

  it("forgets the playing set when a hand load picks another entry of the same playlist", async () => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
    reset({ index: { ...emptyLibrary(), songs: [saved] }, playingSet: null });
    await useSongLibrary.getState().playPlaylist([saved.id, saved.id], 0, "set-1");
    expect(useSongLibrary.getState().playingSet).toBe("set-1");
    await useSongLibrary.getState().load(saved.id, [saved.id, saved.id], 1);
    expect(useSongLibrary.getState()).toMatchObject({ error: "", position: 1, playlistPlaying: false, playingSet: null });
  });
});

it("removing a song that is only queued drops it from the queue and leaves the playing set alone", async () => {
  const songs = [songNamed("one", "One"), songNamed("two", "Two"), songNamed("three", "Three")];
  useSongLibrary.setState({
    index: { ...emptyLibrary(), songs },
    queue: ["one", "two", "three", "two"],
    position: 0,
    playlistPlaying: true,
    playingSet: "set-1",
  });
  api.remove.mockResolvedValue(undefined);
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: songs.filter((s) => s.id !== "two") });
  await useSongLibrary.getState().remove("two");
  expect(useSongLibrary.getState()).toMatchObject({ queue: ["one", "three"], position: 0, playlistPlaying: true, playingSet: "set-1" });
});

describe("per-entry overrides in the playing queue", () => {
  const loop = { endBehaviour: "loop" as const };
  const stop = { endBehaviour: "stop" as const };
  const songs = () => [songNamed("one", "One"), songNamed("two", "Two"), songNamed("three", "Three")];
  const reset = (extra: Partial<ReturnType<typeof useSongLibrary.getState>> = {}) =>
    useSongLibrary.setState({
      index: { ...emptyLibrary(), songs: songs() },
      queue: ["one", "two", "three"],
      queueOverrides: [null, null, null],
      position: 0,
      playlistPlaying: true,
      chainHold: null,
      prepared: null,
      error: "",
      notice: "",
      ...extra,
    });
  beforeEach(() => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: songs() });
  });

  it("sets an upcoming entry's override, and refuses one that is playing", () => {
    reset();
    expect(useSongLibrary.getState().setQueueOverride(2, loop)).toBeNull();
    expect(useSongLibrary.getState().queueOverrides).toEqual([null, null, loop]);
    expect(useSongLibrary.getState().setQueueOverride(0, stop)).toBe("That song is playing or has already played.");
    expect(useSongLibrary.getState().queueOverrides).toEqual([null, null, loop]);
  });

  it("undoes a chain when the next entry's setting changes, and leaves it alone otherwise", () => {
    const release = vi.fn();
    reset({ chainHold: { id: "two", release } });
    useSongLibrary.getState().setQueueOverride(2, loop);
    expect(release).not.toHaveBeenCalled();
    useSongLibrary.getState().setQueueOverride(1, { autoplay: false });
    expect(release).toHaveBeenCalledTimes(1);
    expect(useSongLibrary.getState().chainHold).toBeNull();
  });

  it("starts a playlist with each entry's override, so it is the queue's override", async () => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
    reset({ index: { ...emptyLibrary(), songs: [saved] } });
    await useSongLibrary.getState().playPlaylist([saved.id, saved.id], 0, undefined, [loop, null]);
    expect(useSongLibrary.getState().queueOverrides).toEqual([loop, null]);
  });

  it("gives the armed song its override, and keeps the others with theirs", () => {
    reset({ queue: ["one", "two", "three"], queueOverrides: [null, loop, stop], position: 0 });
    expect(useSongLibrary.getState().armNext("three")).toBeNull();
    expect(useSongLibrary.getState().queue).toEqual(["one", "three", "two"]);
    expect(useSongLibrary.getState().queueOverrides).toEqual([null, stop, loop]);
  });

  it("removes a queued song's override with it", async () => {
    reset({ queue: ["one", "two", "three"], queueOverrides: [null, stop, loop], position: 0 });
    api.remove.mockResolvedValue(undefined);
    await useSongLibrary.getState().remove("two");
    expect(useSongLibrary.getState().queue).toEqual(["one", "three"]);
    expect(useSongLibrary.getState().queueOverrides).toEqual([null, loop]);
  });
});

describe("warning when the next song cannot be loaded in the background", () => {
  const next: LibrarySong = { ...saved, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "Second song", settings: {} };
  const missing = () => new Response(null, { status: 404 });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  beforeEach(() => {
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved, next] });
    api.audioUrls.mockImplementation(async (id: string) =>
      id === next.id
        ? { source: "app://damaged/source", guitar: "app://damaged/guitar" }
        : { source: "app://library/rev/source.flac", guitar: "app://library/rev/guitar.flac" },
    );
    fetchFile.mockImplementation(async (url: string) => (url.startsWith("app://damaged") ? missing() : file()));
  });

  it("names the next song at once, while the current one keeps playing", async () => {
    await useSongLibrary.getState().playPlaylist([saved.id, next.id]);
    await vi.waitFor(() => expect(useSongLibrary.getState().error).not.toBe(""));
    expect(useSongLibrary.getState().error).toBe(
      `"Second song" cannot be loaded: Missing or damaged audio: none of this song's tracks can be read. The set will stop after this song.`,
    );
    expect(useSongLibrary.getState()).toMatchObject({ playlistPlaying: true, position: 0 });
    expect(useSong.getState().source?.libraryId).toBe(saved.id);
  });

  it("stays silent when the preload is cancelled by pausing the set", async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => (release = resolve));
    fetchFile.mockImplementation(async (url: string) => (url.startsWith("app://damaged") ? held : file()));
    await useSongLibrary.getState().playPlaylist([saved.id, next.id]);
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledWith("app://damaged/source"));
    useSongLibrary.getState().pausePlaylist();
    release(missing());
    await tick();
    expect(useSongLibrary.getState().error).toBe("");
  });

  it("stays silent when the next entry is removed while its preload is still loading", async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => (release = resolve));
    fetchFile.mockImplementation(async (url: string) => (url.startsWith("app://damaged") ? held : file()));
    await useSongLibrary.getState().playPlaylist([saved.id, next.id]);
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledWith("app://damaged/source"));
    expect(useSongLibrary.getState().removeFromQueue(1)).toBeNull();
    release(missing());
    await tick();
    expect(useSongLibrary.getState().error).toBe("");
  });

  it("clears the warning when the next entry is removed from the queue", async () => {
    await useSongLibrary.getState().playPlaylist([saved.id, next.id]);
    await vi.waitFor(() => expect(useSongLibrary.getState().error).toContain("Second song"));
    expect(useSongLibrary.getState().removeFromQueue(1)).toBeNull();
    expect(useSongLibrary.getState()).toMatchObject({ error: "", queue: [saved.id], playlistPlaying: true });
  });
});

describe("playlist writes", () => {
  const first = { id: "p1", name: "Set", songs: [] as string[], sets: [] };
  let stored: typeof first[] = [];
  beforeEach(() => {
    stored = [first];
    api.index.mockImplementation(async () => ({ ...emptyLibrary(), songs: [saved], playlists: stored }));
    api.playlists.mockImplementation(async (next: typeof first[]) => {
      stored = next;
    });
    useSongLibrary.setState({ index: { ...emptyLibrary(), songs: [saved], playlists: [first] }, busy: false, error: "" });
  });

  it("lands two edits made back to back, in order, the second on top of the first", async () => {
    let release!: () => void;
    api.playlists.mockImplementationOnce(async (next: typeof first[]) => {
      await new Promise<void>((done) => (release = done));
      stored = next;
    });
    const a = useSongLibrary.getState().updatePlaylist("p1", { songs: [saved.id] });
    const b = useSongLibrary.getState().updatePlaylist("p1", { name: "Renamed" });
    await vi.waitFor(() => expect(api.playlists).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([a, b]);
    expect(api.playlists).toHaveBeenCalledTimes(2);
    expect(stored[0]).toMatchObject({ name: "Renamed", songs: [saved.id] });
  });

  it("does not drop a write while the library is busy with another action", async () => {
    useSongLibrary.setState({ busy: true });
    await useSongLibrary.getState().updatePlaylist("p1", { name: "Kept" });
    expect(api.playlists).toHaveBeenCalledTimes(1);
    expect(stored[0].name).toBe("Kept");
  });

  it("shows a failed write as an error and still runs the writes queued after it", async () => {
    api.playlists.mockRejectedValueOnce(new Error("Disk full"));
    await useSongLibrary.getState().updatePlaylist("p1", { name: "A" });
    await useSongLibrary.getState().updatePlaylist("p1", { name: "B" });
    expect(useSongLibrary.getState().error).toBe("Disk full");
    expect(api.playlists).toHaveBeenLastCalledWith([expect.objectContaining({ name: "B" })]);
  });

  it("adds and deletes playlists from the latest list, so neither overwrites the other", async () => {
    await Promise.all([
      useSongLibrary.getState().addPlaylist({ id: "p2", name: "Two", songs: [], sets: [] }),
      useSongLibrary.getState().deletePlaylist("p1"),
    ]);
    expect(stored.map((p) => p.id)).toEqual(["p2"]);
  });
});

/** Each decode gives its own audio object, as the real decoder does, so each track's identity is its own. */
const decodeAll = () => codec.decodeTrack.mockImplementation(async () => ({ sampleRate: 44100, channels: [new Float32Array([0, 0.25, -0.25])] }));
it("a settings-only re-save keeps every stored file and encodes nothing", async () => {
  decodeAll();
  await useSongLibrary.getState().load(saved.id);
  setSetting(performanceKey(useSong.getState().source), ":bpm", "100");
  await useSongLibrary.getState().save("Saved song", "");
  const [metadata, assets] = api.save.mock.calls[0];
  expect(assets).toEqual([]);
  expect(codec.encodeTrack).not.toHaveBeenCalled();
  expect(metadata.id).toBe(saved.id);
  expect(metadata.audio.map((a: { file: string; bytes: number; sha256: string }) => [a.file, a.bytes, a.sha256])).toEqual(
    saved.audio.map((a) => [a.file, a.bytes, a.sha256]),
  );
});
it("encodes only the track whose audio changed, and keeps the other stored files", async () => {
  decodeAll();
  await useSongLibrary.getState().load(saved.id);
  const stems = useSong.getState().stems!;
  useSong.setState({ stems: { ...stems, guitar: { sampleRate: 44100, channels: [new Float32Array([0.5, 0.5, 0.5])] } } });
  await useSongLibrary.getState().save("Saved song", "");
  const [metadata, assets] = api.save.mock.calls[0];
  expect(assets.map((a: { name: string }) => a.name)).toEqual(["guitar.flac"]);
  expect(codec.encodeTrack).toHaveBeenCalledTimes(1);
  expect(metadata.audio[0]).toMatchObject({ file: "source.flac", bytes: 8, sha256: saved.audio[0].sha256 });
  expect(metadata.audio[1]).toMatchObject({ file: "guitar.flac", bytes: 4 });
  expect(metadata.audio[1].sha256).not.toBe(saved.audio[1].sha256);
});
it("a new song's second save reuses the files its first save wrote", async () => {
  const source = { name: "draft.wav", audio };
  useSong.setState({ source, stems: { guitar: audio } });
  await useSongLibrary.getState().save("Draft", "");
  expect(codec.encodeTrack).toHaveBeenCalledTimes(2);
  const [first] = api.save.mock.calls[0];
  setSetting(performanceKey(useSong.getState().source), ":bpm", "101");
  await useSongLibrary.getState().save("Draft", "");
  const [second, assets] = api.save.mock.calls[1];
  expect(codec.encodeTrack).toHaveBeenCalledTimes(2);
  expect(assets).toEqual([]);
  expect(second.id).toBe(first.id);
  expect(second.audio.map((a: { sha256: string }) => a.sha256)).toEqual(first.audio.map((a: { sha256: string }) => a.sha256));
});

it("a re-save keeps the saved tracks this session could not read, and never saves a mix as the source", async () => {
  decodeAll();
  // The source file is damaged, so the session plays a mix of the stems.
  fetchFile.mockImplementation(async (url: string) => (String(url).includes("source") ? new Response(null, { status: 404 }) : file()));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await useSongLibrary.getState().load(saved.id);
  await useSongLibrary.getState().save("Saved song", "");
  const [metadata, assets] = api.save.mock.calls[0];
  expect(assets).toEqual([]);
  expect(codec.encodeTrack).not.toHaveBeenCalled();
  expect(metadata.audio.map((a: { file: string; sha256: string }) => [a.file, a.sha256])).toEqual(saved.audio.map((a) => [a.file, a.sha256]));
  expect(metadata.duration).toBe(saved.duration);
});
it("a re-save keeps an unread stem but drops one the user removed", async () => {
  decodeAll();
  const two = { ...saved, audio: [...saved.audio, { ...saved.audio[1], name: "bass", file: "bass.flac", sha256: "c".repeat(64) }] };
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [two] });
  api.audioUrls.mockResolvedValue({ source: "u/source.flac", guitar: "u/guitar.flac", bass: "u/bass.flac" });
  fetchFile.mockImplementation(async (url: string) => (String(url).includes("bass") ? new Response(null, { status: 404 }) : file()));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await useSongLibrary.getState().load(saved.id);
  await useSongLibrary.getState().save("Saved song", "");
  expect(api.save.mock.calls[0][0].audio.map((a: { name: string }) => a.name)).toEqual(["source", "guitar", "bass"]);
  const { guitar: _removed, ...rest } = useSong.getState().stems!;
  useSong.setState({ stems: Object.keys(rest).length ? rest : null });
  await useSongLibrary.getState().save("Saved song", "");
  expect(api.save.mock.calls[1][0].audio.map((a: { name: string }) => a.name)).toEqual(["source", "bass"]);
});

describe("the practice mute on a prepared song", () => {
  const prepared = (settings: Record<string, string> = {}) => {
    const player = { names: ["vocals", "guitar", "drums"], setMix: vi.fn(), dispose: vi.fn(() => Promise.resolve()) };
    return { id: "two", title: "Two", stems: { vocals: audio, guitar: audio, drums: audio }, tracks: {}, settings, skipped: [], player } as never as Parameters<typeof applyPracticeMute>[0] & {
      player: typeof player;
    };
  };
  const guitarOf = (song: ReturnType<typeof prepared>) => song.player.setMix.mock.calls.at(-1)?.[0].guitar;

  beforeEach(() => usePracticeMute.getState().clear());

  it("mutes the guitar before the join, and leaves the other tracks alone", () => {
    usePracticeMute.getState().set("guitar", true);
    const song = prepared();
    applyPracticeMute(song);
    expect(guitarOf(song)?.mute).toBe(true);
    expect(song.player.setMix.mock.calls.at(-1)?.[0].vocals).toBeUndefined();
  });

  it("makes no call when nothing is muted", () => {
    const song = prepared();
    applyPracticeMute(song);
    expect(song.player.setMix).not.toHaveBeenCalled();
  });

  it("follows a change made while the song waits, and brings the track back when the mute is turned off", () => {
    const song = prepared();
    useSongLibrary.setState({ prepared: song });
    usePracticeMute.getState().set("guitar", true);
    expect(guitarOf(song)?.mute).toBe(true);
    usePracticeMute.getState().clear();
    expect(guitarOf(song)).toBeUndefined();
    useSongLibrary.setState({ prepared: null });
  });

  it("uses what the song saved for an imported track", () => {
    usePracticeMute.getState().set("guitar", true);
    const song = prepared({ ":options": JSON.stringify({ practiceKinds: { t1: "guitar" } }) });
    song.player.names.push("t1");
    (song as { tracks: Record<string, unknown> }).tracks = { t1: { kind: "user", name: "Click" } };
    applyPracticeMute(song);
    expect(song.player.setMix.mock.calls.at(-1)?.[0].t1?.mute).toBe(true);
  });
});
