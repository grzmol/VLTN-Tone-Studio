import { afterEach, expect, it, vi } from "vitest";
import { clockPair, mapTime, SeparateClickOutput } from "./click-output";

class FakeContext {
  static instances: FakeContext[] = [];
  static rejectSinks = new Set<string>();
  currentTime = 2;
  /** What getOutputTimestamp reports; tests change it to move the device's clock */
  timestamp = { contextTime: 1, performanceTime: 1000 };
  destination = {};
  sinkIds: string[] = [];
  closed = false;
  constructor() {
    FakeContext.instances.push(this);
  }
  getOutputTimestamp() {
    return this.timestamp;
  }
  async setSinkId(sinkId: string) {
    this.sinkIds.push(sinkId);
    if (FakeContext.rejectSinks.has(sinkId)) throw new Error("NotFoundError");
  }
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), channelCount: 0, channelCountMode: "", channelInterpretation: "" };
  }
  async resume() {}
  async close() {
    this.closed = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeContext.instances = [];
  FakeContext.rejectSinks = new Set();
});

it("maps a time from one clock to another through the shared performance clock", () => {
  const from = { contextTime: 1, performanceTime: 1000 };
  const to = { contextTime: 5, performanceTime: 3000 };
  // 1 s of the first clock is 1 s of the performance clock, which is 1 s before the second clock's 5 s mark.
  expect(mapTime(from, to, 2)).toBeCloseTo(4);
  expect(mapTime(from, from, 2)).toBeCloseTo(2);
});

it("falls back to the current times while the device has not started", () => {
  const ctx = new FakeContext() as unknown as AudioContext;
  ctx.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
  expect(clockPair(ctx, () => 500)).toEqual({ contextTime: 2, performanceTime: 500 });
});

it("rejects when the click device cannot be selected, and closes its context", async () => {
  vi.stubGlobal("AudioContext", FakeContext);
  FakeContext.rejectSinks.add("headphones");
  const main = new FakeContext() as unknown as AudioContext;
  await expect(SeparateClickOutput.open(main, "headphones")).rejects.toThrow("NotFoundError");
  expect(FakeContext.instances.at(-1)!.closed).toBe(true);
});

it("maps click times onto its own device, and corrects the mapping as the device's clock drifts", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
  const main = new FakeContext() as unknown as AudioContext;
  const output = await SeparateClickOutput.open(main, "headphones");
  const sink = FakeContext.instances[1];
  expect(sink.sinkIds).toEqual(["headphones"]);
  // Both clocks start together: a main-clock time of 2 s is 2 s on the click's clock.
  expect(output.localTime(2)).toBeCloseTo(2);

  // The headphone device now reports its output 10 ms later on the performance clock: its clock is behind by 10 ms.
  sink.timestamp = { contextTime: 1, performanceTime: 1010 };
  expect(output.localTime(2)).toBeCloseTo(2);
  vi.advanceTimersByTime(2000);
  expect(output.localTime(2)).toBeCloseTo(1.99);
  await output.dispose();
  expect(sink.closed).toBe(true);
});
