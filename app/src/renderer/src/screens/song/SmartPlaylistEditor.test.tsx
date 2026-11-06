import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong, type Playlist } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";

const api = vi.hoisted(() => ({ playlists: vi.fn(), index: vi.fn(), organise: vi.fn(), onTransferProgress: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));

const song = (id: string, title: string, keywords: string[]): LibrarySong => ({
  id,
  title,
  artist: "",
  sourceName: "",
  duration: 60,
  audio: [],
  settings: {},
  updated: "",
  keywords,
});
const songs = [song("a", "Alpha", ["encore"]), song("b", "Bravo", []), song("c", "Charlie", ["encore"])];
const smart: Playlist = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Encores",
  songs: [],
  smart: { match: "all", rules: [{ field: "keyword", op: "has", value: "encore" }], sort: "title" },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.playlists.mockResolvedValue(undefined);
  api.index.mockResolvedValue({ ...emptyLibrary(), songs });
  useSongLibrary.setState({
    index: { ...emptyLibrary(), songs, playlists: [smart] },
    busy: false,
    error: "",
    notice: "",
    queue: [],
    position: -1,
    playlistPlaying: false,
  });
});
afterEach(cleanup);

it("shows the songs its rules pick now, and saves only when the rules have changed", async () => {
  render(<SmartPlaylistEditor playlist={smart} />);
  expect(screen.getByText("2 songs · 2:00 · saved")).toBeTruthy();
  expect((screen.getByText("Save rules") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Rule 1 value"), { target: { value: "" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Save rules"));
  });
  expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain("Enter a keyword to match.");
  expect(api.playlists).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Rule 1 value"), { target: { value: "ballad" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Save rules"));
  });
  expect(api.playlists).toHaveBeenCalledWith([
    expect.objectContaining({ smart: expect.objectContaining({ rules: [{ field: "keyword", op: "has", value: "ballad" }] }) }),
  ]);
});

it("refuses to play a smart playlist whose rule cannot run, and says so", () => {
  const broken: Playlist = { ...smart, smart: { match: "all", rules: [{ field: "bpm", op: "between", value: [9, 1] }], sort: "title" } };
  render(<SmartPlaylistEditor playlist={broken} />);
  expect(screen.getByText(/No songs, until the rules are fixed\./)).toBeTruthy();
  expect((screen.getByText("Play playlist") as HTMLButtonElement).disabled).toBe(true);
});
