import { describe, expect, it } from "vitest";
import { DEFAULT_SPEED, type SpeedSettings } from "../performance/speed";
import type { PcmAudio, Stems } from "../types";
import { isPlainSpeed, RenderQueue, trackStretch, type Stretch } from "./render-queue";

const pcm = (length: number): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(length)] });
const base: Stems = { drums: pcm(100), vocals: pcm(100) };
const speed = (patch: Partial<SpeedSettings>): SpeedSettings => ({ ...DEFAULT_SPEED, ...patch });

/** A stretch that records its calls and waits for the test to release each one. */
function recorder() {
  const calls: { length: number; semitones: number; rate: number }[] = [];
  const waiting: (() => void)[] = [];
  const stretch: Stretch = (input, settings) =>
    new Promise((resolve) => {
      calls.push({ length: input.channels[0].length, semitones: settings.semitones, rate: settings.rate });
      waiting.push(() => resolve({ sampleRate: input.sampleRate, channels: [new Float32Array(Math.round(input.channels[0].length / settings.rate))] }));
    });
  const release = async () => {
    while (waiting.length) waiting.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { calls, stretch, release };
}

describe("trackStretch and renderKey", () => {
  it("renders a track that does not follow the pitch at the rate only", () => {
    const s = speed({ rate: 0.8, semitones: 2, cents: 10 });
    expect(trackStretch(s, "drums")).toEqual({ rate: 0.8, semitones: 0, cents: 0 });
    expect(trackStretch(s, "vocals")).toEqual({ rate: 0.8, semitones: 2, cents: 10 });
    expect(trackStretch(speed({ rate: 0.8, followsPitch: { drums: true }, semitones: 2 }), "drums").semitones).toBe(2);
  });

  it("treats 100% with no shift as plain", () => {
    expect(isPlainSpeed(DEFAULT_SPEED)).toBe(true);
    expect(isPlainSpeed(speed({ cents: 5 }))).toBe(false);
  });
});

describe("RenderQueue", () => {
  it("returns the stems themselves at plain speed, without rendering", async () => {
    const rec = recorder();
    const queue = new RenderQueue(rec.stretch);
    expect(await queue.render(base, DEFAULT_SPEED)).toBe(base);
    expect(rec.calls).toHaveLength(0);
  });

  it("renders every track, reporting progress", async () => {
    const rec = recorder();
    const queue = new RenderQueue(rec.stretch);
    const progress: number[] = [];
    const pending = queue.render(base, speed({ rate: 0.5 }), (done) => progress.push(done));
    await rec.release();
    const out = await pending;
    expect(rec.calls.map((c) => [c.length, c.rate])).toEqual([
      [100, 0.5],
      [100, 0.5],
    ]);
    expect(progress).toEqual([0, 1, 2]);
    expect(out!.vocals!.channels[0]).toHaveLength(200);
  });

  it("drops a render that a newer request has overtaken, and keeps the newest", async () => {
    const rec = recorder();
    const queue = new RenderQueue(rec.stretch);
    const first = queue.render(base, speed({ rate: 0.5 }));
    const second = queue.render(base, speed({ rate: 0.8 }));
    await rec.release();
    expect(await first).toBeNull();
    expect((await second)!.vocals!.channels[0]).toHaveLength(Math.round(100 / 0.8));
  });

  it("aborts the renders of the old setting when a new one comes", async () => {
    const signals: AbortSignal[] = [];
    const queue = new RenderQueue((input, _settings, signal) => {
      signals.push(signal!);
      return new Promise((resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error("aborted")));
        void resolve;
        void input;
      });
    });
    const first = queue.render(base, speed({ rate: 0.5 }));
    expect(signals.map((s) => s.aborted)).toEqual([false, false]);
    void queue.render(base, speed({ rate: 0.8 })).catch(() => {});
    expect(signals.slice(0, 2).map((s) => s.aborted)).toEqual([true, true]);
    expect(signals.slice(2).map((s) => s.aborted)).toEqual([false, false]);
    // The overtaken render ends quietly with null, not with the abort as an error
    expect(await first).toBeNull();
  });

  it("aborts what runs when the song's renders are cleared", async () => {
    let signal: AbortSignal | undefined;
    const queue = new RenderQueue((_input, _settings, s) => {
      signal = s;
      return new Promise(() => {});
    });
    void queue.render(base, speed({ rate: 0.5 }));
    queue.clear();
    expect(signal!.aborted).toBe(true);
  });

  it("still reports a real failure", async () => {
    const queue = new RenderQueue(() => Promise.reject(new Error("boom")));
    await expect(queue.render(base, speed({ rate: 0.5 }))).rejects.toThrow("boom");
  });

  it("answers a repeated setting from memory, and keeps only the current and the last one", async () => {
    const rec = recorder();
    const queue = new RenderQueue(rec.stretch);
    const a = queue.render(base, speed({ rate: 0.5 }));
    await rec.release();
    await a;
    const again = queue.render(base, speed({ rate: 0.5 }));
    await rec.release();
    await again;
    expect(rec.calls).toHaveLength(2);
    // Two more settings push the first one out, so going back to it renders again
    const b = queue.render(base, speed({ rate: 0.6 }));
    await rec.release();
    await b;
    const c = queue.render(base, speed({ rate: 0.7 }));
    await rec.release();
    await c;
    const back = queue.render(base, speed({ rate: 0.5 }));
    await rec.release();
    await back;
    expect(rec.calls).toHaveLength(8);
  });

  it("clears its renders with the song", async () => {
    const rec = recorder();
    const queue = new RenderQueue(rec.stretch);
    const a = queue.render(base, speed({ rate: 0.5 }));
    await rec.release();
    await a;
    queue.clear();
    const again = queue.render(base, speed({ rate: 0.5 }));
    await rec.release();
    await again;
    expect(rec.calls).toHaveLength(4);
  });
});
