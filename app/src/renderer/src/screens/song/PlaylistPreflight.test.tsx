import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlaylistPreflight } from "./PlaylistPreflight";
const api = vi.hoisted(() => ({ preflight: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
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
  view.rerender(<PlaylistPreflight ids={["new"]} disabled={false} revision={2} songs={[]} />);
  await act(async () => {
    finish([{ id: "old", errors: ["Old failure"] }]);
  });
  expect(screen.queryByText(/Old failure/)).toBeNull();
  api.preflight.mockRejectedValueOnce(new Error("Disk unavailable"));
  fireEvent.click(screen.getByText("Check playlist"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Disk unavailable"));
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
