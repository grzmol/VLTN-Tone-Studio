import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playRhythmPreview } from "./rhythm-preview";
import type { SampleSet } from "./samples";

const mocks = vi.hoisted(() => ({
  load: vi.fn<() => Promise<SampleSet>>(),
  render: vi.fn(() => ({ audio: { sampleRate: 44100, channels: [new Float32Array(4410), new Float32Array(4410)] }, gain: 1 })),
}));
vi.mock("./samples", () => ({ loadSampleSet: mocks.load }));
vi.mock("./render", () => ({ renderPart: mocks.render, RENDER_RATE: 44100 }));
const samples = {} as SampleSet;
const notes = [{ time: 0, duration: 0.1, pitch: 36, velocity: 100 }];
let contexts: Context[];
class Context {
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  buffer = { copyToChannel: vi.fn() };
  node = { buffer: null as unknown, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  createBuffer = vi.fn(() => this.buffer);
  createBufferSource = vi.fn(() => this.node);
  constructor() {
    contexts.push(this);
  }
}
beforeEach(() => {
  contexts = [];
  mocks.load.mockReset().mockResolvedValue(samples);
  mocks.render.mockClear();
  vi.stubGlobal("AudioContext", Context);
});
afterEach(() => vi.unstubAllGlobals());

describe("rhythm preview playback", () => {
  it("plays the assembled notes through their whole musical duration and closes the context when stopped", async () => {
    const done = vi.fn();
    const preview = playRhythmPreview(notes, 2, done);
    await preview.ready;
    expect(mocks.render).toHaveBeenCalledWith(notes, "drums", samples, 88200);
    expect(contexts[0].node.start).toHaveBeenCalledOnce();
    preview.stop();
    preview.stop();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });
  it("does not render or start audio after cancellation while the samples load", async () => {
    let resolve!: (samples: SampleSet) => void;
    mocks.load.mockReturnValue(
      new Promise((ready) => {
        resolve = ready;
      }),
    );
    const preview = playRhythmPreview(notes, 2, vi.fn());
    await Promise.resolve();
    preview.stop();
    resolve(samples);
    await preview.ready;
    expect(mocks.render).not.toHaveBeenCalled();
    expect(contexts[0].node.start).not.toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });
  it("releases audio resources when loading fails or playback ends naturally", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Missing drum sample"));
    const failed = playRhythmPreview(notes, 2, vi.fn());
    await expect(failed.ready).rejects.toThrow("Missing drum sample");
    expect(contexts[0].close).toHaveBeenCalledOnce();
    const done = vi.fn();
    const preview = playRhythmPreview(notes, 2, done);
    await preview.ready;
    contexts[1].node.onended?.();
    expect(contexts[1].close).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });
});
