import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSong } from "./store";
import { audioUnsaved, confirmLeave, savedNotice, useSongLibrary } from "./library";
import { useLeaveGuard, mountLeaveGuard } from "./leave-guard";
import { setSongPlaying } from "./performance/playing-state";
import { clearSettingsCache } from "./performance/settings";
import type { PcmAudio } from "./types";

const api = vi.hoisted(() => ({
  index: vi.fn(),
  save: vi.fn(),
  audioUrls: vi.fn(),
  playlists: vi.fn(),
  remove: vi.fn(),
  updateSettings: vi.fn(),
  onTransferProgress: vi.fn(),
  organise: vi.fn(),
}));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
vi.mock("./stems/engine", () => ({ separateStems: vi.fn() }));
const codec = vi.hoisted(() => ({ decodeTrack: vi.fn(), encodeTrack: vi.fn() }));
vi.mock("./codec/flac-client", () => codec);
vi.stubGlobal("fetch", vi.fn());

const pcm = (): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array([0, 0.25, -0.25])] });
const song = (id: string, title: string): LibrarySong => ({
  id,
  title,
  artist: "Band",
  sourceName: `${title}.mp3`,
  duration: 3 / 44100,
  audio: [
    { name: "source", sampleRate: 44100, frames: 3, channels: 1, file: "source.flac", codec: "flac", bytes: 8, sha256: "a".repeat(64) },
    { name: "guitar", sampleRate: 44100, frames: 3, channels: 1, file: "guitar.flac", codec: "flac", bytes: 8, sha256: "b".repeat(64) },
  ],
  settings: {},
  updated: "",
});
const first = song("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Insomnia");
const second = song("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Other");

/** A save that waits until the test lets it finish, so the test can look at what is running meanwhile. */
function heldSaves() {
  const gates: (() => void)[] = [];
  let running = 0,
    most = 0;
  api.save.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        running++;
        most = Math.max(most, running);
        gates.push(() => {
          running--;
          resolve();
        });
      }),
  );
  return { release: () => gates.shift()?.(), most: () => most };
}

async function openFirst() {
  await useSongLibrary.getState().load(first.id);
  api.save.mockClear();
  codec.encodeTrack.mockClear();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearSettingsCache();
  setSongPlaying(false);
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [first, second] });
  api.audioUrls.mockResolvedValue({ source: "app://x/source.flac", guitar: "app://x/guitar.flac" });
  api.onTransferProgress.mockReturnValue(vi.fn());
  api.updateSettings.mockResolvedValue(undefined);
  api.save.mockReset();
  api.save.mockResolvedValue(undefined);
  vi.mocked(fetch).mockImplementation(async () => new Response(new Uint8Array(8)));
  codec.decodeTrack.mockReset();
  codec.decodeTrack.mockImplementation(async () => pcm());
  codec.encodeTrack.mockReset();
  codec.encodeTrack.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  useLeaveGuard.setState({ mounted: 0, asking: null });
  useSong.setState({ source: null, stems: null, tracks: {}, status: { kind: "idle" } });
  useSongLibrary.setState({
    index: emptyLibrary(),
    busy: false,
    error: "",
    notice: "",
    saveStep: "",
    saveError: "",
    queue: [],
    position: -1,
    playlistPlaying: false,
    midiSession: null,
  });
});

describe("autosave of audio for a library song", () => {
  it("saves once after generated parts are applied, and writes only the new track", async () => {
    await openFirst();
    expect(useSong.getState().applyGeneratedParts({ drums: pcm() })).toEqual([]);
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(codec.encodeTrack).toHaveBeenCalledTimes(1);
    const [saved, assets] = api.save.mock.calls[0];
    expect(saved).toMatchObject({ id: first.id, title: "Insomnia", artist: "Band" });
    expect(saved.audio).toHaveLength(3);
    expect(assets).toHaveLength(1);
    // Reporting a notice is for the Save button; a save the user did not ask for stays quiet.
    expect(useSongLibrary.getState().notice).toBe("Insomnia ready.");
  });

  it("saves after a removal, when the saved song has a track the open song no longer has", async () => {
    await openFirst();
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    api.index.mockResolvedValue({ ...emptyLibrary(), songs: [{ ...first, audio: api.save.mock.calls[0][0].audio }, second] });
    await vi.waitFor(() => expect(useSongLibrary.getState().saveStep).toBe(""));
    await useSongLibrary.getState().refresh();
    api.save.mockClear();
    useSong.getState().removeGeneratedParts();
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save.mock.calls[0][0].audio).toHaveLength(2);
  });

  it("runs one save at a time and queues one more for any number of changes made meanwhile", async () => {
    await openFirst();
    const held = heldSaves();
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    useSong.getState().applyGeneratedParts({ bass: pcm() });
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    expect(api.save).toHaveBeenCalledTimes(1);
    held.release();
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    held.release();
    await vi.waitFor(() => expect(useSongLibrary.getState().saveStep).toBe(""));
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(held.most()).toBe(1);
  });

  it("does not save while the song plays, and saves as soon as playback stops", async () => {
    await openFirst();
    setSongPlaying(true);
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.save).not.toHaveBeenCalled();
    setSongPlaying(false);
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  });

  it("does not save while a playlist plays", async () => {
    await openFirst();
    useSongLibrary.setState({ playlistPlaying: true });
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.save).not.toHaveBeenCalled();
    useSongLibrary.setState({ playlistPlaying: false });
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  });

  it("does not save a song that is not in the library", async () => {
    useSong.setState({ source: { name: "a.wav", audio: pcm() }, stems: { source: pcm(), track1: pcm() }, tracks: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.save).not.toHaveBeenCalled();
    expect(audioUnsaved(useSong.getState().source, useSong.getState().stems, undefined)).toBe(true);
  });

  it("leaves a song alone that was only loaded", async () => {
    await openFirst();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.save).not.toHaveBeenCalled();
    expect(audioUnsaved(useSong.getState().source, useSong.getState().stems, first)).toBe(false);
  });

  it("shows the step it is on, and keeps the error when a save fails", async () => {
    await openFirst();
    const steps: string[] = [];
    useSongLibrary.subscribe((s) => {
      if (s.saveStep && steps.at(-1) !== s.saveStep) steps.push(s.saveStep);
    });
    api.save.mockRejectedValueOnce(new Error("Disk is full"));
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    await vi.waitFor(() => expect(useSongLibrary.getState().saveError).toBe("Disk is full"));
    expect(steps.some((step) => step.startsWith("Encoding"))).toBe(true);
    expect(steps.at(-1)).toBe("Writing files…");
    expect(useSongLibrary.getState().saveStep).toBe("");
    // Try again works and clears the error.
    await useSongLibrary.getState().save("Insomnia", "Band");
    expect(useSongLibrary.getState().saveError).toBe("");
  });

  it("words the result of the Save button with the tracks written and kept", async () => {
    await openFirst();
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useSongLibrary.getState().saveStep).toBe(""));
    await useSongLibrary.getState().save("Insomnia", "Band");
    expect(useSongLibrary.getState().notice).toBe("Saved Insomnia (0 tracks written, 3 kept).");
    expect(savedNotice("Insomnia", 1, 5)).toBe("Saved Insomnia (1 track written, 5 kept).");
  });
});

describe("the warning before the open song is replaced", () => {
  const openUnsaved = () => {
    useSong.setState({ source: { name: "Insomnia.wav", audio: pcm() }, stems: { source: pcm(), track1: pcm() }, tracks: {} });
  };

  it("asks first, and Cancel keeps the song", async () => {
    mountLeaveGuard();
    openUnsaved();
    const loading = useSongLibrary.getState().load(second.id);
    await vi.waitFor(() => expect(useLeaveGuard.getState().asking).not.toBeNull());
    expect(useLeaveGuard.getState().asking?.title).toBe("Save Insomnia first?");
    useLeaveGuard.getState().asking?.answer("cancel");
    await loading;
    expect(useSong.getState().source?.name).toBe("Insomnia.wav");
    expect(api.save).not.toHaveBeenCalled();
  });

  it("loads the new song on Don't save, without saving", async () => {
    mountLeaveGuard();
    openUnsaved();
    const loading = useSongLibrary.getState().load(second.id);
    await vi.waitFor(() => expect(useLeaveGuard.getState().asking).not.toBeNull());
    useLeaveGuard.getState().asking?.answer("discard");
    await loading;
    expect(useSong.getState().source?.libraryId).toBe(second.id);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("saves and then loads on Save and continue", async () => {
    mountLeaveGuard();
    openUnsaved();
    const loading = useSongLibrary.getState().load(second.id);
    await vi.waitFor(() => expect(useLeaveGuard.getState().asking).not.toBeNull());
    useLeaveGuard.getState().asking?.answer("save");
    await loading;
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0][0]).toMatchObject({ title: "Insomnia" });
    expect(useSong.getState().source?.libraryId).toBe(second.id);
  });

  it("stays on the song when Save and continue fails", async () => {
    mountLeaveGuard();
    openUnsaved();
    api.save.mockRejectedValueOnce(new Error("Disk is full"));
    const loading = useSongLibrary.getState().load(second.id);
    await vi.waitFor(() => expect(useLeaveGuard.getState().asking).not.toBeNull());
    useLeaveGuard.getState().asking?.answer("save");
    await loading;
    expect(useSong.getState().source?.name).toBe("Insomnia.wav");
  });

  it("does not ask when nothing is unsaved, or when no dialog is there to answer", async () => {
    mountLeaveGuard();
    await expect(confirmLeave()).resolves.toBe(true);
    useLeaveGuard.setState({ mounted: 0 });
    openUnsaved();
    await expect(confirmLeave()).resolves.toBe(true);
  });

  it("never asks in a playlist that is playing: the next song loads and the audio saves in the background", async () => {
    mountLeaveGuard();
    await openFirst();
    useSongLibrary.setState({ playlistPlaying: true, queue: [first.id, second.id], position: 0, queueOverrides: [null, null] });
    useSong.getState().applyGeneratedParts({ drums: pcm() });
    await useSongLibrary.getState().advancePlaylist();
    expect(useLeaveGuard.getState().asking).toBeNull();
    expect(useSong.getState().source?.libraryId).toBe(second.id);
    await useSongLibrary.getState().skipPlaylist(-1);
    expect(useLeaveGuard.getState().asking).toBeNull();
  });
});
