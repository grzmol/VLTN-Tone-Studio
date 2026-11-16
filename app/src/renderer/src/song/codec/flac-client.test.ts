import { afterEach, expect, it, vi } from "vitest";
import { decodeTrack, disposePlaybackDecoders } from "./flac-client";
import { sharedPlaybackBuffer } from "../audio/playback-pcm";
import type { FlacResponse } from "./flac-worker";

class BufferStub {
  static created: BufferStub[] = [];
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly channels: Float32Array[];
  constructor(options: AudioBufferOptions) {
    this.numberOfChannels = options.numberOfChannels!;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
    BufferStub.created.push(this);
  }
  getChannelData = (channel: number) => this.channels[channel];
  copyToChannel = (samples: Float32Array, channel: number, offset = 0) => this.channels[channel].set(samples, offset);
}
class WorkerStub {
  static latest: WorkerStub;
  onmessage: ((e: { data: FlacResponse }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    WorkerStub.latest = this;
  }
  reply(data: FlacResponse) {
    this.onmessage?.({ data });
  }
}
function setup() {
  vi.stubGlobal("Worker", WorkerStub);
  vi.stubGlobal("AudioBuffer", BufferStub);
}
afterEach(() => {
  disposePlaybackDecoders();
  vi.unstubAllGlobals();
  BufferStub.created = [];
});

it("fills one canonical playback buffer and returns each scratch chunk only after it is copied", async () => {
  setup();
  const file = new ArrayBuffer(4);
  const pending = decodeTrack(file, { playback: { frames: 5, channels: 2, sampleRate: 44100 } });
  const worker = WorkerStub.latest;
  expect(worker.postMessage.mock.calls[0]).toEqual([{ kind: "decode-playback", bytes: new Uint8Array(file) }, [file]]);
  worker.reply({ ok: true, header: { frames: 5, channels: 2, sampleRate: 44100, bits: 24 } });
  const first = [new Float32Array([0.25, -0.5, 1]), new Float32Array([0, 0.5, -1])];
  worker.reply({ ok: true, chunk: { channels: first, offset: 0 } });
  expect(worker.postMessage.mock.calls.at(-1)).toEqual([{ kind: "continue", buffers: first.map((c) => c.buffer) }, first.map((c) => c.buffer)]);
  worker.reply({ ok: true, chunk: { channels: [new Float32Array([0.75, 0]), new Float32Array([-0.25, 0])], offset: 3 } });
  worker.reply({ ok: true, done: true });
  const audio = await pending;
  expect(BufferStub.created).toHaveLength(1);
  expect(sharedPlaybackBuffer(audio)).toBe(BufferStub.created[0]);
  expect(audio.bits).toBe(24);
  expect(Array.from(audio.channels[0])).toEqual([0.25, -0.5, 1, 0.75, 0]);
  expect(Array.from(audio.channels[1])).toEqual([0, 0.5, -1, -0.25, 0]);
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(worker.onmessage).toBeNull();
  const next = decodeTrack(new ArrayBuffer(1), { playback: { frames: 5, channels: 1, sampleRate: 44100 } });
  expect(WorkerStub.latest).toBe(worker);
  const rejected = expect(next).rejects.toThrow("next track damaged");
  worker.reply({ ok: false, error: "next track damaged" });
  await rejected;
});

it("rejects wrong metadata before allocating any playback storage", async () => {
  setup();
  const pending = decodeTrack(new ArrayBuffer(1), { playback: { frames: 5, channels: 1, sampleRate: 44100 } });
  const rejection = expect(pending).rejects.toThrow("metadata");
  WorkerStub.latest.reply({ ok: true, header: { frames: 500000000, channels: 2, sampleRate: 44100, bits: 16 } });
  await rejection;
  expect(BufferStub.created).toHaveLength(0);
  expect(WorkerStub.latest.terminate).toHaveBeenCalledOnce();
});

it.each(["gap", "overrun", "truncated", "decoder-error"])("rejects %s and ends the worker", async (kind) => {
  setup();
  const pending = decodeTrack(new ArrayBuffer(1), { playback: { frames: 5, channels: 1, sampleRate: 44100 } });
  const rejection = expect(pending).rejects.toThrow();
  const worker = WorkerStub.latest;
  worker.reply({ ok: true, header: { frames: 5, channels: 1, sampleRate: 44100, bits: 16 } });
  if (kind === "truncated") worker.reply({ ok: true, done: true });
  else if (kind === "decoder-error") worker.reply({ ok: false, error: "Damaged FLAC" });
  else worker.reply({ ok: true, chunk: { offset: kind === "gap" ? 1 : 0, channels: [new Float32Array(kind === "gap" ? 1 : 6)] } });
  await rejection;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
});

it("rejects a pending decode on page shutdown and can decode after restoration", async () => {
  setup();
  const expected = { frames: 1, channels: 1, sampleRate: 44100 };
  const pending = decodeTrack(new ArrayBuffer(1), { playback: expected });
  const failed = expect(pending).rejects.toThrow("page closed");
  const old = WorkerStub.latest;
  window.dispatchEvent(new Event("pagehide"));
  await failed;
  expect(old.terminate).toHaveBeenCalledOnce();
  const next = decodeTrack(new ArrayBuffer(1), { playback: expected });
  const worker = WorkerStub.latest;
  expect(worker).not.toBe(old);
  worker.reply({ ok: true, header: { ...expected, bits: 16 } });
  worker.reply({ ok: true, chunk: { channels: [new Float32Array([0.5])], offset: 0 } });
  worker.reply({ ok: true, done: true });
  expect((await next).channels[0][0]).toBe(0.5);
});
