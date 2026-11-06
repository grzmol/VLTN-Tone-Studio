import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LibrarySong } from "@shared/song-library";
import { AddSongsDialog } from "./AddSongsDialog";

afterEach(cleanup);

const song = (id: string, title: string, artist = "", duration = 60): LibrarySong => ({
  id,
  title,
  artist,
  sourceName: "",
  duration,
  audio: [],
  settings: {},
  updated: "",
});
const songs = [song("s1", "Blue Morning", "Ada"), song("s2", "Red Night", "Ben", 120), song("s3", "Blue Street", "Cy")];

it("filters by title or artist and adds the ticked songs in library order", () => {
  const onAdd = vi.fn();
  render(<AddSongsDialog open songs={songs} inPlaylist={new Set()} onOpenChange={() => {}} onAdd={onAdd} />);
  fireEvent.change(screen.getByLabelText("Search songs"), { target: { value: "blue" } });
  expect(screen.queryByText("Red Night")).toBeNull();
  fireEvent.click(screen.getByLabelText("Add Blue Street"));
  fireEvent.click(screen.getByLabelText("Add Blue Morning"));
  fireEvent.click(screen.getByText("Add 2 songs"));
  expect(onAdd).toHaveBeenCalledWith(["s1", "s3"]);
});

it("keeps the add button off until a song is ticked", () => {
  render(<AddSongsDialog open songs={songs} inPlaylist={new Set()} onOpenChange={() => {}} onAdd={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Add songs" }) as HTMLButtonElement).disabled).toBe(true);
});

it("marks a song already in the playlist, and still lets it be added", () => {
  const onAdd = vi.fn();
  render(<AddSongsDialog open songs={songs} inPlaylist={new Set(["s2"])} onOpenChange={() => {}} onAdd={onAdd} />);
  expect(screen.getByText("in playlist")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Add Red Night"));
  fireEvent.click(screen.getByText("Add 1 song"));
  expect(onAdd).toHaveBeenCalledWith(["s2"]);
});

it("shows each song's running time", () => {
  render(<AddSongsDialog open songs={songs} inPlaylist={new Set()} onOpenChange={() => {}} onAdd={vi.fn()} />);
  expect(screen.getByText("2:00")).toBeTruthy();
});
