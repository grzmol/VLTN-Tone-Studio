import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackImport } from "./TrackImport";

const addTracks = vi.hoisted(() => vi.fn());
vi.mock("@/song/library", () => ({ useSongLibrary: { getState: () => ({ applyTrackSettings: vi.fn() }) } }));
vi.mock("@/song/store", () => ({
  useSong: Object.assign((select: (s: unknown) => unknown) => select({ status: { kind: "idle" } }), { getState: () => ({ addTracks }) }),
}));

beforeEach(() => {
  addTracks.mockReset();
});
afterEach(cleanup);

describe("track import", () => {
  it("adds the files picked and lists what was refused", async () => {
    addTracks.mockResolvedValueOnce(["Pads is 3.0 s away from the song's length, so it was not imported."]);
    const { container } = render(<TrackImport />);
    const input = container.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    const drums = new File([new Uint8Array(4)], "Drums.wav");
    fireEvent.change(input, { target: { files: [drums] } });
    await waitFor(() => expect(addTracks).toHaveBeenCalledWith([drums], { playing: false }));
    expect((await screen.findByRole("status")).textContent).toContain("Pads is 3.0 s away");
  });

  it("from a folder, passes on only the audio files and skips the rest without a notice", async () => {
    addTracks.mockResolvedValueOnce([]);
    const { container } = render(<TrackImport />);
    const folder = container.querySelector("input[webkitdirectory]") as HTMLInputElement;
    const audio = new File([new Uint8Array(4)], "Bass.flac");
    const text = new File(["notes"], ".DS_Store");
    fireEvent.change(folder, { target: { files: [audio, text] } });
    await waitFor(() => expect(addTracks).toHaveBeenCalledWith([audio], { playing: false }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the reason when nothing can be imported", async () => {
    addTracks.mockRejectedValueOnce(new Error("A song can hold up to 32 imported tracks."));
    const { container } = render(<TrackImport />);
    const input = container.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], "Pads.wav")] } });
    expect((await screen.findByRole("status")).textContent).toContain("up to 32 imported tracks");
  });

  it("disables the import while playing, says why, and passes the playing state to the store", async () => {
    addTracks.mockResolvedValueOnce(["Stop playback to add tracks."]);
    const { container } = render(<TrackImport playing />);
    expect((screen.getByRole("button", { name: "Add tracks…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add folder…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toContain("Stop playback to add tracks.");
    const input = container.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], "Pads.wav")] } });
    await waitFor(() => expect(addTracks).toHaveBeenCalledWith(expect.any(Array), { playing: true }));
    expect((await screen.findByRole("status")).textContent).toContain("Stop playback");
  });
});
