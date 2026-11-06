import { describe, expect, it } from "vitest";
import { stretchedLength, stretchPcm } from "./stretch";

const SR = 44100;

/** A sine at `hz` for `seconds`, as one channel. */
function tone(hz: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

/** Rising zero crossings per second, measured over the middle of the signal so the engine's start-up is not counted. */
function frequency(samples: Float32Array): number {
  const from = Math.floor(samples.length / 3),
    to = from + SR;
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings;
}

describe("stretchedLength", () => {
  it("is the input length divided by the rate", () => {
    expect(stretchedLength(SR, 1)).toBe(SR);
    expect(stretchedLength(SR, 0.5)).toBe(2 * SR);
    expect(stretchedLength(SR, 1.5)).toBe(Math.round(SR / 1.5));
  });

  it("clamps the rate to the allowed range", () => {
    expect(stretchedLength(SR, 0.1)).toBe(2 * SR);
  });
});

describe("stretchPcm", () => {
  it("changes the length and keeps the pitch at a slower and a faster rate", () => {
    for (const rate of [0.5, 0.8, 1.25, 1.5]) {
      const out = stretchPcm({ sampleRate: SR, channels: [tone(440, 3)] }, { rate, semitones: 0, cents: 0 });
      expect(out.channels[0].length).toBe(stretchedLength(3 * SR, rate));
      expect(frequency(out.channels[0])).toBeCloseTo(440, -1);
    }
  });

  it("shifts the pitch without changing the length", () => {
    const out = stretchPcm({ sampleRate: SR, channels: [tone(440, 3)] }, { rate: 1, semitones: 3, cents: 0 });
    expect(out.channels[0].length).toBe(3 * SR);
    // 440 Hz up three semitones is about 523 Hz; three semitones and fifty cents is 3.5 semitones, about 539 Hz.
    expect(frequency(out.channels[0])).toBeCloseTo(523, -1);
    const fine = stretchPcm({ sampleRate: SR, channels: [tone(440, 3)] }, { rate: 1, semitones: 3, cents: 50 });
    expect(frequency(fine.channels[0])).toBeCloseTo(539, -1);
  });

  it("keeps mono as mono and stereo as stereo", () => {
    const mono = stretchPcm({ sampleRate: SR, channels: [tone(440, 1)] }, { rate: 0.8, semitones: 0, cents: 0 });
    expect(mono.channels).toHaveLength(1);
    const stereo = stretchPcm({ sampleRate: SR, channels: [tone(440, 1), tone(440, 1)] }, { rate: 0.8, semitones: 0, cents: 0 });
    expect(stereo.channels).toHaveLength(2);
    expect(stereo.sampleRate).toBe(SR);
  });

  it("keeps the end of the song rather than cutting it off", () => {
    const out = stretchPcm({ sampleRate: SR, channels: [tone(440, 2)] }, { rate: 1.5, semitones: 0, cents: 0 });
    const tail = out.channels[0].subarray(out.channels[0].length - SR / 10);
    expect(Math.max(...tail.map(Math.abs))).toBeGreaterThan(0.3);
  });

  it("returns silence for an empty stem", () => {
    const out = stretchPcm({ sampleRate: SR, channels: [new Float32Array(0)] }, { rate: 0.5, semitones: 0, cents: 0 });
    expect(out.channels[0]).toHaveLength(0);
  });
});

/** A click train over low noise with its own seed, so the test does not measure the calibration's own bursts. Bursts every second. */
function clickTrain(seed: number): { signal: Float32Array; bursts: number[] } {
  const frames = 12 * SR;
  const signal = new Float32Array(frames);
  let state = seed;
  const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < frames; i++) signal[i] = 0.02 * random();
  const bursts: number[] = [];
  for (let t = 0.5; t < 11.5; t += 1) {
    const start = Math.round(t * SR);
    bursts.push(start);
    for (let i = 0; i < 200; i++) signal[start + i] += 0.8 * random() * Math.exp(-i / 40);
  }
  return { signal, bursts };
}

/** Where each burst lands in the output, in ms from where song time puts it (song time ÷ rate). A burst with no match is null: it was lost. */
function burstErrors(output: Float32Array, signal: Float32Array, bursts: number[], rate: number): (number | null)[] {
  const template = signal.subarray(bursts[2], bursts[2] + 200);
  const search = Math.round(0.25 * SR);
  const errors: (number | null)[] = [];
  for (const start of bursts.slice(1, -1)) {
    const expected = Math.round(start / rate);
    let best = -Infinity,
      at = expected;
    for (let k = Math.max(0, expected - search); k < Math.min(output.length - 200, expected + search); k++) {
      let c = 0;
      for (let i = 0; i < 200; i++) c += output[k + i] * template[i];
      if (c > best) {
        best = c;
        at = k;
      }
    }
    errors.push(best > 0.4 ? ((at - expected) / SR) * 1000 : null);
  }
  return errors;
}

describe("alignment of transients", () => {
  it.each([
    [0.5, 0],
    [0.75, 0],
    [1.25, 0],
    [1.5, 0],
    [1, 3],
    [1, -3],
  ])("lands transients on song time at rate %f, shift %i semitones", (rate, semitones) => {
    const { signal, bursts } = clickTrain(4242);
    const out = stretchPcm({ sampleRate: SR, channels: [signal] }, { rate, semitones, cents: 0 }).channels[0];
    const errors = burstErrors(out, signal, bursts, rate);
    const matched = errors.filter((e): e is number => e !== null);
    const sorted = matched.map(Math.abs).sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Measured when this was written (spec Status): medians 0.8 to 3.6 ms; 6 to 9 of 9 bursts within 5 ms, lost bursts counted as misses.
    expect(median).toBeLessThan(5);
    expect(errors.filter((e) => e !== null && Math.abs(e) <= 5).length).toBeGreaterThanOrEqual(6);
  });
});
