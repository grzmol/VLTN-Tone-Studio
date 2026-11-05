import { afterEach, describe, expect, it, vi } from "vitest";
import { stretchInWorker, StretchPool, stretchPoolSize, type PoolWorker } from "./stretch-client";
import { stretchPcm } from "./stretch";
import type { StretchRequest, StretchReply } from "./stretch-worker";

/** A stand-in worker that runs the stretch on the same thread, as the real worker entry would, and answers through onmessage. */
class FakeWorker {
  static last: FakeWorker | null = null;
  static fail = false;
  onmessage: ((event: MessageEvent<StretchReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(request: StretchRequest) {
    if (FakeWorker.fail) {
      queueMicrotask(() => this.onerror?.());
      return;
    }
    const pcm = stretchPcm(request.pcm, request.settings);
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, pcm } } as MessageEvent<StretchReply>));
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  FakeWorker.fail = false;
  vi.unstubAllGlobals();
});

describe("stretchInWorker", () => {
  it("resolves with the stretched stem and keeps its worker for the next render", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const channel = new Float32Array(44100).fill(0.25);
    const out = await stretchInWorker({ sampleRate: 44100, channels: [channel] }, { rate: 0.5, semitones: 0, cents: 0 });
    expect(out.channels[0]).toHaveLength(88200);
    expect(FakeWorker.last?.terminated).toBe(false);
  });

  it("leaves the caller's buffers intact, because the copy is what gets transferred", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const channel = new Float32Array(1000).fill(0.5);
    await stretchInWorker({ sampleRate: 44100, channels: [channel] }, { rate: 1, semitones: 0, cents: 0 });
    expect(channel.buffer.byteLength).toBe(4000);
    expect(channel[0]).toBe(0.5);
  });

  it("rejects when the worker fails", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.fail = true;
    await expect(stretchInWorker({ sampleRate: 44100, channels: [new Float32Array(10)] }, { rate: 1, semitones: 0, cents: 0 })).rejects.toThrow(
      /stretch worker failed/,
    );
    expect(FakeWorker.last?.terminated).toBe(true);
  });
});

/** A worker that answers only when the test says so, so a test can hold several renders running at once. */
class HeldWorker implements PoolWorker {
  static all: HeldWorker[] = [];
  onmessage: ((event: MessageEvent<StretchReply>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  requests: StretchRequest[] = [];
  constructor() {
    HeldWorker.all.push(this);
  }
  postMessage(request: StretchRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  answer() {
    const request = this.requests.shift()!;
    this.onmessage?.({ data: { id: request.id, pcm: request.pcm } } as MessageEvent<StretchReply>);
  }
}
const stem = () => ({ sampleRate: 44100, channels: [new Float32Array(10)] });
const settings = { rate: 0.5, semitones: 0, cents: 0 };

describe("stretchPoolSize", () => {
  it("leaves a core to the renderer, with at least one worker and at most four", () => {
    expect([1, 2, 3, 5, 8, 32].map(stretchPoolSize)).toEqual([1, 1, 2, 4, 4, 4]);
  });
});

describe("StretchPool", () => {
  afterEach(() => {
    HeldWorker.all = [];
  });

  it("runs no more renders at once than its size, and starts the next as one finishes", async () => {
    const pool = new StretchPool(2, () => new HeldWorker());
    const results = Array.from({ length: 5 }, () => pool.stretch(stem(), settings));
    expect(HeldWorker.all).toHaveLength(2);
    expect(HeldWorker.all.map((w) => w.requests.length)).toEqual([1, 1]);
    HeldWorker.all[0].answer();
    await results[0];
    // The finished worker is reused for the next render rather than a new one made
    expect(HeldWorker.all).toHaveLength(2);
    expect(HeldWorker.all[0].requests).toHaveLength(1);
    while (HeldWorker.all.some((w) => w.requests.length)) HeldWorker.all.find((w) => w.requests.length)!.answer();
    await Promise.all(results);
    expect(HeldWorker.all).toHaveLength(2);
  });

  it("drops a waiting render when it is aborted, so it never starts", async () => {
    const pool = new StretchPool(1, () => new HeldWorker());
    const controller = new AbortController();
    const first = pool.stretch(stem(), settings);
    const waiting = pool.stretch(stem(), settings, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    HeldWorker.all[0].answer();
    await first;
    expect(HeldWorker.all).toHaveLength(1);
    expect(HeldWorker.all[0].requests).toHaveLength(0);
  });

  it("ends the worker of a running render that is aborted, and gives its place to the next one", async () => {
    const pool = new StretchPool(1, () => new HeldWorker());
    const controller = new AbortController();
    const running = pool.stretch(stem(), settings, controller.signal);
    const next = pool.stretch(stem(), settings);
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(HeldWorker.all[0].terminated).toBe(true);
    expect(HeldWorker.all).toHaveLength(2);
    expect(HeldWorker.all[1].requests).toHaveLength(1);
    HeldWorker.all[1].answer();
    await next;
  });

  it("rejects at once for a signal that has already aborted", async () => {
    const pool = new StretchPool(1, () => new HeldWorker());
    const controller = new AbortController();
    controller.abort();
    await expect(pool.stretch(stem(), settings, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(HeldWorker.all).toHaveLength(0);
  });
});
