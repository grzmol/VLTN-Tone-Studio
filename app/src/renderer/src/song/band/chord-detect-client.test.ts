import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarmonyRequest } from "../analysis/harmony-worker";
import type { PcmAudio } from "../types";
import { startChordDetection } from "./chord-detect-client";

const audio: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(4)] };

/** A worker that answers with whatever the test puts in `reply`, or stays silent. */
class FakeWorker {
  static last: FakeWorker | null = null;
  static reply: { chords?: unknown[]; error?: string } | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: HarmonyRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: HarmonyRequest) {
    this.posted.push(message);
    if (message.kind === "chords" && FakeWorker.reply) {
      const reply = FakeWorker.reply;
      queueMicrotask(() =>
        this.onmessage?.({ data: "error" in reply ? { id: message.id, error: reply.error } : { id: message.id, result: reply.chords } } as MessageEvent),
      );
    }
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.reply = null;
});

describe("chord detection client", () => {
  it("posts the audio to the chord worker and resolves with the chords", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.reply = { chords: [{ time: 0, name: "Am", confidence: 0.9 }] };
    const job = startChordDetection({ harmony: audio, bass: null, beats: null });
    await expect(job.done).resolves.toEqual([{ time: 0, name: "Am", confidence: 0.9 }]);
    expect(FakeWorker.last?.posted).toEqual([
      { kind: "audio", audio },
      { kind: "chords", id: expect.any(Number), input: { bass: null, beats: null } },
    ]);
    expect(FakeWorker.last?.terminated).toBe(true);
  });

  it("rejects with the worker's error", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.reply = { error: "bad audio" };
    await expect(startChordDetection({ harmony: audio, bass: null, beats: null }).done).rejects.toThrow("bad audio");
  });

  it("cancelling ends the worker and rejects with an AbortError", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startChordDetection({ harmony: audio, bass: null, beats: null });
    job.cancel();
    await expect(job.done).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.last?.terminated).toBe(true);
  });
});
