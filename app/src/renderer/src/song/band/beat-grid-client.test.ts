import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "./beat-grid";
import { startBeatGrid } from "./beat-grid-client";

/** Stands in for a Worker, so the test can answer or fail the job by hand. */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown = null;
  transfer: unknown[] | undefined = undefined;
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: unknown, transfer?: unknown[]) {
    this.posted = message;
    this.transfer = transfer;
  }
  terminate() {
    this.terminated = true;
  }
}

const grid: BeatGrid = { beatsPerBar: 4, beats: [0.5, 1], downbeat: 0, bpm: 120, steady: null };
const request = { sources: [], sampleRate: 44100, beatsPerBar: 4 };
const stem = { sampleRate: 44100, channels: [Float32Array.from([0.5, -1, 0.25]), Float32Array.from([0.5, -1, 0.25])] };

describe("startBeatGrid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves with the worker's grid and ends the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startBeatGrid(request);
    const worker = FakeWorker.last!;
    worker.onmessage!({ data: { grid } } as MessageEvent);
    await expect(job.done).resolves.toEqual(grid);
    expect(worker.terminated).toBe(true);
  });

  it("resolves the meter the worker estimated, or null when the job is cancelled", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startBeatGrid(request);
    FakeWorker.last!.onmessage!({ data: { grid, meter: { beatsPerBar: 3, confidence: 0.8 } } } as MessageEvent);
    await expect(job.meter).resolves.toEqual({ beatsPerBar: 3, confidence: 0.8 });
    const cancelled = startBeatGrid(request);
    cancelled.cancel();
    await expect(cancelled.meter).resolves.toBeNull();
    await expect(cancelled.done).rejects.toThrow("Beat tracking was cancelled.");
  });

  it("posts one mono buffer, transferred rather than copied", () => {
    vi.stubGlobal("Worker", FakeWorker);
    startBeatGrid({ ...request, sources: [stem, stem] });
    const worker = FakeWorker.last!;
    const posted = worker.posted as { mono: Float32Array; sampleRate: number; beatsPerBar: number };
    expect(posted.mono).toBeInstanceOf(Float32Array);
    expect(Array.from(posted.mono)).toEqual([0.5, -1, 0.25]);
    expect(posted.sampleRate).toBe(44100);
    expect(posted.beatsPerBar).toBe(4);
    expect(worker.transfer).toEqual([posted.mono.buffer]);
  });

  it("rejects with the worker's error", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startBeatGrid(request);
    FakeWorker.last!.onmessage!({ data: { error: "boom" } } as MessageEvent);
    await expect(job.done).rejects.toThrow("boom");
  });

  it("cancels at once: the worker is ended and the job rejects as an abort", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startBeatGrid(request);
    const worker = FakeWorker.last!;
    job.cancel();
    expect(worker.terminated).toBe(true);
    const error = await job.done.then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.name).toBe("AbortError");
  });
});
