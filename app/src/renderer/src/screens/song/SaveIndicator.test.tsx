import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { SaveBeforeLeaving, SaveIndicator, saveIndicator } from "./SaveIndicator";
import { useLeaveGuard } from "@/song/leave-guard";

vi.mock("@/host", () => ({ host: { song: { library: {} } } }));
vi.mock("@/song/codec/flac-client", () => ({ decodeTrack: vi.fn(), encodeTrack: vi.fn() }));
vi.mock("@/song/stems/engine", () => ({ separateStems: vi.fn() }));

const audio = { sampleRate: 44100, channels: [new Float32Array([0, 0.5])] };
const saved: LibrarySong = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  title: "Insomnia",
  artist: "Band",
  sourceName: "i.mp3",
  duration: 1,
  audio: [{ name: "source", sampleRate: 44100, frames: 2, channels: 1, file: "source.flac", codec: "flac", bytes: 8, sha256: "a".repeat(64) }],
  settings: {},
  updated: "",
};
afterEach(cleanup);
const base = { hasSong: true, inLibrary: true, audioUnsaved: false, saveStep: "", saveError: "" };

describe("saveIndicator", () => {
  it("shows nothing without a song", () => {
    expect(saveIndicator({ ...base, hasSong: false })).toBeNull();
  });
  it("is Saved when nothing is pending", () => {
    expect(saveIndicator(base)).toEqual({ kind: "saved" });
  });
  it("is Saving with the step while a save runs, even over an old error", () => {
    expect(saveIndicator({ ...base, saveStep: "Writing files…", saveError: "old" })).toEqual({ kind: "saving", step: "Writing files…" });
  });
  it("is Not saved for a song outside the library, and for a library song with audio waiting", () => {
    expect(saveIndicator({ ...base, inLibrary: false })).toEqual({ kind: "unsaved", inLibrary: false });
    expect(saveIndicator({ ...base, audioUnsaved: true })).toEqual({ kind: "unsaved", inLibrary: true });
  });
  it("is Couldn't save after a failure", () => {
    expect(saveIndicator({ ...base, saveError: "Disk is full" })).toEqual({ kind: "failed", message: "Disk is full" });
  });
});

describe("SaveIndicator", () => {
  const save = vi.fn();
  beforeEach(() => {
    save.mockReset().mockResolvedValue(undefined);
    useSong.setState({ source: null, stems: null, tracks: {} });
    useSongLibrary.setState({ index: emptyLibrary(), saveStep: "", saveError: "", save });
  });

  it("shows Saved for a library song, Saving… with the step, and Couldn't save with Try again", () => {
    useSong.setState({ source: { name: "i.mp3", libraryId: saved.id, audio } });
    useSongLibrary.setState({ index: { ...emptyLibrary(), songs: [saved] } });
    // The source was never loaded from the library here, so its audio counts as new.
    const view = render(<SaveIndicator />);
    expect(screen.getByText("Not saved")).toBeTruthy();
    useSongLibrary.setState({ saveStep: "Encoding Drums (generated)…" });
    view.rerender(<SaveIndicator />);
    expect(screen.getByText(/Saving… Encoding Drums \(generated\)…/)).toBeTruthy();
    useSongLibrary.setState({ saveStep: "", saveError: "Disk is full" });
    view.rerender(<SaveIndicator />);
    expect(screen.getByText("Couldn't save").getAttribute("title")).toBe("Disk is full");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(save).toHaveBeenCalledWith("Insomnia", "Band");
  });

  it("saves a file that is not in the library under its file name", () => {
    useSong.setState({ source: { name: "Live take.wav", audio } });
    render(<SaveIndicator />);
    expect(screen.getByText("Not saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    expect(save).toHaveBeenCalledWith("Live take", "");
  });
});

describe("SaveBeforeLeaving", () => {
  it("offers the three answers", () => {
    const answer = vi.fn();
    useLeaveGuard.setState({ mounted: 0, asking: { title: "Save Insomnia first?", detail: "Not saved.", answer } });
    render(<SaveBeforeLeaving />);
    expect(screen.getByText("Save Insomnia first?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(answer.mock.calls.map((call) => call[0])).toEqual(["save", "discard", "cancel"]);
  });
});
