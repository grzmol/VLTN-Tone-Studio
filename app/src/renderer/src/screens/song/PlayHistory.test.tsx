import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { PlayHistory } from "./PlayHistory";

const api = vi.hoisted(() => ({ playlists: vi.fn(), index: vi.fn(), organise: vi.fn(), onTransferProgress: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));

const song = (id: string, title: string): LibrarySong => ({ id, title, artist: "", sourceName: "", duration: 60, audio: [], settings: {}, updated: "" });
const songs = [song("a", "Alpha"), song("b", "Bravo")];
beforeEach(() => {
  vi.clearAllMocks();
  api.organise.mockResolvedValue(undefined);
  api.playlists.mockResolvedValue(undefined);
  api.index.mockResolvedValue({ ...emptyLibrary(), songs });
  useSongLibrary.setState({
    index: {
      ...emptyLibrary(),
      songs,
      history: [
        { songId: "a", at: "2026-06-01T20:00:00.000Z" },
        { songId: "b", at: "2026-06-02T20:00:00.000Z" },
      ],
    },
    busy: false,
    error: "",
    notice: "",
  });
});
afterEach(cleanup);

it("lists the latest plays, newest first, with the song titles", () => {
  render(<PlayHistory />);
  const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
  expect(items[0]).toContain("Bravo");
  expect(items[1]).toContain("Alpha");
});

it("names the playlist and set of a play made in a set, and shows nothing for an unknown set or no set", () => {
  const playlists = [{ id: "p", name: "Gig", songs: ["a", "b"], sets: [{ id: "s1", name: "Set 1", start: 0 }] }];
  useSongLibrary.setState({
    index: {
      ...emptyLibrary(),
      songs,
      playlists,
      history: [
        { songId: "a", at: "2026-06-01T20:00:00.000Z" },
        { songId: "a", at: "2026-06-01T21:00:00.000Z", setId: "gone" },
        { songId: "b", at: "2026-06-02T20:00:00.000Z", setId: "s1" },
      ],
    },
  });
  render(<PlayHistory />);
  const [known, unknown, none] = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
  expect(known).toContain("Gig › Set 1 · ");
  expect(unknown.split("·")).toHaveLength(2);
  expect(none.split("·")).toHaveLength(2);
});

it("needs a name before a playlist can be made from the history", async () => {
  render(<PlayHistory />);
  const make = screen.getByText("Create playlist from history") as HTMLButtonElement;
  expect(make.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("History since"), { target: { value: "2026-05-01" } });
  fireEvent.change(screen.getByLabelText("History playlist name"), { target: { value: "June" } });
  expect(make.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(make);
  });
  expect(api.playlists).toHaveBeenCalledWith([expect.objectContaining({ name: "June", songs: ["a", "b"] })]);
});

it("clears the history only after a second confirmation", async () => {
  render(<PlayHistory />);
  fireEvent.click(screen.getByText("Clear history…"));
  expect(api.organise).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText("Confirm clear"));
  });
  expect(api.organise).toHaveBeenCalledWith({ kind: "history", history: [] });
});
