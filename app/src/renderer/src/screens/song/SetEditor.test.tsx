import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong, type Playlist } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { PlaylistsPanel } from "./PlaylistsPanel";

const api = vi.hoisted(() => ({ playlists: vi.fn(), index: vi.fn(), organise: vi.fn(), onTransferProgress: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));

const ids = ["s1", "s2", "s3", "s4"];
const song = (id: string, duration: number): LibrarySong => ({
  id,
  title: `Song ${id}`,
  artist: "",
  sourceName: "",
  duration,
  audio: [],
  settings: {},
  updated: "",
});
const songs = [song("s1", 100), song("s2", 200), song("s3", 300), song("s4", 50)];
const playlist = (extra: Partial<Playlist> = {}): Playlist => ({ id: "11111111-1111-1111-1111-111111111111", name: "Gig", songs: ids, sets: [], ...extra });

/** The playlists the fake library holds. A save writes here, and the index read after it returns what was written. */
let stored: Playlist[] = [];

/** Shows the panel with the playlists in the library, and opens the first one. */
function renderPanel(...lists: Playlist[]) {
  stored = lists;
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: lists } });
  render(<PlaylistsPanel />);
  fireEvent.change(screen.getByLabelText("Playlist"), { target: { value: lists[0].id } });
}
const savedPlaylists = () => api.playlists.mock.calls.at(-1)?.[0] as Playlist[];

beforeEach(() => {
  vi.clearAllMocks();
  api.playlists.mockImplementation(async (next: Playlist[]) => {
    stored = next;
  });
  api.index.mockImplementation(async () => ({ ...emptyLibrary(), songs, playlists: stored }));
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs }, busy: false, error: "", notice: "", queue: [], position: -1, playlistPlaying: false });
});
afterEach(cleanup);

it("shows each set with its song count and running time, and plays only that set", async () => {
  const playPlaylist = vi.fn(async () => {});
  useSongLibrary.setState({ playPlaylist: playPlaylist as never });
  const sets = [
    { id: "22222222-2222-2222-2222-222222222222", name: "Set 1", start: 0 },
    { id: "33333333-3333-3333-3333-333333333333", name: "Encore", start: 2 },
  ];
  renderPanel(playlist({ sets }));
  expect(screen.getByLabelText("Set Encore").textContent).toContain("2 songs · 5:50");
  await act(async () => {
    fireEvent.click(screen.getAllByText("Play set")[1]);
  });
  expect(playPlaylist).toHaveBeenCalledWith(["s3", "s4"], 0, "33333333-3333-3333-3333-333333333333", [null, null]);
});

it("starts a set at an entry, and saves it with Save playlist", async () => {
  renderPanel(playlist());
  fireEvent.click(screen.getByLabelText("Start a set at entry 3"));
  expect(api.playlists).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(api.playlists).toHaveBeenCalledTimes(1);
  expect(savedPlaylists()[0].sets).toEqual([expect.objectContaining({ name: "Set 1", start: 2 })]);
});

it("removes an entry in a set, and the set heading goes with the entries", async () => {
  const sets = [{ id: "44444444-4444-4444-4444-444444444444", name: "Encore", start: 2 }];
  renderPanel(playlist({ sets }));
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(savedPlaylists()[0].songs).toEqual(["s2", "s3", "s4"]);
  expect(savedPlaylists()[0].sets).toEqual([expect.objectContaining({ name: "Encore", start: 1 })]);
});

it("queues from a point in the playlist through the queue, not by changing the playlist", async () => {
  useSongLibrary.setState({ queue: ["s1"], position: 0, playlistPlaying: true });
  renderPanel(playlist());
  await act(async () => {
    fireEvent.click(screen.getAllByText("Queue from here")[2]);
  });
  expect(useSongLibrary.getState().queue).toEqual(["s1", "s3", "s4"]);
  expect(api.playlists).not.toHaveBeenCalled();
});

it("saves each entry's end behaviour and whether it starts by itself with the playlist", async () => {
  renderPanel(playlist());
  fireEvent.change(screen.getByLabelText("Entry 2 end"), { target: { value: "loop" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(savedPlaylists()[0].overrides).toEqual([null, { endBehaviour: "loop" }, null, null]);
  // The entry keeps its loop when its autoplay is switched off as well.
  cleanup();
  const looped = playlist({ overrides: [null, { endBehaviour: "loop" }, null, null] });
  renderPanel(looped);
  fireEvent.click(screen.getByLabelText("Entry 2 starts by itself"));
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(savedPlaylists()[0].overrides).toEqual([null, { endBehaviour: "loop", autoplay: false }, null, null]);
});

it("keeps Play, Load and Queue off while the draft has unsaved edits", () => {
  renderPanel(playlist());
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  expect((screen.getByText("Play playlist") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText("Queue all") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Save the playlist first to play it.")).toBeTruthy();
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
});

it("saves the draft on Cmd+S and on Ctrl+S, and does nothing when nothing changed", async () => {
  renderPanel(playlist());
  fireEvent.keyDown(screen.getByLabelText("Playlists"), { key: "s", metaKey: true });
  expect(api.playlists).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText("Playlists"), { key: "s", ctrlKey: true });
  });
  expect(api.playlists).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Saved")).toBeTruthy();
});

it("renames the playlist in the draft, and saves the trimmed name", async () => {
  renderPanel(playlist());
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "  Friday  " } });
  expect(api.playlists).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(savedPlaylists()[0].name).toBe("Friday");
});

it("discards the draft and goes back to the saved songs", () => {
  renderPanel(playlist());
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  fireEvent.click(screen.getByText("Discard changes"));
  expect(screen.getByText("2. Song s2")).toBeTruthy();
  expect(screen.getByText("4 entries", { exact: false })).toBeTruthy();
  expect(api.playlists).not.toHaveBeenCalled();
});

it("asks before leaving a playlist with unsaved edits, and switches when told not to save", () => {
  const other: Playlist = { id: "55555555-5555-5555-5555-555555555555", name: "Practice", songs: [], sets: [] };
  renderPanel(playlist(), other);
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  fireEvent.change(screen.getByLabelText("Playlist"), { target: { value: other.id } });
  expect(screen.getByText("Save changes to Gig?")).toBeTruthy();
  fireEvent.click(screen.getByText("Don't save"));
  expect((screen.getByLabelText("Playlist name") as HTMLInputElement).value).toBe("Practice");
  expect(api.playlists).not.toHaveBeenCalled();
});

it("saves first when asked to save before leaving", async () => {
  const other: Playlist = { id: "55555555-5555-5555-5555-555555555555", name: "Practice", songs: [], sets: [] };
  renderPanel(playlist(), other);
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  fireEvent.change(screen.getByLabelText("Playlist"), { target: { value: other.id } });
  await act(async () => {
    fireEvent.click(screen.getByText("Save"));
  });
  expect(savedPlaylists()[0].songs).toEqual(["s2", "s3", "s4"]);
  expect((screen.getByLabelText("Playlist name") as HTMLInputElement).value).toBe("Practice");
});

it("keeps the draft when a save fails", async () => {
  api.playlists.mockRejectedValueOnce(new Error("Disk full"));
  renderPanel(playlist());
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(useSongLibrary.getState().error).toBe("Disk full");
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  expect(screen.getByText("3 entries", { exact: false })).toBeTruthy();
});

it("follows a saved change from elsewhere when the draft is clean", () => {
  renderPanel(playlist());
  act(() => {
    useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [playlist({ songs: ["s1"] })] } });
  });
  expect(screen.getByText("1 entries", { exact: false })).toBeTruthy();
});

it("keeps the user's edits and says so when the saved playlist changes underneath them", () => {
  renderPanel(playlist());
  fireEvent.click(screen.getByLabelText("Remove entry 1"));
  act(() => {
    useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [playlist({ songs: ["s1"] })] } });
  });
  expect(screen.getByText("3 entries", { exact: false })).toBeTruthy();
  expect(screen.getByText(/changed elsewhere/)).toBeTruthy();
});

it("adds songs to the end of a set, and saves them there", async () => {
  const sets = [
    { id: "22222222-2222-2222-2222-222222222222", name: "Set 1", start: 0 },
    { id: "33333333-3333-3333-3333-333333333333", name: "Encore", start: 2 },
  ];
  renderPanel(playlist({ sets }));
  fireEvent.click(screen.getAllByText("Add songs to this set…")[0]);
  fireEvent.click(screen.getByLabelText("Add Song s4"));
  fireEvent.click(screen.getByText("Add 1 song"));
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(savedPlaylists()[0].songs).toEqual(["s1", "s2", "s4", "s3", "s4"]);
  expect(savedPlaylists()[0].sets?.map((set) => set.start)).toEqual([0, 3]);
});

it("fills an empty playlist from Add songs, and saves the songs", async () => {
  renderPanel(playlist({ songs: [], sets: [] }));
  expect(screen.getByText("No songs yet. Add songs to fill the playlist.")).toBeTruthy();
  fireEvent.click(screen.getByText("Add songs…"));
  fireEvent.click(screen.getByLabelText("Add Song s2"));
  fireEvent.click(screen.getByText("Add 1 song"));
  await act(async () => {
    fireEvent.click(screen.getByText("Save playlist"));
  });
  expect(savedPlaylists()[0].songs).toEqual(["s2"]);
});

it("creates a playlist on Enter, says so, and opens it in the panel", async () => {
  stored = [];
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [] } });
  render(<PlaylistsPanel />);
  fireEvent.change(screen.getByLabelText("New playlist name"), { target: { value: "Friday" } });
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText("New playlist name"), { key: "Enter" });
  });
  expect(stored).toEqual([expect.objectContaining({ name: "Friday", songs: [], sets: [] })]);
  expect(useSongLibrary.getState().notice).toBe("Created Friday.");
  expect((screen.getByLabelText("Playlist name") as HTMLInputElement).value).toBe("Friday");
});

it("does not create a playlist from Enter when the name is empty", async () => {
  stored = [];
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [] } });
  render(<PlaylistsPanel />);
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText("New playlist name"), { key: "Enter" });
  });
  expect(api.playlists).not.toHaveBeenCalled();
});

it("shows a smart playlist's rules, name and delete button when it is selected", () => {
  renderPanel({ id: "66666666-6666-6666-6666-666666666666", name: "Rules", songs: [], smart: { match: "all", rules: [], sort: "title" } });
  expect((screen.getByLabelText("Playlist name") as HTMLInputElement).value).toBe("Rules");
  expect(screen.getByText("Save rules")).toBeTruthy();
  expect(screen.getByText("Delete playlist…")).toBeTruthy();
});

it("still shows Save playlist for a static playlist", () => {
  renderPanel(playlist());
  expect(screen.getByText("Save playlist")).toBeTruthy();
  expect(screen.getByText("Delete playlist…")).toBeTruthy();
});
