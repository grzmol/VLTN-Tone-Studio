import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StemsPanel } from "./StemsPanel";
import { useSong } from "@/song/store";
import type { PcmAudio } from "@/song/types";

vi.mock("@/host", () => ({ host: { song: { downloadedFiles: vi.fn().mockResolvedValue([]) } } }));
vi.mock("./StemMixer", () => ({ StemMixer: () => "Stem mixer" }));
// The part picker plays its preview through an AudioContext, which jsdom does not have.
vi.mock("./PartPicker", () => ({ PartPicker: () => null }));

// Radix measures with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const pcm: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(4410)] };
const source = { name: "Song", audio: pcm };

beforeEach(() => {
  useSong.setState({ source: null, stems: null, status: { kind: "idle" } });
});
afterEach(cleanup);

it("shows the split prompt, not the mixer, when the song has imported tracks but no split stems", async () => {
  useSong.setState({ source, stems: { Keys: pcm, Bass: pcm } });
  await act(async () => {
    render(<StemsPanel onPick={vi.fn()} />);
  });
  expect(screen.getByRole("button", { name: /and split$|^Split into stems$/ })).toBeTruthy();
  expect(screen.queryByText("Stem mixer")).toBeNull();
});

it("shows the mixer when the song has a split stem", async () => {
  useSong.setState({ source, stems: { Keys: pcm, vocals: pcm } });
  await act(async () => {
    render(<StemsPanel onPick={vi.fn()} />);
  });
  expect(screen.getByText("Stem mixer")).toBeTruthy();
});
