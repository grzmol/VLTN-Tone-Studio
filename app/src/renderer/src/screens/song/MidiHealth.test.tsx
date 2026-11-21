import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBluetooth } from "@/bluetooth/connection";
import { MidiHealth } from "./MidiHealth";
import { parseChart } from "@/song/performance/chart";
import { useDevice } from "@/state/device";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useMidiDiagnostics.getState().reset();
  localStorage.clear();
  useDevice.setState({ device: null, status: "idle", names: [] });
});
it("refreshes the counters at most every 500 ms however often they change", () => {
  vi.useFakeTimers();
  render(<MidiHealth cues={[]} duration={10} clock={false} parseError="" />);
  act(() => {
    for (let i = 0; i < 50; i++) useMidiDiagnostics.getState().record({ label: "Cue", bytes: [192, 1], intended: 100, queued: 101, lateMs: 1 });
    vi.advanceTimersByTime(499);
  });
  expect(screen.getByLabelText("MIDI timing totals").textContent).toContain("Queued: 0");
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByLabelText("MIDI timing totals").textContent).toContain("Queued: 50");
});
it("shows advisory preflight and bounded timing data without changing cue sending", () => {
  vi.useFakeTimers();
  useMidiDiagnostics.getState().reset();
  render(<MidiHealth cues={parseChart("[00:11] {midi:pc 1 2}")} duration={10} clock={false} parseError="" />);
  expect(screen.getByText(/beyond the 10.00 s audio/)).toBeTruthy();
  expect(screen.getByText(/No MIDI output selected/)).toBeTruthy();
  act(() => {
    useMidiDiagnostics.getState().record({ label: "Opening patch", bytes: [192, 2], intended: 100, queued: 112, lateMs: 12 });
    vi.advanceTimersByTime(500);
  });
  expect(screen.getByLabelText("MIDI timing totals").textContent).toContain("Worst dispatch lateness: 12.0 ms");
  expect(screen.getByText("Opening patch")).toBeTruthy();
  useBluetooth.setState({
    diagnostics: {
      device: "GP-180",
      writes: 3,
      notifications: 0,
      messages: 0,
      dropped: 0,
      reconnects: 0,
      performanceTiming: { commands: 3, maxLateMs: 20, maxWriteMs: 30 },
    },
  });
  fireEvent.click(screen.getByText("Reset timing counters"));
  expect(useBluetooth.getState().diagnostics?.performanceTiming).toBeUndefined();
  expect(useMidiDiagnostics.getState().queued).toBe(0);
});

it("counts arrangement advice separately and leaves it collapsed below real MIDI warnings", () => {
  render(
    <MidiHealth
      cues={parseChart("[00:12] {midi:pc 1 2}")}
      duration={10}
      clock={false}
      parseError=""
      outputName="Test"
      bpm={120}
      beats={4}
      sections={[{ id: "v", name: "Verse", start: 0.2, end: 8.2, mode: "continue" }]}
    />,
  );
  expect(screen.getByText(/1 warnings · 1 arrangement notes/)).toBeTruthy();
  const advice = screen.getByLabelText("Arrangement advice");
  expect(advice instanceof HTMLDetailsElement && !advice.open).toBe(true);
  expect(advice.textContent).toContain("If you loop or jump there");
  expect(screen.getByText(/beyond the 10.00 s audio/)).toBeTruthy();
});

it("warns when a cue recalls a GP-180 preset that now holds a different sound", () => {
  const cues = parseChart("[00:02] {label:GP-180: 002 Crunch Lead} {midi:cc 1 0 0} {midi:pc 1 1}");
  useDevice.setState({
    device: "gp180",
    status: "connected",
    names: [
      { slot: 0, name: "Clean" },
      { slot: 1, name: "Clean Verb" },
    ],
  });
  render(<MidiHealth cues={cues} duration={10} clock={false} parseError="" />);
  expect(screen.getByText(/recalls GP-180 preset 002, saved as "Crunch Lead". That slot now holds "Clean Verb"/)).toBeTruthy();
});
