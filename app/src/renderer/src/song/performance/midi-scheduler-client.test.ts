import { afterEach, expect, it, vi } from "vitest";
import { midiNow, prepareMidiScheduler, startMidiScheduler } from "./midi-scheduler-client";
import type { SchedulerConfig, SchedulerReply } from "./midi-scheduler";
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: SchedulerReply }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
  reply(data: SchedulerReply) {
    this.onmessage?.({ data });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  vi.stubGlobal("Worker", FakeWorker);
  const send = vi.fn(),
    fault = vi.fn();
  const config: SchedulerConfig = { cues: [], duration: 10, position: 0, origin: midiNow(), bpm: 120, clock: false, tempo: null };
  const degraded = vi.fn();
  const handle = startMidiScheduler(config, send, fault, undefined, degraded);
  return { handle, send, fault, degraded, worker: FakeWorker.latest };
}
it("passes the complete schedule once, forwards audio checkpoints and suppresses obsolete batches after cancellation", () => {
  const f = setup();
  expect(f.worker.postMessage.mock.calls[0][0].type).toBe("start");
  f.handle.sync(1);
  expect(f.worker.postMessage.mock.calls[1][0]).toMatchObject({ type: "sync", position: 1 });
  f.handle.stop();
  f.worker.reply({ type: "batch", messages: [{ bytes: [192, 1], due: midiNow(), label: "Old song" }] });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.worker.terminate).toHaveBeenCalled();
});
it("judges each message of a delayed batch on its own: late commands are dropped and reported, current ones and note-offs go out", () => {
  const f = setup();
  f.worker.reply({
    type: "batch",
    messages: [
      { bytes: [192, 1], due: midiNow() - 1000, label: "Late" },
      { bytes: [128, 60, 0], due: midiNow() - 1000, label: "Late note-off" },
      { bytes: [144, 60, 100], due: midiNow() - 1000, label: "Late note-on" },
      { bytes: [248], due: midiNow() - 1000, label: "Late clock" },
      { bytes: [192, 2], due: midiNow(), label: "Now" },
    ],
  });
  expect(f.send.mock.calls.map((c) => c[0].bytes)).toEqual([
    [128, 60, 0],
    [192, 2],
  ]);
  expect(f.degraded).toHaveBeenCalledTimes(1);
  expect(f.degraded.mock.calls[0][0].dropped.map((m: { bytes: number[] }) => m.bytes)).toEqual([
    [192, 1],
    [144, 60, 100],
  ]);
  expect(f.fault).not.toHaveBeenCalled();
  expect(f.worker.terminate).not.toHaveBeenCalled();
});
it("reports a worker resync without faulting", () => {
  const f = setup();
  f.worker.reply({ type: "resync", position: 12 });
  expect(f.degraded).toHaveBeenCalledWith({ position: 12, dropped: [], resynced: true });
  expect(f.fault).not.toHaveBeenCalled();
});
it("stops after an output error and does not send the rest of a multi-command action", () => {
  const f = setup();
  f.send.mockImplementation(() => {
    throw new Error("Port lost");
  });
  f.worker.reply({ type: "batch", messages: [1, 2].map((n) => ({ bytes: [192, n], due: midiNow(), label: "Cue" })) });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.fault).toHaveBeenCalledWith("Port lost");
});
it("turns worker failure into a single disarming fault and ignores late worker events", () => {
  const f = setup();
  f.worker.onerror?.();
  f.worker.reply({ type: "fault", error: "Old error" });
  expect(f.fault).toHaveBeenCalledTimes(1);
  expect(f.worker.terminate).toHaveBeenCalled();
});
it("waits for worker readiness before reuse and bounds failed startup", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  const warm = prepareMidiScheduler(),
    worker = FakeWorker.latest;
  worker.reply({ type: "ready" });
  await warm.ready;
  const send = vi.fn();
  const handle = startMidiScheduler({ cues: [], duration: 1, position: 0, origin: midiNow(), bpm: 120, clock: false, tempo: null }, send, vi.fn(), warm.worker);
  expect(FakeWorker.latest).toBe(worker);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  handle.stop();
  const failed = prepareMidiScheduler();
  const rejection = expect(failed.ready).rejects.toThrow("did not become ready");
  await vi.advanceTimersByTimeAsync(2000);
  await rejection;
  expect(FakeWorker.latest.terminate).toHaveBeenCalled();
});
it("cancels an unconsumed warming worker without leaving a startup timer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  const warm = prepareMidiScheduler();
  warm.cancel();
  await expect(warm.ready).rejects.toThrow("cancelled");
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects a prepared worker that failed after readiness", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const warm = prepareMidiScheduler();
  const worker = FakeWorker.latest;
  worker.reply({ type: "ready" });
  await warm.ready;
  worker.onerror?.();
  await expect(warm.ready).rejects.toThrow("failed before playback");
  expect(() =>
    startMidiScheduler({ cues: [], duration: 1, position: 0, origin: midiNow(), bpm: 120, clock: false, tempo: null }, vi.fn(), vi.fn(), warm.worker),
  ).toThrow("failed before playback");
  expect(worker.postMessage).not.toHaveBeenCalled();
});
it("requires start acknowledgement and detects a silent worker after starting", () => {
  vi.useFakeTimers();
  const first = setup();
  vi.advanceTimersByTime(3101);
  expect(first.fault).toHaveBeenCalledWith(expect.stringContaining("acknowledge"));
  expect(vi.getTimerCount()).toBe(0);
  const second = setup();
  second.worker.reply({ type: "started" });
  for (let i = 0; i < 10; i++) {
    vi.advanceTimersByTime(1000);
    second.worker.reply({ type: "heartbeat" });
  }
  expect(second.fault).not.toHaveBeenCalled();
  vi.advanceTimersByTime(3101);
  expect(second.fault).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
