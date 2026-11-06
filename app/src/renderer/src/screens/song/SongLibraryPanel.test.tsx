import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SongLibraryPanel } from "./SongLibraryPanel";
import { useSongLibrary } from "@/song/library";
import { useSong } from "@/song/store";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";

const api = vi.hoisted(() => ({
  index: vi.fn(),
  exportBackup: vi.fn(),
  inspectBackup: vi.fn(),
  restoreBackup: vi.fn(),
  onTransferProgress: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
vi.mock("@/song/stems/engine", () => ({ separateStems: vi.fn() }));
const song: LibrarySong = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  title: "Saved song",
  artist: "Band",
  sourceName: "saved.wav",
  duration: 125,
  audio: [{ name: "source", sampleRate: 44100, frames: 10, channels: 2 }],
  settings: {},
  updated: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  api.index.mockResolvedValue(emptyLibrary());
  api.exportBackup.mockResolvedValue(null);
  api.inspectBackup.mockResolvedValue(null);
  api.restoreBackup.mockResolvedValue(null);
  api.remove.mockResolvedValue(undefined);
  api.onTransferProgress.mockReturnValue(vi.fn());
  useSong.setState({ source: null, stems: null, status: { kind: "idle" } });
  useSongLibrary.setState({ index: emptyLibrary(), busy: false, error: "", notice: "", transfer: "" });
});
afterEach(cleanup);

it("offers restore on an empty library, and cancels cleanly through the real store", async () => {
  await act(async () => {
    render(<SongLibraryPanel onPick={vi.fn()} />);
  });
  expect(screen.getByText("Nothing saved yet.")).toBeTruthy();
  expect(screen.getByText("Export library backup…").closest("button")!.disabled).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByText("Restore backup…"));
  });
  expect(api.inspectBackup).toHaveBeenCalledTimes(1);
  expect(api.restoreBackup).not.toHaveBeenCalled();
  expect(screen.getByText("Backup restore cancelled.")).toBeTruthy();
});

it("offers to skip songs that are already in the library", async () => {
  api.inspectBackup.mockResolvedValue({ fileName: "set.tar.gz", songs: 3, playlists: 0, duplicates: 2 });
  api.restoreBackup.mockResolvedValue({ songs: 1, playlists: 0, skipped: 2, fileName: "set.tar.gz" });
  await act(async () => {
    render(<SongLibraryPanel onPick={vi.fn()} />);
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Restore backup…"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Skip songs already in the library (2)"));
  });
  expect(api.restoreBackup).toHaveBeenCalledWith("skip");
});

it("lists saved songs, and deletes one only after the dialog says it goes to the Trash", async () => {
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [song] });
  await act(async () => {
    render(<SongLibraryPanel onPick={vi.fn()} />);
  });
  expect(screen.getByText("Saved song")).toBeTruthy();
  expect(screen.getByText(/Band · 2:05/)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Delete Saved song"));
  });
  expect(api.remove).not.toHaveBeenCalled();
  expect(screen.getByText(/moved to the Trash/)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByText("Move to the Trash"));
  });
  expect(api.remove).toHaveBeenCalledWith(song.id);
});

it("saves only once a song is open and has a title", async () => {
  await act(async () => {
    render(<SongLibraryPanel onPick={vi.fn()} />);
  });
  expect(screen.getByText("Save to library").closest("button")!.disabled).toBe(true);
  await act(async () => {
    useSong.setState({ source: { name: "demo.wav", audio: { sampleRate: 44100, channels: [new Float32Array(4)] } } });
  });
  expect(screen.getByText("Save to library").closest("button")!.disabled).toBe(false);
});
