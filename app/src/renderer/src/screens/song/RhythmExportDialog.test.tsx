import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RhythmExportDialog } from "./RhythmExportDialog";
import { fixedBeatGrid } from "@/song/band/beat-grid";
import { assembleRhythmPart, RHYTHM_ROLES, rhythmPreview, suggestRhythmSetup, type RhythmSnapshot } from "@/song/band/rhythm-export";
import { parseSmf } from "@/song/performance/smf";

const mocks = vi.hoisted(() => ({
  save: vi.fn(async (_files: { name: string; bytes: Uint8Array }[], _title: string): Promise<string | null> => "/exports"),
  preview: vi.fn((_notes: unknown, _duration: number, _done: () => void) => ({ ready: Promise.resolve(), stop: vi.fn() })),
}));
vi.mock("@/host", () => ({ host: { song: { saveFiles: mocks.save } } }));
vi.mock("@/song/band/rhythm-preview", () => ({ playRhythmPreview: mocks.preview }));
const key = "vltn.performance.v1:rhythm-dialog";
const snapshot: RhythmSnapshot = {
  name: "Song.wav",
  duration: 12,
  grid: fixedBeatGrid(120, 0, 4, 12),
  plans: [],
  sections: [],
  notes: Array.from({ length: 24 }, (_, i) => ({ time: i * 0.5, pitch: 36, velocity: 100, duration: 0.1 })),
};
function completeSetup() {
  const setup = suggestRhythmSetup(snapshot);
  RHYTHM_ROLES.forEach((role, i) => {
    setup.parts[role] = { source: "song", firstBar: i + 1, bars: 1 };
  });
  localStorage.setItem(`${key}:options`, JSON.stringify({ bandOutOfDate: false, other: "kept", rhythmExport: setup }));
  return setup;
}
function open(disabled = false) {
  return render(<RhythmExportDialog snapshot={snapshot} songKey={key} disabled={disabled} onClose={vi.fn()} />);
}
beforeEach(() => {
  localStorage.clear();
  mocks.save.mockReset().mockResolvedValue("/exports");
  mocks.preview.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});
afterEach(cleanup);

describe("rhythm export dialog", () => {
  it("requires all six passages before exporting and surfaces deleted sources", () => {
    const choices = completeSetup();
    choices.parts.fill1.source = "deleted";
    localStorage.setItem(`${key}:options`, JSON.stringify({ rhythmExport: choices }));
    open();
    expect((screen.getByRole("button", { name: "Export rhythm files…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Choose a source passage for Fill 1.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Preview Fill 1" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("saves preferences without changing generation freshness or unrelated options, and restores them", () => {
    completeSetup();
    const view = open();
    fireEvent.change(screen.getByLabelText("Export BPM"), { target: { value: "135" } });
    fireEvent.change(screen.getByLabelText("Pattern 1 first bar"), { target: { value: "3" } });
    const options = JSON.parse(localStorage.getItem(`${key}:options`)!);
    expect(options.bandOutOfDate).toBe(false);
    expect(options.other).toBe("kept");
    expect(options.rhythmExport.bpm).toBe(135);
    view.unmount();
    open();
    expect((screen.getByLabelText("Export BPM") as HTMLInputElement).value).toBe("135");
    expect((screen.getByLabelText("Pattern 1 first bar") as HTMLInputElement).value).toBe("3");
  });
  it("exports only drums, both named files and the same assignment table displayed in the dialog", async () => {
    completeSetup();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Export rhythm files…" }));
    await waitFor(() => expect(screen.getByText("Saved the RC0 rhythm, MIDI and import guide.")).toBeTruthy());
    const [files, title] = mocks.save.mock.calls[0];
    expect(title).toBe("Export BOSS RC-10R rhythm");
    expect(files.map((file) => file.name)).toEqual(["Song - RC10R.mid", "Song - RC10R Import.txt", "Song - RC10R.RC0"]);
    expect(new TextDecoder().decode(files[1].bytes)).toContain("Ending\t6\t1");
    expect(parseSmf(files[0].bytes).every((message) => [0x99, 0x89].includes(message.bytes[0]))).toBe(true);
  });
  it("handles cancellation, save failures and invalid ranges without losing the choices", async () => {
    completeSetup();
    mocks.save.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Folder is read-only"));
    open();
    const button = screen.getByRole("button", { name: "Export rhythm files…" });
    fireEvent.click(button);
    await screen.findByText("Export cancelled. Your choices are kept.");
    fireEvent.click(button);
    await screen.findByText("Folder is read-only");
    fireEvent.change(screen.getByLabelText("Ending bars"), { target: { value: "2" } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Ending: the selected passage goes past/)).toBeTruthy();
  });
  it("keeps the successfully exported choices for automatic pedal cue setup", async () => {
    const setup = completeSetup();
    open();
    // A newer unrelated option written while the dialog is open must also survive the export.
    localStorage.setItem(`${key}:options`, JSON.stringify({ other: "newer" }));
    fireEvent.click(screen.getByRole("button", { name: "Export rhythm files…" }));
    await screen.findByText("Saved the RC0 rhythm, MIDI and import guide.");
    expect(JSON.parse(localStorage.getItem(`${key}:options`)!)).toMatchObject({
      other: "newer",
      rhythmExport: setup,
      rhythmTransfer: { version: 1, exported: { input: expect.any(String) } },
    });
  });
  it("previews the same normalized notes used in export and stops when choices change or it closes", async () => {
    const setup = completeSetup();
    const view = open();
    fireEvent.click(screen.getByRole("button", { name: "Preview Pattern 1" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    const expected = rhythmPreview(assembleRhythmPart(snapshot, setup, "pattern1"), setup);
    expect(mocks.preview.mock.calls[0].slice(0, 2)).toEqual([expected.notes, expected.duration]);
    const first = mocks.preview.mock.results[0].value;
    fireEvent.change(screen.getByLabelText("Export BPM"), { target: { value: "130" } });
    expect(first.stop).toHaveBeenCalled();
    expect(screen.queryByText("Previewing Pattern 1…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview Ending" }));
    const second = mocks.preview.mock.results[1].value;
    view.unmount();
    expect(second.stop).toHaveBeenCalled();
  });
  it("stops previews and blocks export if playback starts or its snapshot becomes stale", () => {
    completeSetup();
    const view = open();
    fireEvent.click(screen.getByRole("button", { name: "Preview Intro" }));
    const playing = mocks.preview.mock.results[0].value;
    view.rerender(<RhythmExportDialog snapshot={snapshot} songKey={key} disabled onClose={vi.fn()} />);
    expect(playing.stop).toHaveBeenCalled();
    expect(screen.queryByText("Previewing Intro…")).toBeNull();
    expect((screen.getByRole("button", { name: "Export rhythm files…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Stop playback");
  });
});

it("does not mark a file current when musical inputs change while the save dialog is open", async () => {
  completeSetup();
  let finish: (value: string) => void = () => {};
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  open();
  fireEvent.click(screen.getByRole("button", { name: "Export rhythm files…" }));
  const options = JSON.parse(localStorage.getItem(`${key}:options`)!);
  localStorage.setItem(`${key}:options`, JSON.stringify({ ...options, firstBeat: 0.3 }));
  finish("/exports");
  await screen.findByText("Saved the RC0 rhythm, MIDI and import guide.");
  expect(screen.getByText("RC-10R rhythm: Needs export.")).toBeTruthy();
});
