import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricsCancelled, transcribeLyrics } from "./lyrics-run";

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

const options = { model: "small" as const, quality: "fast" as const, language: "auto" as const };
/** Eight seconds of voice-level tone, so the singing detector finds one region to transcribe. */
const voice = Float32Array.from({ length: 16000 * 8 }, (_, i) => 0.3 * Math.sin(i / 3));
const silence = new Float32Array(16000 * 8);
const audio = (samples: Float32Array) => ({ sampleRate: 16000, channels: [samples] });

beforeEach(() => {
  FakeWorker.current = undefined!;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      destination = {};
      samples: Float32Array = voice;
      createBuffer() {
        return { copyToChannel: () => {} };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {} };
      }
      async startRendering() {
        return { getChannelData: () => this.samples };
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("transcribeLyrics", () => {
  it("starts no transcriber when the vocals have no singing", async () => {
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        destination = {};
        createBuffer() {
          return { copyToChannel: () => {} };
        }
        createBufferSource() {
          return { buffer: null, connect() {}, start() {} };
        }
        async startRendering() {
          return { getChannelData: () => silence };
        }
      },
    );
    expect(await transcribeLyrics({ audio: audio(silence), options })).toEqual({ text: "", placed: 0 });
    expect(FakeWorker.current).toBeUndefined();
  });

  it("builds lines from the heard words, in song time", async () => {
    const result = transcribeLyrics({ audio: audio(voice), options });
    await vi.waitFor(() => expect(FakeWorker.current).toBeDefined());
    FakeWorker.current.onmessage?.({
      data: {
        words: [
          { text: "hold", start: 1, end: 1.4 },
          { text: "still", start: 1.5, end: 1.8 },
          { text: "im", start: 4, end: 4.2 },
        ],
      },
    });
    expect(await result).toEqual({ text: "[00:01.00] hold still\n[00:04.00] im", placed: 0 });
    expect(FakeWorker.current.terminate).toHaveBeenCalled();
  });

  it("times pasted lines against the heard words", async () => {
    const result = transcribeLyrics({ audio: audio(voice), options, pasted: ["Hold on", "I'm coming"] });
    await vi.waitFor(() => expect(FakeWorker.current).toBeDefined());
    FakeWorker.current.onmessage?.({
      data: {
        words: [
          { text: "hold", start: 1, end: 1.4 },
          { text: "on", start: 1.5, end: 1.8 },
          { text: "coming", start: 4, end: 4.5 },
        ],
      },
    });
    // "I'm" was not heard, so "coming" is stepped back over it by the average heard word (0.4 s).
    expect((await result).text).toBe("[00:01.00] Hold on\n[00:03.60] I'm coming");
  });

  it("stops at once when the signal aborts: the worker is ended and nothing is returned", async () => {
    const controller = new AbortController();
    const result = transcribeLyrics({ audio: audio(voice), options, signal: controller.signal });
    await vi.waitFor(() => expect(FakeWorker.current).toBeDefined());
    controller.abort("cancel");
    await expect(result).rejects.toBeInstanceOf(LyricsCancelled);
    expect(FakeWorker.current.terminate).toHaveBeenCalled();
  });
});

describe("graphics acceleration memory in a run", () => {
  const KEY = "gp5.lyrics.graphics-empty.v1";
  const cpuAfterEmpty = { runtime: "wasm", parts: 1, rawWords: 1, keptWords: 1, cpuRetry: true };

  /** Runs one transcription and answers the worker with the given words and diagnostic. Returns the result and the flag the worker got. */
  async function runWith(diagnostic: unknown, words: { text: string; start: number; end: number }[] = [{ text: "hold", start: 1, end: 1.4 }]) {
    const result = transcribeLyrics({ audio: audio(voice), options });
    await vi.waitFor(() => expect(FakeWorker.current).toBeDefined());
    const worker = FakeWorker.current;
    FakeWorker.current = undefined!;
    queueMicrotask(() => worker.onmessage?.({ data: { words, diagnostic } }));
    const sent = worker.postMessage.mock.calls[0]?.[0] as { graphicsHeardNothing: boolean };
    return { result: await result, graphicsHeardNothing: sent.graphicsHeardNothing };
  }

  beforeEach(() => localStorage.removeItem(KEY));

  it("remembers it when the CPU heard words after graphics acceleration heard nothing, and goes straight to the CPU next time", async () => {
    const first = await runWith(cpuAfterEmpty);
    expect(first.graphicsHeardNothing).toBe(false);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    const second = await runWith({ ...cpuAfterEmpty, cpuRetry: false });
    expect(second.graphicsHeardNothing).toBe(true);
  });

  it("does not remember it when both passes heard nothing, since the song may have no singing", async () => {
    await runWith({ runtime: "wasm", parts: 1, rawWords: 0, keptWords: 0, cpuRetry: true }, []);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps transcribing when storage throws", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const first = await runWith(cpuAfterEmpty);
    expect(first.result.text).toBe("[00:01.00] hold");
    set.mockRestore();
  });
});
