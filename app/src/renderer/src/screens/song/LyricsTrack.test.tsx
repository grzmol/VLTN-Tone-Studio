import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LyricsTrack } from "./LyricsTrack";
import { useLyricsJobs, cancelLyrics, migrateLyricsJob } from "@/song/performance/lyrics-jobs";
import { clearSettingsCache, setSetting } from "@/song/performance/settings";
import { setClockPosition } from "@/song/performance/playback-clock";

const saveSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/host", () => ({ host: { song: { saveFiles: vi.fn(), library: { updateSettings: saveSettings } } } }));
class FakeWorker {
  static current: FakeWorker;
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.current = this;
  }
}
const audio = { sampleRate: 16000, channels: [new Float32Array(16000).fill(0.2)] };
// Eight seconds of voice-level tone, so the singing detector finds a window to transcribe.
const voice = Float32Array.from({ length: 16000 * 8 }, (_, i) => 0.3 * Math.sin(i / 3));
beforeEach(() => {
  saveSettings.mockClear();
  for (const key of Object.keys(useLyricsJobs.getState().jobs)) cancelLyrics(key);
  useLyricsJobs.setState({ jobs: {} });
  FakeWorker.current = undefined!;
  localStorage.clear();
  clearSettingsCache();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      destination = {};
      createBuffer() {
        return { copyToChannel() {} };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {} };
      }
      async startRendering() {
        return { getChannelData: () => voice };
      }
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  setClockPosition(0);
  vi.unstubAllGlobals();
});

it("persists timed transcription separately from charts and follows playback", async () => {
  localStorage.setItem("song", "[00:00] [C] {midi:pc 1 0}");
  render(<LyricsTrack audio={audio} storageKey="song" />);
  fireEvent.click(screen.getByText("Generate lyrics from vocals (Better)"));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  await act(async () =>
    FakeWorker.current.onmessage?.({
      data: {
        words: [
          { text: " First", start: 0, end: 0.4 },
          { text: " Second", start: 2, end: 2.4 },
        ],
      },
    }),
  );
  expect(localStorage.getItem("song:lyrics")).toBe("[00:00.00] First\n[00:02.00] Second");
  expect(localStorage.getItem("song")).toBe("[00:00] [C] {midi:pc 1 0}");
  act(() => setClockPosition(2.1));
  expect(screen.getByText("Second").className).toContain("font-bold");
  expect(FakeWorker.current.terminate).toHaveBeenCalled();
});

it("cancels work and ignores late results without replacing saved lyrics", async () => {
  localStorage.setItem("song:lyrics", "[00:00.00] Existing");
  render(<LyricsTrack audio={audio} storageKey="song" />);
  fireEvent.click(screen.getByText("Transcribe again (Better)"));
  fireEvent.click(screen.getByText("Replace lyrics"));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Cancel transcription"));
  await act(async () => FakeWorker.current.onmessage?.({ data: { words: [{ text: " Late", start: 0, end: 0 }] } }));
  expect(FakeWorker.current.terminate).toHaveBeenCalled();
  expect(localStorage.getItem("song:lyrics")).toBe("[00:00.00] Existing");
});

it("passes an explicit language to the local worker and retains other song options", async () => {
  localStorage.setItem("song:lyrics", "[00:00.00] Existing");
  localStorage.setItem("song:options", JSON.stringify({ shift: 3 }));
  render(<LyricsTrack audio={audio} storageKey="song" />);
  fireEvent.change(screen.getByLabelText("Lyrics language"), { target: { value: "afrikaans" } });
  fireEvent.click(screen.getByText("Transcribe again (Better)"));
  fireEvent.click(screen.getByText("Replace lyrics"));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  expect(FakeWorker.current.postMessage.mock.calls[0][0].options.language).toBe("afrikaans");
  expect(JSON.parse(localStorage.getItem("song:options")!)).toEqual({ shift: 3, lyricsLanguage: "afrikaans" });
});

it("asks before replacing lyrics from before 0.9.2, and keeps them when the performer says so", async () => {
  localStorage.setItem("song:lyrics", "[00:00.00] Made earlier");
  render(<LyricsTrack audio={audio} storageKey="song" />);
  fireEvent.click(screen.getByText("Transcribe again (Better)"));
  expect(screen.getByText("Replace these lyrics? You can restore them afterwards.")).toBeTruthy();
  fireEvent.click(screen.getByText("Keep them"));
  expect(screen.queryByText("Replace these lyrics? You can restore them afterwards.")).toBeNull();
  expect(localStorage.getItem("song:lyrics")).toBe("[00:00.00] Made earlier");
});

it("starts only when asked, and keeps working when the tab is closed", async () => {
  const view = render(<LyricsTrack audio={audio} storageKey="song" />);
  // The run after a split makes lyrics; the panel waits for the performer, so opening it starts nothing.
  expect(FakeWorker.current).toBeUndefined();
  fireEvent.click(screen.getByText(/Generate lyrics from vocals/));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  view.unmount();
  expect(FakeWorker.current.terminate).not.toHaveBeenCalled();
  await act(async () => FakeWorker.current.onmessage?.({ data: { words: [{ text: " Completed in background", start: 0, end: 0 }] } }));
  render(<LyricsTrack audio={audio} storageKey="song" />);
  expect(screen.getByText("Completed in background")).toBeTruthy();
  expect(localStorage.getItem("song:lyrics")).toContain("Completed in background");
});

it("keeps edited lyrics when returning to the tab", async () => {
  const view = render(<LyricsTrack audio={audio} storageKey="song" />);
  fireEvent.click(screen.getByText(/Generate lyrics from vocals/));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  await act(async () => FakeWorker.current.onmessage?.({ data: { words: [{ text: " Draft", start: 0, end: 0 }] } }));
  fireEvent.change(screen.getByLabelText("Lyrics text track editor"), { target: { value: "[00:00.00] Corrected words" } });
  view.unmount();
  render(<LyricsTrack audio={audio} storageKey="song" />);
  expect(screen.getByText("Corrected words")).toBeTruthy();
});

it("keeps a running job when a song is saved to the library and persists the finished lyrics", async () => {
  const view = render(<LyricsTrack audio={audio} storageKey="file" />);
  fireEvent.click(screen.getByText(/Generate lyrics from vocals/));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  setSetting("vltn.song:saved", "", "[00:00] [C]");
  act(() => migrateLyricsJob("file", "vltn.song:saved"));
  view.unmount();
  await act(async () => FakeWorker.current.onmessage?.({ data: { words: [{ text: " Saved words", start: 0, end: 0 }] } }));
  expect(saveSettings).toHaveBeenCalledWith("saved", expect.objectContaining({ "": "[00:00] [C]", ":lyrics": "[00:00.00] Saved words" }));
  render(<LyricsTrack audio={audio} storageKey="vltn.song:saved" />);
  expect(screen.getByText("Saved words")).toBeTruthy();
});

it("times pasted lyrics from the heard word timings and keeps the typed words", async () => {
  localStorage.setItem("song:lyrics", "[00:00.00] Old");
  render(<LyricsTrack audio={audio} storageKey="song" />);
  expect((screen.getByRole("button", { name: "Time pasted lyrics" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Pasted lyrics"), { target: { value: "Hold on\nI'm coming" } });
  fireEvent.click(screen.getByRole("button", { name: "Time pasted lyrics" }));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  expect(FakeWorker.current.postMessage.mock.calls[0][0].pieces.length).toBeGreaterThan(0);
  await act(async () =>
    FakeWorker.current.onmessage?.({
      data: {
        words: [
          { text: " hold", start: 2, end: 2.4 },
          { text: " on", start: 2.5, end: 2.8 },
          { text: " im", start: 6, end: 6.2 },
          { text: " coming", start: 6.3, end: 6.9 },
        ],
      },
    }),
  );
  expect(localStorage.getItem("song:lyrics")).toBe("[00:02.00] Hold on\n[00:06.00] I'm coming");
});
