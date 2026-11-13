import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore } from "zustand/vanilla";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSongLibrary } from "@/song/library";
import { NO_LIVE, type Section } from "@/song/performance/sections";
import { setClockPosition } from "@/song/performance/playback-clock";
import type { PerformanceSession, SessionState } from "@/song/performance/session";
import { TransportBar } from "./TransportBar";

afterEach(cleanup);
beforeEach(() => {
  setClockPosition(0);
  useSongLibrary.setState({ queue: [], position: 0, busy: false });
});

const sections: Section[] = [
  { id: "a", name: "Intro", start: 0, end: 30, mode: "continue" },
  { id: "b", name: "Verse", start: 30, end: 330, mode: "continue" },
];

function fakeSession(patch: Partial<SessionState> = {}) {
  const store = createStore<Partial<SessionState>>(() => ({
    player: { duration: 330 } as SessionState["player"],
    playing: false,
    starting: false,
    parseError: "",
    queued: false,
    sections,
    sectionLive: NO_LIVE,
    midiStatus: "",
    portId: "",
    bluetooth: null,
    access: null,
    armedOutput: null,
    ...patch,
  }));
  const session = { store, startPlayback: vi.fn(), pause: vi.fn(), cancelStart: vi.fn(), seek: vi.fn(), skip: vi.fn() };
  return session as unknown as PerformanceSession & typeof session;
}

it("shows the time, the section and the tempo in one row", () => {
  setClockPosition(35);
  render(<TransportBar session={fakeSession()} bpm={149.9} beats={4} firstBeat={0} />);
  expect(screen.getByLabelText("Song time").textContent).toBe("0:35 / 5:30");
  expect(screen.getByText("Verse")).toBeTruthy();
  expect(screen.getByText("149.9 BPM")).toBeTruthy();
});

it("plays, pauses and rewinds through the session", () => {
  const session = fakeSession();
  const { rerender } = render(<TransportBar session={session} bpm={150} beats={4} firstBeat={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(session.startPlayback).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
  expect(session.seek).toHaveBeenCalledWith(0);
  session.store.setState({ playing: true });
  rerender(<TransportBar session={session} bpm={150} beats={4} firstBeat={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(session.pause).toHaveBeenCalled();
});

it("shows the playlist controls only while a playlist of more than one song is queued", () => {
  const session = fakeSession({ queued: true });
  const { rerender } = render(<TransportBar session={session} bpm={150} beats={4} firstBeat={0} />);
  expect(screen.queryByRole("button", { name: "Next song" })).toBeNull();
  useSongLibrary.setState({ queue: ["x", "y"], position: 0 });
  rerender(<TransportBar session={session} bpm={150} beats={4} firstBeat={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Next song" }));
  expect(session.skip).toHaveBeenCalledWith(1);
  expect(screen.getByText(/1 \/ 2/)).toBeTruthy();
});

it("says that MIDI is not armed", () => {
  render(<TransportBar session={fakeSession()} bpm={150} beats={4} firstBeat={0} />);
  expect(screen.getByRole("img", { name: "MIDI not armed" })).toBeTruthy();
});
