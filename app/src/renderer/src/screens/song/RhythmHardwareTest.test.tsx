import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PerformanceSession } from "@/song/performance/session";
import { RhythmHardwareTest } from "./RhythmHardwareTest";
vi.mock("@/song/performance/session", () => ({
  useSession: (session: { state: unknown }, select: (state: unknown) => unknown) => select(session.state),
  selectArmed: (state: { armed: boolean }) => state.armed,
  selectOutput: (state: { output: unknown }) => state.output,
}));
vi.mock("@/song/performance/pedal-library", () => ({ usePedalLibrary: () => ({ channels: { "boss-rc10r": 2 }, assignments: {} }) }));
afterEach(cleanup);
function fixture() {
  const output = { name: "Test output", state: "connected" };
  const state = { armed: true, output, playing: false, starting: false, cues: [], bpm: 140, rhythmTempo: null, tempoChannel: 16, player: { playbackRate: 1 } };
  let beforePlay: (() => void) | null = null;
  const sendPerformance = vi.fn();
  const session = {
    state,
    get output() {
      return state.output;
    },
    sendPerformance,
    registerRhythmTestCleanup: (fn: () => void) => {
      beforePlay = fn;
      return () => {
        beforePlay = null;
      };
    },
  };
  const view = render(<RhythmHardwareTest session={session as unknown as PerformanceSession} />);
  return { state, sendPerformance, view, beforePlay: () => beforePlay?.() };
}
it("sends slow and fast tempo, then restores the song target and stops before playback", () => {
  const f = fixture();
  fireEvent.click(screen.getByText("Slow: 100 BPM"));
  fireEvent.click(screen.getByText("Fast: 180 BPM"));
  expect(f.sendPerformance.mock.calls.map((c) => c[0])).toEqual([
    [0xbf, 73, 0],
    [0xbf, 74, 100],
    [0xbf, 73, 1],
    [0xbf, 74, 52],
  ]);
  f.beforePlay();
  expect(f.sendPerformance.mock.calls.slice(-4).map((c) => c[0])).toEqual([
    [0xb1, 83, 127],
    [0xb1, 83, 0],
    [0xbf, 73, 1],
    [0xbf, 74, 12],
  ]);
});
it("holds the start pulse and stops it on unmount even when no tempo test was used", () => {
  const f = fixture();
  fireEvent.click(screen.getByText("Start drums"));
  expect(f.sendPerformance.mock.calls[0][0]).toEqual([0xb1, 80, 127]);
  expect(f.sendPerformance.mock.calls[1][1]).toBeGreaterThan(performance.now() + 50);
  f.view.unmount();
  expect(f.sendPerformance.mock.calls.some((c) => c[0][1] === 83 && c[0][2] === 127)).toBe(true);
});
it("does not restore a hardware test into a replacement output", () => {
  const f = fixture();
  fireEvent.click(screen.getByText("Slow: 100 BPM"));
  f.state.output = { name: "Different output", state: "connected" };
  f.sendPerformance.mockClear();
  f.view.unmount();
  expect(f.sendPerformance).not.toHaveBeenCalled();
});
