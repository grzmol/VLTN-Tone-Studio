import { describe, expect, it } from "vitest";
import { decodeFlac, encodeFlac, matchesQuantized, quantizer, scaleOf, storedBits, toPcm } from "./flac";

function tone(frames: number, offset: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = 0.6 * Math.sin((i + offset) / 17) + 0.2 * Math.sin((i + offset) / 211);
  return out;
}

describe("FLAC codec", () => {
  it("round-trips stereo audio bit-exactly at 24 bits", async () => {
    const channels = [tone(50000, 0), tone(50000, 400)];
    const decoded = await decodeFlac(await encodeFlac({ sampleRate: 44100, channels, bits: 24 }));
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.bits).toBe(24);
    expect(decoded.channels).toHaveLength(2);
    expect(matchesQuantized(decoded, channels, 24)).toBe(true);
  });

  it("stores 16 bits by default and decodes to the dithered 16-bit values", async () => {
    const channels = [tone(50000, 0), tone(50000, 400)];
    const decoded = await decodeFlac(await encodeFlac({ sampleRate: 44100, channels }));
    expect(decoded.bits).toBe(16);
    expect(matchesQuantized(decoded, channels, 16)).toBe(true);
    expect(matchesQuantized(decoded, channels, 24)).toBe(false);
  });

  it("dithers 16-bit output by at most two steps, and a fixed seed gives the same bits every time", () => {
    const x = tone(20000, 0);
    const [ints] = toPcm([x], 16);
    for (let i = 0; i < x.length; i++) expect(Math.abs(ints[i] - x[i] * scaleOf(16))).toBeLessThan(2);
    expect(toPcm([x], 16)[0]).toEqual(ints);
    // A quiet signal below one step still dithers rather than dropping to zero.
    expect(new Set(toPcm([new Float32Array(1000).fill(0.4 / scaleOf(16))], 16)[0]).size).toBeGreaterThan(1);
    // Digital silence is exact zero: it is already on the grid, so it is not dithered.
    expect(toPcm([new Float32Array(1000)], 16)[0].every((v) => v === 0)).toBe(true);
    expect(toPcm([new Float32Array(1000)], 24)[0].every((v) => v === 0)).toBe(true);
  });

  it("re-encoding 16-bit output at 16 bits keeps the same integers", async () => {
    const first = await decodeFlac(await encodeFlac({ sampleRate: 44100, channels: [tone(20000, 0), tone(20000, 300)] }));
    const second = await decodeFlac(await encodeFlac({ sampleRate: 44100, channels: first.channels, bits: 16 }));
    expect(matchesQuantized(first, first.channels, 16)).toBe(true);
    expect(second.channels).toEqual(first.channels);
  });

  it("streams in blocks to the same integers as a single pass", () => {
    const x = tone(1000, 0);
    const y = tone(1000, 50);
    const whole = new Int32Array(2000);
    quantizer(16)([x, y], 0, 1000, whole);
    const split = new Int32Array(2000);
    const q = quantizer(16);
    q([x, y], 0, 400, split.subarray(0, 800));
    q([x, y], 400, 600, split.subarray(800));
    expect(split).toEqual(whole);
  });

  it("picks 24 bits for the source only when its original was deeper than 16 bits", () => {
    expect(storedBits("source", 24)).toBe(24);
    expect(storedBits("source", 32)).toBe(24);
    expect(storedBits("source", 16)).toBe(16);
    expect(storedBits("source", undefined)).toBe(16);
    expect(storedBits("stem", 24)).toBe(16);
    expect(storedBits("user", 24)).toBe(16);
  });

  it("keeps mono and sample rates", async () => {
    const decoded = await decodeFlac(await encodeFlac({ sampleRate: 48000, channels: [tone(9000, 3)] }));
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channels).toHaveLength(1);
  });

  it("clips out-of-range samples instead of wrapping", async () => {
    const decoded = await decodeFlac(await encodeFlac({ sampleRate: 44100, channels: [Float32Array.of(2, -2, 0.5, 0)], bits: 24 }));
    expect(Array.from(decoded.channels[0].slice(0, 2))).toEqual([1, -1]);
  });

  it("compresses a tonal signal well below raw float32", async () => {
    const channels = [tone(200000, 0), tone(200000, 90)];
    const bytes = await encodeFlac({ sampleRate: 44100, channels });
    expect(bytes.length).toBeLessThan(200000 * 2 * 4 * 0.6);
  });

  it("rejects empty and mismatched input", async () => {
    await expect(encodeFlac({ sampleRate: 44100, channels: [] })).rejects.toThrow();
    await expect(encodeFlac({ sampleRate: 44100, channels: [new Float32Array(4), new Float32Array(3)] })).rejects.toThrow();
  });

  it("rejects damaged and non-FLAC data", async () => {
    const bytes = await encodeFlac({ sampleRate: 44100, channels: [tone(20000, 0)] });
    await expect(decodeFlac(new TextEncoder().encode("not audio at all"))).rejects.toThrow();
    await expect(decodeFlac(bytes.slice(0, Math.floor(bytes.length / 2)))).rejects.toThrow();
  });

  it("encodes and decodes four minutes of stereo audio quickly enough to load a song", async () => {
    const frames = 44100 * 240;
    const channels = [tone(frames, 0), tone(frames, 700)];
    const encodeStart = performance.now();
    const bytes = await encodeFlac({ sampleRate: 44100, channels });
    const decodeStart = performance.now();
    await decodeFlac(bytes);
    const decodeMs = performance.now() - decodeStart;
    console.info(`4 min stereo: ${(bytes.length / 1e6).toFixed(1)} MB, encode ${Math.round(decodeStart - encodeStart)} ms, decode ${Math.round(decodeMs)} ms`);
    expect(decodeMs).toBeLessThan(5000);
  }, 60000);
});
