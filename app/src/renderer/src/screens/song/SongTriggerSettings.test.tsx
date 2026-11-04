import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { LibrarySong } from "@shared/song-library";
import { defaultBindings } from "@/song/performance/bindings";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { SongTriggerSettings } from "./SongTriggerSettings";

const song = (id: string, title: string, trigger?: object): LibrarySong =>
  ({ id, title, settings: { ":options": JSON.stringify(trigger ? { midiTrigger: trigger } : {}) } }) as unknown as LibrarySong;
const pc = { type: "pc", channel: 2, program: 9 };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("vltn.card.song-triggers", "open");
  useMidiConfiguration.getState().update({ bindings: defaultBindings() });
});
afterEach(() => cleanup());

it("is off by default, and switching listening on saves it with the MIDI setup", () => {
  render(<SongTriggerSettings songs={[]} inputReady />);
  const listen = screen.getByRole("checkbox", { name: "Load songs from MIDI" });
  expect(listen.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(listen);
  expect(useMidiConfiguration.getState().songTriggers.listen).toBe(true);
});

it("names a song that shares another song's trigger, once, on the later song", () => {
  render(<SongTriggerSettings songs={[song("a", "Song A", pc), song("b", "Song B", pc)]} inputReady />);
  const conflicts = screen.getByRole("list", { name: "Trigger conflicts" });
  expect(conflicts.textContent).toBe("Song B: same trigger as Song A. The first song in the library loads.");
});

it("names a song whose trigger a remote binding answers", () => {
  useMidiConfiguration.getState().update({ bindings: [{ action: "section.next", source: "midi", match: { status: 0xc0, channel: 2, data1: 9 } }] });
  render(<SongTriggerSettings songs={[song("b", "Song B", pc)]} inputReady />);
  expect(screen.getByRole("list", { name: "Trigger conflicts" }).textContent).toContain("Song B:");
});

it("sets the while-playing option, with its hint, and keeps the default for anything unset", () => {
  render(<SongTriggerSettings songs={[]} inputReady={false} />);
  expect(screen.getByText("Choose a MIDI input in MIDI setup. Triggers do nothing without one.")).toBeTruthy();
  const select = screen.getByRole("combobox", { name: "While a song plays" }) as HTMLSelectElement;
  expect(select.value).toBe("ignore");
  fireEvent.change(select, { target: { value: "now" } });
  expect(useMidiConfiguration.getState().songTriggers.whilePlaying).toBe("now");
  expect(screen.getByText("Stops the song and loads the triggered one. Use it only when the set should jump.")).toBeTruthy();
});
