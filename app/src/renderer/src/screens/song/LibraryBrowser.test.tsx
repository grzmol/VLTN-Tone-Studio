import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type Playlist, type LibrarySong } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { LibraryBrowser } from "./LibraryBrowser";

const api = vi.hoisted(() => ({ playlists: vi.fn(), index: vi.fn(), organise: vi.fn(), onTransferProgress: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));

const song = (id: string, title: string, extra: Partial<LibrarySong> = {}): LibrarySong => ({
  id,
  title,
  artist: "Band",
  sourceName: "",
  duration: 120,
  audio: [],
  settings: {},
  updated: "",
  ...extra,
});
const songs = [song("a", "Alpha", { keywords: ["encore"] }), song("b", "Bravo"), song("c", "Charlie")];
const state = (extra = {}) =>
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs }, busy: false, error: "", notice: "", queue: [], position: -1, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  api.organise.mockResolvedValue(undefined);
  api.index.mockResolvedValue({ ...emptyLibrary(), songs });
  state();
});
afterEach(cleanup);

it("lists songs A to Z, and searches as the person types", () => {
  render(<LibraryBrowser />);
  const rows = screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);
  expect(rows).toEqual(["Alpha", "Bravo", "Charlie"]);
  fireEvent.change(screen.getByLabelText("Search saved songs"), { target: { value: "encore" } });
  expect(screen.getByText("1 shown")).toBeTruthy();
  expect(screen.queryByText("Bravo")).toBeNull();
});

it("says why a filter shows nothing, rather than failing", () => {
  render(<LibraryBrowser />);
  fireEvent.click(screen.getByText("Filter the list"));
  fireEvent.click(screen.getByText("Add rule"));
  fireEvent.change(screen.getByLabelText("Rule 1 field"), { target: { value: "bpm" } });
  fireEvent.change(screen.getByLabelText("Rule 1 operator"), { target: { value: "between" } });
  fireEvent.change(screen.getByLabelText("Rule 1 from"), { target: { value: "200" } });
  fireEvent.change(screen.getByLabelText("Rule 1 to"), { target: { value: "100" } });
  expect(screen.getByText("0 shown")).toBeTruthy();
});

it("queues a song next, and reports it", () => {
  state({ queue: ["b"], position: 0, playlistPlaying: true });
  render(<LibraryBrowser />);
  const alpha = screen.getAllByRole("listitem")[0];
  fireEvent.click(within(alpha).getByText("Play next"));
  expect(useSongLibrary.getState().queue).toEqual(["b", "a"]);
  expect(screen.getByRole("status").textContent).toBe("Alpha plays next.");
});

it("selects songs for a batch edit, and sets their colour in one save", async () => {
  render(<LibraryBrowser />);
  fireEvent.click(screen.getByLabelText("Select Alpha"));
  fireEvent.click(screen.getByLabelText("Select Bravo"));
  const batch = screen.getByLabelText("Batch edit");
  expect(batch.textContent).toContain("2 selected");
  await act(async () => {
    fireEvent.click(within(batch).getByText("Set colour"));
  });
  expect(api.organise).toHaveBeenCalledTimes(1);
  expect(api.organise).toHaveBeenCalledWith({ kind: "songs", ids: ["a", "b"], patch: { color: "#3b82f6" } });
});

it("makes a playlist from the selected songs, and hands it to the Playlists panel", async () => {
  const saved: Playlist[] = [];
  api.playlists.mockImplementation(async (next: Playlist[]) => {
    saved.splice(0, saved.length, ...next);
  });
  api.index.mockImplementation(async () => ({ ...emptyLibrary(), songs, playlists: saved }));
  render(<LibraryBrowser />);
  fireEvent.click(screen.getByLabelText("Select Alpha"));
  fireEvent.click(screen.getByLabelText("Select Bravo"));
  fireEvent.click(screen.getByText("New playlist from selected…"));
  fireEvent.change(screen.getByLabelText("Name for the new playlist"), { target: { value: "Friday" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Create playlist"));
  });
  expect(saved).toEqual([expect.objectContaining({ name: "Friday", songs: ["a", "b"], sets: [], overrides: [null, null] })]);
  expect(useSongLibrary.getState()).toMatchObject({ focusPlaylistId: saved[0].id, notice: "Created Friday." });
});

it("creates a folder through the library and clears the name", async () => {
  render(<LibraryBrowser />);
  fireEvent.change(screen.getByLabelText("New folder name"), { target: { value: "Gigs" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Add folder"));
  });
  const [change] = api.organise.mock.calls[0];
  expect(change).toMatchObject({ kind: "folders", folders: [expect.objectContaining({ name: "Gigs" })] });
  expect((screen.getByLabelText("New folder name") as HTMLInputElement).value).toBe("");
});

it("asks before deleting the selected songs, and deletes them one at a time", async () => {
  const remove = vi.fn(async () => {});
  useSongLibrary.setState({ remove: remove as never });
  render(<LibraryBrowser />);
  fireEvent.click(screen.getByLabelText("Select Charlie"));
  fireEvent.click(screen.getByText("Delete selected…"));
  expect(remove).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText("Confirm delete"));
  });
  expect(remove).toHaveBeenCalledWith("c");
});
