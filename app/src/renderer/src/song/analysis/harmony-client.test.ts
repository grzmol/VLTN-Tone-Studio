import { afterEach, expect, it, vi } from "vitest";
import { startChordReading, startKeyReading } from "./harmony-client";
import type { HarmonyReply, HarmonyRequest } from "./harmony-worker";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: HarmonyReply }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn<(message: HarmonyRequest) => void>();
  terminate = vi.fn();
  constructor() {
    FakeWorker.all.push(this);
  }
  reply(data: HarmonyReply) {
    this.onmessage?.({ data });
  }
  id(kind: "key" | "chords") {
    return this.postMessage.mock.calls.map(([message]) => message).find((message) => message.kind === kind) as Exclude<HarmonyRequest, { kind: "audio" }>;
  }
}
const pcm = () => ({ sampleRate: 44100, channels: [new Float32Array([0.25, -0.5]), new Float32Array([0.5, -0.25])] });
const key = (audio: ReturnType<typeof pcm>) => startKeyReading({ harmony: audio, bass: null, chords: [], sections: [] });
const chords = (audio: ReturnType<typeof pcm>) => startChordReading({ harmony: audio, bass: null, beats: null });
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.all = [];
});

it("copies a shared harmony once and keeps its reader until both estimates finish", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const audio = pcm();
  const first = key(audio),
    second = chords(audio);
  expect(FakeWorker.all).toHaveLength(1);
  const worker = FakeWorker.all[0];
  expect(worker.postMessage.mock.calls.filter(([message]) => message.kind === "audio")).toEqual([[{ kind: "audio", audio }]]);
  worker.reply({ id: worker.id("key").id, result: { estimate: null, keySections: [] } });
  await expect(first.done).resolves.toEqual({ estimate: null, keySections: [] });
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ id: worker.id("chords").id, result: [{ time: 0, name: "Am", confidence: 0.9 }] });
  await expect(second.done).resolves.toEqual([{ time: 0, name: "Am", confidence: 0.9 }]);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
  expect(Array.from(audio.channels[0])).toEqual([0.25, -0.5]);
});

it("cancels one estimate without stopping the other, then starts a fresh reader after retirement", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const audio = pcm();
  const first = key(audio),
    second = chords(audio);
  const failed = expect(first.done).rejects.toMatchObject({ name: "AbortError" });
  first.cancel();
  await failed;
  const worker = FakeWorker.all[0];
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ id: worker.id("chords").id, result: [] });
  await second.done;
  const next = key(audio);
  expect(FakeWorker.all).toHaveLength(2);
  const cancelled = expect(next.done).rejects.toMatchObject({ name: "AbortError" });
  next.cancel();
  await cancelled;
  expect(FakeWorker.all[1].terminate).toHaveBeenCalledOnce();
});

it("rejects all estimates on a worker failure and never shares different PCM identities", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const audio = pcm();
  const first = key(audio),
    second = chords(audio),
    other = key(pcm());
  expect(FakeWorker.all).toHaveLength(2);
  const failures = [expect(first.done).rejects.toThrow("failed"), expect(second.done).rejects.toThrow("failed")];
  FakeWorker.all[0].onerror?.({ message: "failed" });
  await Promise.all(failures);
  const cancelled = expect(other.done).rejects.toMatchObject({ name: "AbortError" });
  other.cancel();
  await cancelled;
});

it("keeps another estimate alive after a per-request analysis error", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const audio = pcm();
  const first = key(audio),
    second = chords(audio);
  const worker = FakeWorker.all[0];
  const failed = expect(first.done).rejects.toThrow("bad key");
  worker.reply({ id: worker.id("key").id, error: "bad key" });
  await failed;
  worker.reply({ id: worker.id("chords").id, result: [] });
  await expect(second.done).resolves.toEqual([]);
});
