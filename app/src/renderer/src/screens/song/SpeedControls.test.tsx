import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { PerformanceSession, SessionState } from "@/song/performance/session";
import { DEFAULT_SPEED } from "@/song/performance/speed";
import { SpeedControls } from "./SpeedControls";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A session stand-in: the real store shape the component reads, and a spy for the one call it makes. */
function fakeSession(speed = DEFAULT_SPEED) {
  const setSpeed = vi.fn();
  const store = createStore(() => ({ speed, rendering: null }) as Pick<SessionState, "speed" | "rendering">);
  return { session: { store, setSpeed } as unknown as PerformanceSession, setSpeed };
}

it("commits a speed change when the slider is let go, not on every step", () => {
  const { session, setSpeed } = fakeSession();
  render(<SpeedControls session={session} bpm={120} />);
  const slider = screen.getByLabelText("Speed");
  fireEvent.change(slider, { target: { value: "80" } });
  expect(setSpeed).not.toHaveBeenCalled();
  fireEvent.pointerUp(slider);
  expect(setSpeed).toHaveBeenCalledWith({ rate: 0.8 });
});

it("sets pitch, fine tune and the chord choice", () => {
  const { session, setSpeed } = fakeSession();
  render(<SpeedControls session={session} bpm={120} />);
  fireEvent.change(screen.getByLabelText("Pitch semitones"), { target: { value: "-3" } });
  fireEvent.blur(screen.getByLabelText("Pitch semitones"));
  expect(setSpeed).toHaveBeenLastCalledWith({ semitones: -3 });
  fireEvent.change(screen.getByLabelText("Pitch cents"), { target: { value: "25" } });
  fireEvent.keyDown(screen.getByLabelText("Pitch cents"), { key: "Enter" });
  expect(setSpeed).toHaveBeenLastCalledWith({ cents: 25 });
  fireEvent.click(screen.getByLabelText("Apply pitch to chords"));
  expect(setSpeed).toHaveBeenLastCalledWith({ applyToChords: true });
});

it("shows the tempo the song plays at, and resets the speed", () => {
  const { session, setSpeed } = fakeSession({ ...DEFAULT_SPEED, rate: 0.75 });
  render(<SpeedControls session={session} bpm={120} />);
  expect(screen.getByText("Plays at 90 BPM")).toBeTruthy();
  fireEvent.click(screen.getByText("Reset speed"));
  expect(setSpeed).toHaveBeenCalledWith({ rate: 1 });
});

it("waits 250 ms after the last keystroke before it changes the pitch, so typing does not render each step", () => {
  const { session, setSpeed } = fakeSession();
  render(<SpeedControls session={session} bpm={120} />);
  const pitch = screen.getByLabelText("Pitch semitones") as HTMLInputElement;
  fireEvent.change(pitch, { target: { value: "-" } });
  fireEvent.change(pitch, { target: { value: "-1" } });
  vi.advanceTimersByTime(200);
  fireEvent.change(pitch, { target: { value: "-2" } });
  vi.advanceTimersByTime(200);
  expect(setSpeed).not.toHaveBeenCalled();
  expect(pitch.value).toBe("-2");
  vi.advanceTimersByTime(60);
  expect(setSpeed.mock.calls).toEqual([[{ semitones: -2 }]]);
});
