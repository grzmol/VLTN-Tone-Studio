import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SongKey } from "./SongKey";
import { performanceKey, readSettings, writeSettings } from "@/song/performance/settings";
import { ANALYSIS_VERSION, songAudioId } from "@/song/analysis/song-analysis";
const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
  done(name = "C major") {
    this.onmessage?.({
      data: { estimate: { name, tonic: 0, mode: "major", confidence: "tentative", correlation: 0.7, margin: 0.04, alternatives: ["A minor", "G major"] } },
    } as MessageEvent);
  }
}
const audio = { sampleRate: 44100, channels: [new Float32Array(100).fill(0.1)] };
beforeEach(() => {
  localStorage.clear();
  workers.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("analyses the preferred stem and shows its estimate, alternatives and display transposition", () => {
  render(<SongKey stems={{ guitar: audio }} original={audio} storageKey="song" shift={2} />);
  expect(workers[0].postMessage).toHaveBeenCalledWith({ harmony: audio, bass: null, chords: [], sections: [] });
  act(() => workers[0].done());
  expect(screen.getByText("Song key: C major")).toBeTruthy();
  expect(screen.getByText(/Estimated C major from guitar/)).toBeTruthy();
  expect(screen.getByText(/Displayed chords: D major/)).toBeTruthy();
});
it("persists manual key through reopening and saved-song settings without changing chart or MIDI", () => {
  const source = { name: "test.wav", audio },
    key = performanceKey(source);
  localStorage.setItem(key, "[00:01] {midi:pc 1 2}");
  const props = { stems: null, original: audio, storageKey: key };
  const view = render(<SongKey {...props} />);
  fireEvent.change(screen.getByLabelText("Song key override"), { target: { value: "E minor" } });
  act(() => workers[0].done());
  expect(screen.getByText("Song key: E minor")).toBeTruthy();
  const settings = readSettings(key);
  writeSettings("vltn.song:saved", settings);
  view.unmount();
  render(<SongKey {...props} storageKey="vltn.song:saved" />);
  expect((screen.getByLabelText("Song key override") as HTMLSelectElement).value).toBe("E minor");
  expect(localStorage.getItem(key)).toBe("[00:01] {midi:pc 1 2}");
});
it("rejects late results after the audio source changes and reports unavailable audio", () => {
  const view = render(<SongKey stems={{ guitar: audio }} original={audio} storageKey="song" />);
  view.rerender(<SongKey stems={{ piano: audio }} original={audio} storageKey="song" />);
  expect(workers[0].terminate).toHaveBeenCalled();
  act(() => workers[0].done("G major"));
  expect(screen.queryByText("Song key: G major")).toBeNull();
  act(() => workers[1].done());
  expect(screen.getByText(/from piano/)).toBeTruthy();
  view.rerender(<SongKey stems={null} storageKey="song" />);
  expect(screen.getByText("Song key: Unknown")).toBeTruthy();
});

it("keeps the saved estimate while the same source is reanalysed or the worker fails", () => {
  const estimate = { name: "C major", tonic: 0, mode: "major", confidence: "tentative", correlation: 0.7, margin: 0.04, alternatives: ["A minor"] };
  localStorage.setItem("song:options", JSON.stringify({ detectedKey: estimate, keyAudioSource: "guitar" }));
  render(<SongKey stems={{ guitar: audio }} original={audio} storageKey="song" />);
  expect(screen.getByText("Song key: C major")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem("song:options")!).detectedKey.name).toBe("C major");
  act(() => workers[0].onerror?.());
  expect(screen.getByText("Song key: C major")).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("lists the sections in another key from the saved analysis of this audio", () => {
  const analysis = {
    audioId: songAudioId(audio, { guitar: audio }),
    version: ANALYSIS_VERSION,
    sections: [{ name: "Last chorus", start: 8, end: 16 }],
    keySections: [{ sectionId: "0", key: { name: "A major", tonic: 9, mode: "major", correlation: 0.8, margin: 0.2, confidence: "strong", alternatives: [] } }],
  };
  localStorage.setItem("song:options", JSON.stringify({ analysis }));
  render(<SongKey stems={{ guitar: audio }} original={audio} storageKey="song" />);
  expect(screen.getByText(/Section keys: Last chorus: A major/)).toBeTruthy();
});

it("names a modal flavour after the key, and leaves the key itself to the transposition", () => {
  const estimate = { name: "G major", tonic: 7, mode: "major", confidence: "strong", correlation: 0.8, margin: 0.2, alternatives: [], flavour: "mixolydian" };
  localStorage.setItem("song:options", JSON.stringify({ detectedKey: estimate, keyAudioSource: "guitar" }));
  render(<SongKey stems={{ guitar: audio }} original={audio} storageKey="song" shift={0} />);
  expect(screen.getByText("Song key: G major (Mixolydian)")).toBeTruthy();
});

it("leaves out the alternatives when the estimate has none", () => {
  render(<SongKey stems={{ guitar: audio }} original={audio} storageKey="song" shift={0} />);
  act(() => {
    workers[0].onmessage?.({
      data: { estimate: { name: "A major", tonic: 9, mode: "major", confidence: "strong", correlation: 0.8, margin: 0.2, alternatives: [] } },
    } as MessageEvent);
  });
  expect(screen.getByRole("status").textContent).toBe("Estimated A major from guitar · clearer match");
});
