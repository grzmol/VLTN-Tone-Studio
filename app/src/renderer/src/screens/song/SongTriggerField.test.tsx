import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibrarySong } from "@shared/song-library";
import { defaultBindings, stopLearn, useRemoteLearn } from "@/song/performance/bindings";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { SongTriggerField } from "./SongTriggerField";

const library = vi.hoisted(() => ({ setSongTrigger: vi.fn() }));
vi.mock("@/song/library", () => ({ useSongLibrary: { getState: () => library } }));

const song = (id: string, title: string, trigger?: object): LibrarySong =>
  ({ id, title, settings: { ":options": JSON.stringify(trigger ? { midiTrigger: trigger } : {}) } }) as unknown as LibrarySong;
const pc = { type: "pc", channel: 2, program: 9 };

beforeEach(() => {
  localStorage.clear();
  stopLearn();
  library.setSongTrigger.mockClear();
  useMidiConfiguration.getState().update({ bindings: defaultBindings() });
});
afterEach(() => cleanup());

it("asks for the song to be saved first when it is not in the library", () => {
  render(<SongTriggerField songId={undefined} songs={[]} inputReady />);
  expect(screen.getByText("Save the song to the library to load it from MIDI.")).toBeTruthy();
});

it("saves a typed program change with its bank, and names a song that shares the trigger", () => {
  render(<SongTriggerField songId="b" songs={[song("a", "Song A", pc), song("b", "Song B")]} inputReady />);
  fireEvent.change(screen.getByLabelText("Trigger channel"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Trigger number"), { target: { value: "9" } });
  fireEvent.change(screen.getByLabelText("Bank MSB"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Bank LSB"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save trigger" }));
  expect(library.setSongTrigger).toHaveBeenCalledWith("b", { type: "pc", channel: 2, program: 9, bankMsb: 1, bankLsb: 3 });
  expect(screen.getByText("Saved Ch 2 · Program 9 · bank 1/3.")).toBeTruthy();
});

it("refuses a channel out of range, and saves nothing", () => {
  render(<SongTriggerField songId="b" songs={[song("b", "Song B")]} inputReady />);
  fireEvent.change(screen.getByLabelText("Trigger channel"), { target: { value: "17" } });
  fireEvent.click(screen.getByRole("button", { name: "Save trigger" }));
  expect(library.setSongTrigger).not.toHaveBeenCalled();
  expect(screen.getByText(/Use channel 1 to 16/)).toBeTruthy();
});

it("names another song with the same trigger", () => {
  render(<SongTriggerField songId="b" songs={[song("a", "Song A", pc), song("b", "Song B", pc)]} inputReady />);
  expect(screen.getByText(/Same trigger as Song A/)).toBeTruthy();
  expect(screen.getByText("Loads on Ch 2 · Program 9.")).toBeTruthy();
});

it("names a remote binding that already answers the trigger", () => {
  useMidiConfiguration.getState().update({ bindings: [{ action: "section.next", source: "midi", match: { status: 0xc0, channel: 2, data1: 9 } }] });
  render(<SongTriggerField songId="b" songs={[song("b", "Song B", pc)]} inputReady />);
  expect(screen.getByText(/runs a remote action on this message, so this song does not load/)).toBeTruthy();
});

it("starts a Learn for this song when the performer presses Learn trigger", () => {
  render(<SongTriggerField songId="b" songs={[song("b", "Song B")]} inputReady />);
  fireEvent.click(screen.getByRole("button", { name: "Learn trigger" }));
  expect(useRemoteLearn.getState().target).toEqual({ source: "song", songId: "b" });
  expect(screen.getByRole("status").textContent).toContain("Learning a song's trigger");
});

it("removes the trigger", () => {
  render(<SongTriggerField songId="b" songs={[song("b", "Song B", pc)]} inputReady />);
  fireEvent.click(screen.getByRole("button", { name: "Remove trigger" }));
  expect(library.setSongTrigger).toHaveBeenCalledWith("b", null);
});
