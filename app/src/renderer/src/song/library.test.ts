import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSong } from "./store";
import { useSongLibrary } from "./library";
import { useNav } from "@/state/nav";

const api = vi.hoisted(() => ({
  index: vi.fn(),
  save: vi.fn(),
  audioUrls: vi.fn(),
  remove: vi.fn(),
  exportBackup: vi.fn(),
  inspectBackup: vi.fn(),
  restoreBackup: vi.fn(),
  onTransferProgress: vi.fn(),
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
    { name: "source", sampleRate: 44100, frames: 3, channels: 1, file: "source.flac", codec: "flac", bytes: 8, sha256: "a".repeat(64), kind: "source" },
    { name: "guitar", sampleRate: 44100, frames: 3, channels: 1, file: "guitar.flac", codec: "flac", bytes: 8, sha256: "b".repeat(64), kind: "stem" },
  ],
  settings: { ":bpm": "95" },
  updated: "",
};
/** Each load decodes to its own audio object, as the worker does. */
const decodeAll = () => codec.decodeTrack.mockImplementation(async () => ({ ...audio, channels: [new Float32Array(audio.channels[0])] }));

beforeEach(() => {
  vi.clearAllMocks();
  api.exportBackup.mockResolvedValue(null);
  api.inspectBackup.mockResolvedValue(null);
  api.onTransferProgress.mockReturnValue(vi.fn());
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
  api.audioUrls.mockResolvedValue({ source: "app://library/rev/source.flac", guitar: "app://library/rev/guitar.flac" });
  api.save.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
  fetchFile.mockReset();
  fetchFile.mockImplementation(async () => file());
  codec.decodeTrack.mockReset();
  codec.decodeTrack.mockResolvedValue(audio);
  codec.encodeTrack.mockReset();
  codec.encodeTrack.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  useSong.setState({ source: null, stems: null, range: null, lastSplit: null, status: { kind: "idle" } });
  useSongLibrary.setState({ index: emptyLibrary(), busy: false, error: "", notice: "", transfer: "", backupPreview: null });
});

describe("opening a saved song", () => {
  it("puts the source and stems in the song store and opens the Stems tab", async () => {
    await useSongLibrary.getState().load(saved.id);
    expect(useSong.getState().source).toMatchObject({ name: "same.mp3", libraryId: saved.id });
    expect(useSong.getState().source?.audio.channels[0]).toEqual(audio.channels[0]);
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["guitar"]);
    expect(useSong.getState().status).toEqual({ kind: "done" });
    expect(useSongLibrary.getState().notice).toBe("Saved song ready.");
    expect(useNav.getState()).toMatchObject({ screen: "song", param: "stems" });
  });

  it("refuses a song that is not in the library", async () => {
    await useSongLibrary.getState().load("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(useSongLibrary.getState().error).toBe("Song is missing from the library.");
    expect(useSong.getState().source).toBeNull();
  });

  it("skips a track whose read fails, names it, and opens the song anyway", async () => {
    useSong.setState({ source: { name: "Current", audio } });
    fetchFile.mockRejectedValueOnce(new Error("Missing audio"));
    await useSongLibrary.getState().load(saved.id);
    expect(useSongLibrary.getState().error).toBe("");
    expect(useSongLibrary.getState().notice).toContain("Skipped source");
    expect(useSong.getState().source?.libraryId).toBe(saved.id);
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["guitar"]);
  });

  it("skips a track whose file size or decoded shape does not match the library", async () => {
    fetchFile.mockResolvedValueOnce(file(3));
    await useSongLibrary.getState().load(saved.id);
    expect(useSongLibrary.getState().notice).toContain("Skipped source");
    codec.decodeTrack.mockResolvedValueOnce({ sampleRate: 44100, channels: [new Float32Array(2)] });
    await useSongLibrary.getState().load(saved.id);
    expect(useSongLibrary.getState().notice).toContain("Skipped source");
    expect(useSong.getState().source).not.toBeNull();
  });

  it("builds the source from the stems when the source cannot be read", async () => {
    fetchFile.mockRejectedValueOnce(new Error("Missing audio"));
    await useSongLibrary.getState().load(saved.id);
    expect(useSong.getState().source?.audio.channels).toHaveLength(2);
  });

  it("leaves out tracks this version does not play, and says so", async () => {
    const withImport: LibrarySong = {
      ...saved,
      audio: [...saved.audio, { name: "Click", sampleRate: 44100, frames: 3, channels: 1, file: "track0.flac", codec: "flac", bytes: 8, sha256: "c".repeat(64), kind: "user" }],
    };
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [withImport] });
    api.audioUrls.mockResolvedValue({ source: "u", guitar: "u", track0: "u" });
    await useSongLibrary.getState().load(saved.id);
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["guitar"]);
    expect(useSongLibrary.getState().notice).toContain("Skipped Click");
  });

  it("reports a clear error for a song that is still being converted", async () => {
    api.audioUrls.mockRejectedValueOnce(new Error("This song is still being converted to the compact library format. Try again in a moment."));
    await useSongLibrary.getState().load(saved.id);
    expect(useSongLibrary.getState().error).toContain("still being converted");
    expect(fetchFile).not.toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("saves the source and stems under a new id, not the file name", async () => {
    const source = { name: "same.mp3", audio };
    useSong.setState({ source, stems: { guitar: audio } });
    await useSongLibrary.getState().save("My song", "Artist");
    const [metadata, assets] = api.save.mock.calls[0];
    expect(metadata.id).not.toBe(saved.id);
    expect(metadata).toMatchObject({ title: "My song", artist: "Artist", sourceName: "same.mp3", settings: {} });
    expect(assets.map((a: { name: string }) => a.name)).toEqual(["source.flac", "guitar.flac"]);
    expect(metadata.audio.map((a: { file: string; codec: string; bytes: number; kind: string }) => [a.file, a.codec, a.bytes, a.kind])).toEqual([
      ["source.flac", "flac", 4, "source"],
      ["guitar.flac", "flac", 4, "stem"],
    ]);
    expect(metadata.audio[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(useSong.getState().source?.libraryId).toBe(metadata.id);
  });

  it("stores the source at 24 bits only when its original file was deeper than 16", async () => {
    useSong.setState({ source: { name: "deep.wav", audio, bits: 24 }, stems: { guitar: audio } });
    await useSongLibrary.getState().save("Deep", "");
    expect(codec.encodeTrack.mock.calls.map(([, bits]) => bits)).toEqual([24, 16]);
  });

  it("refuses to save while a split is running", async () => {
    useSong.setState({ source: { name: "a.wav", audio }, status: { kind: "splitting", fraction: 0.2, backend: "wasm", pass: 1, passes: 1 } });
    await useSongLibrary.getState().save("A", "");
    expect(useSongLibrary.getState().error).toBe("Wait for the song to finish loading or splitting.");
    expect(api.save).not.toHaveBeenCalled();
  });

  it("keeps the saved settings of a song when it is saved again", async () => {
    decodeAll();
    await useSongLibrary.getState().refresh();
    await useSongLibrary.getState().load(saved.id);
    await useSongLibrary.getState().save("Saved song", "");
    expect(api.save.mock.calls[0][0].settings).toEqual({ ":bpm": "95" });
  });

  it("a re-save with nothing changed keeps every stored file and encodes nothing", async () => {
    decodeAll();
    await useSongLibrary.getState().load(saved.id);
    await useSongLibrary.getState().save("Saved song", "");
    const [metadata, assets] = api.save.mock.calls[0];
    expect(assets).toEqual([]);
    expect(codec.encodeTrack).not.toHaveBeenCalled();
    expect(metadata.id).toBe(saved.id);
    expect(metadata.audio.map((a: { file: string; bytes: number; sha256: string }) => [a.file, a.bytes, a.sha256])).toEqual(
      saved.audio.map((a) => [a.file, a.bytes, a.sha256]),
    );
  });

  it("encodes only the track whose audio changed", async () => {
    decodeAll();
    await useSongLibrary.getState().load(saved.id);
    const stems = useSong.getState().stems!;
    useSong.setState({ stems: { ...stems, guitar: { sampleRate: 44100, channels: [new Float32Array([0.5, 0.5, 0.5])] } } });
    await useSongLibrary.getState().save("Saved song", "");
    const [metadata, assets] = api.save.mock.calls[0];
    expect(assets.map((a: { name: string }) => a.name)).toEqual(["guitar.flac"]);
    expect(codec.encodeTrack).toHaveBeenCalledTimes(1);
    expect(metadata.audio[0]).toMatchObject({ file: "source.flac", bytes: 8, sha256: saved.audio[0].sha256 });
    expect(metadata.audio[1].sha256).not.toBe(saved.audio[1].sha256);
  });

  it("a new song's second save reuses the files its first save wrote", async () => {
    useSong.setState({ source: { name: "draft.wav", audio }, stems: { guitar: audio } });
    await useSongLibrary.getState().save("Draft", "");
    expect(codec.encodeTrack).toHaveBeenCalledTimes(2);
    const [first] = api.save.mock.calls[0];
    await useSongLibrary.getState().save("Draft", "");
    const [second, assets] = api.save.mock.calls[1];
    expect(codec.encodeTrack).toHaveBeenCalledTimes(2);
    expect(assets).toEqual([]);
    expect(second.id).toBe(first.id);
  });
});

describe("deleting", () => {
  it("deletes the song and refreshes the list", async () => {
    await useSongLibrary.getState().remove(saved.id);
    expect(api.remove).toHaveBeenCalledWith(saved.id);
    expect(useSongLibrary.getState().notice).toBe("Song moved to the Trash.");
  });

  it("keeps the open song open, as an unsaved one", async () => {
    useSong.setState({ source: { name: "same.mp3", audio, libraryId: saved.id } });
    await useSongLibrary.getState().remove(saved.id);
    expect(useSong.getState().source).toMatchObject({ name: "same.mp3" });
    expect(useSong.getState().source?.libraryId).toBeUndefined();
  });

  it("shows the failure and keeps the list when the delete fails", async () => {
    api.remove.mockRejectedValueOnce(new Error("Disk is read-only"));
    await useSongLibrary.getState().remove(saved.id);
    expect(useSongLibrary.getState()).toMatchObject({ error: "Disk is read-only", busy: false });
  });
});

describe("backup and restore", () => {
  it("reports progress, and cleans up the listener", async () => {
    const unsubscribe = vi.fn();
    api.onTransferProgress.mockImplementationOnce((callback) => {
      callback({ phase: "Checking files", completed: 1, total: 4 });
      return unsubscribe;
    });
    api.exportBackup.mockResolvedValueOnce({ songs: 1, playlists: 0, fileName: "demo.tar.gz" });
    await useSongLibrary.getState().exportBackup();
    expect(unsubscribe).toHaveBeenCalled();
    expect(useSongLibrary.getState()).toMatchObject({ busy: false, transfer: "", notice: "Exported 1 songs to demo.tar.gz." });
  });

  it("treats a cancelled picker as cancellation and preserves the library", async () => {
    const index = { ...emptyLibrary(), songs: [saved] };
    useSongLibrary.setState({ index });
    await useSongLibrary.getState().restoreBackup();
    expect(useSongLibrary.getState().index).toBe(index);
    expect(useSongLibrary.getState()).toMatchObject({ notice: "Backup restore cancelled.", error: "" });
  });

  it("refreshes the list after a restore, and reports a failure without clearing it", async () => {
    api.inspectBackup.mockResolvedValue({ fileName: "demo.tar.gz", songs: 1, playlists: 0, duplicates: 0 });
    api.restoreBackup.mockResolvedValueOnce({ songs: 1, playlists: 0, fileName: "demo.tar.gz" });
    await useSongLibrary.getState().restoreBackup();
    expect(api.restoreBackup).toHaveBeenCalledWith("copy");
    expect(useSongLibrary.getState().index.songs).toEqual([saved]);
    expect(useSong.getState().source).toBeNull();
    const index = useSongLibrary.getState().index;
    api.restoreBackup.mockRejectedValueOnce(new Error("Checksum mismatch"));
    await useSongLibrary.getState().restoreBackup();
    expect(useSongLibrary.getState().index).toBe(index);
    expect(useSongLibrary.getState()).toMatchObject({ error: "Checksum mismatch", busy: false, transfer: "" });
  });

  it("asks before restoring songs that are already saved, and restores with the chosen mode", async () => {
    const preview = { fileName: "demo.tar.gz", songs: 3, playlists: 0, duplicates: 2 };
    api.inspectBackup.mockResolvedValue(preview);
    await useSongLibrary.getState().restoreBackup();
    expect(useSongLibrary.getState().backupPreview).toEqual(preview);
    expect(api.restoreBackup).not.toHaveBeenCalled();
    api.restoreBackup.mockResolvedValueOnce({ songs: 1, playlists: 0, skipped: 2, fileName: "demo.tar.gz" });
    await useSongLibrary.getState().finishRestore("skip");
    expect(api.restoreBackup).toHaveBeenCalledWith("skip");
    expect(useSongLibrary.getState()).toMatchObject({ backupPreview: null, notice: expect.stringContaining("Skipped 2 songs") });
  });

  it("restores nothing when the duplicate prompt is cancelled", async () => {
    api.inspectBackup.mockResolvedValue({ fileName: "demo.tar.gz", songs: 1, playlists: 0, duplicates: 1 });
    await useSongLibrary.getState().restoreBackup();
    await useSongLibrary.getState().finishRestore(null);
    expect(api.restoreBackup).not.toHaveBeenCalled();
    expect(useSongLibrary.getState()).toMatchObject({ backupPreview: null, notice: "Backup restore cancelled." });
  });
});
