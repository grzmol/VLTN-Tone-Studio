import { usePreparationDefaults, PREPARATION_DEFAULTS } from "@/song/performance/start-preparation";
import { useMidiConfiguration, readMidiConfiguration } from "@/song/performance/midi-configuration";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaylistPreflight } from "./PlaylistPreflight";
const api = vi.hoisted(() => ({ preflight: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
beforeEach(() => {
  usePreparationDefaults.setState({ settings: { ...PREPARATION_DEFAULTS } });
  useMidiConfiguration.setState(readMidiConfiguration());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows results for every entry without loading or playing songs", async () => {
  api.preflight.mockResolvedValue([{ id: "missing", errors: ["Song is missing from the library."] }]);
  render(<PlaylistPreflight ids={["missing", "missing"]} disabled={false} revision={1} songs={[]} />);
  fireEvent.click(screen.getByText("Check playlist"));
  await waitFor(() => expect(screen.getByText("2 entries checked · 2 errors · 0 performance warnings · 0 arrangement notes")).toBeTruthy());
  expect(screen.getAllByText(/Song is missing from the library/)).toHaveLength(2);
  expect(api.preflight).toHaveBeenCalledWith(["missing", "missing"]);
});
it("ignores a late result when the playlist changes and reports request failures", async () => {
  let finish!: (value: unknown) => void;
  api.preflight.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<PlaylistPreflight ids={["old"]} disabled={false} revision={1} songs={[]} />);
  fireEvent.click(screen.getByText("Check playlist"));
  await waitFor(() => expect(api.preflight).toHaveBeenCalledWith(["old"]));
  api.preflight.mockRejectedValueOnce(new Error("Disk unavailable"));
  view.rerender(<PlaylistPreflight ids={["new"]} disabled={false} revision={2} songs={[]} />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Disk unavailable"));
  await act(async () => {
    finish([{ id: "old", errors: ["Old failure"] }]);
  });
  expect(screen.queryByText(/Old failure/)).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("Disk unavailable");
});

it("shows per-entry sequences and totals, then refreshes automatically when preparation defaults change", async () => {
  usePreparationDefaults.setState({ settings: { enabled: true, settleMs: 100, openingPresets: true } });
  api.preflight.mockResolvedValue([
    {
      id: "one",
      errors: [],
      song: {
        id: "one",
        title: "Opening",
        artist: "",
        sourceName: "song",
        duration: 10,
        updated: "",
        audio: [{ name: "source", sampleRate: 44100, frames: 441000, channels: 1 }],
        settings: { ":bpm": "140", ":options": '{"tempoSource":"manual","analysis":{}}', "": "{label:Patch} {midi@prepare-once wait=0.5:pc 1 5}" },
      },
    },
  ]);
  render(<PlaylistPreflight ids={["one", "one"]} disabled={false} revision={1} songs={[]} />);
  fireEvent.click(screen.getByText("Check playlist"));
  await waitFor(() => expect(screen.getByLabelText("Playlist preparation total").textContent).toContain("1.2 s across 2 entries"));
  expect(screen.getAllByText("Before song: 0.6 s · 1 command group")).toHaveLength(2);
  const table = screen.getByRole("table", { name: "Preparation steps for entry 1", hidden: true });
  expect(table.textContent).toContain("Ch 1 · PC 5");
  expect(table.textContent).toContain("Wait after Patch");
  await act(async () => {
    usePreparationDefaults.setState({ settings: { enabled: true, settleMs: 300, openingPresets: true } });
  });
  await waitFor(() => expect(screen.getByLabelText("Playlist preparation total").textContent).toContain("1.6 s across 2 entries"));
  expect(api.preflight).toHaveBeenCalledTimes(2);
});

it("puts all errors before performance warnings and keeps arrangement advice separate from the song order", async () => {
  api.preflight.mockResolvedValue([
    {
      id: "one",
      errors: [],
      song: {
        id: "one",
        title: "Opening",
        artist: "",
        sourceName: "song",
        duration: 10,
        updated: "",
        audio: [{ name: "source", sampleRate: 44100, frames: 441000, channels: 1 }],
        settings: {
          ":bpm": "120",
          ":options": JSON.stringify({ tempoSource: "manual", analysis: {}, sections: [{ id: "v", name: "Verse", start: 0.2, end: 8.2, mode: "continue" }] }),
          "": "[00:12] {midi:pc 1 4}",
        },
      },
    },
    { id: "missing", errors: ["Song is missing from the library."] },
  ]);
  render(<PlaylistPreflight ids={["one", "missing"]} disabled={false} revision={1} songs={[]} />);
  fireEvent.click(screen.getByText("Check playlist"));
  await waitFor(() => expect(screen.getByText(/2 entries checked · 1 errors · 2 performance warnings · 1 arrangement notes/)).toBeTruthy());
  const issues = screen.getByRole("region", { name: "Playback and MIDI issues" });
  const messages = within(issues).getAllByRole("listitem");
  expect(messages[0].textContent).toContain("Error · 2. Missing song");
  expect(messages[1].textContent).toContain("Warning · 1. Opening");
  expect(issues.textContent).not.toContain("bar line");
  const advice = screen.getByLabelText("Arrangement advice");
  expect(advice instanceof HTMLDetailsElement && !advice.open).toBe(true);
  expect(advice.textContent).toContain("bar line");
});
