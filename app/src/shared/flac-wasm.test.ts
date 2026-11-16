// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { decodeFlac, decodeFlacTo, encodeFlac, loadFlacWasm } from "./flac";

// The WASM build finds its binary through `self`, which a worker has and Node does not, and it loads the binary with fetch(), which in
// Node takes a URL rather than a path. Both are only for this test; the app's worker has them.
(globalThis as { self?: unknown }).self ??= globalThis;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const path = String(url);
  return path.startsWith("/") ? new Response(readFileSync(path)) : realFetch(url, init);
}) as typeof fetch;

function tone(frames: number, offset: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = 0.6 * Math.sin((i + offset) / 17) + 0.2 * Math.sin((i + offset) / 211) + 0.05 * Math.sin(i * 12.9898 + offset);
  return out;
}

describe("FLAC decoding with the WASM build", () => {
  const wasmPath = createRequire(import.meta.url).resolve("libflacjs/dist/libflac.wasm.wasm");

  it("gives the same samples as the asm.js build", async () => {
    const bytes = await encodeFlac({ sampleRate: 44100, channels: [tone(120000, 0), tone(120000, 400)] });
    const asm = await decodeFlac(bytes);
    const wasm = await decodeFlac(bytes, loadFlacWasm(wasmPath));
    expect(wasm.sampleRate).toBe(asm.sampleRate);
    expect(wasm.channels).toEqual(asm.channels);
  });

  // Stems are stored at 16 bits and the source at 24; both depths must decode bit for bit the same on either build.
  it.each([16, 24] as const)("gives the same %i-bit samples as the asm.js build", async (bits) => {
    const bytes = await encodeFlac({ sampleRate: 44100, channels: [tone(90000, 0), tone(90000, 250)], bits });
    const asm = await decodeFlac(bytes);
    const wasm = await decodeFlac(bytes, loadFlacWasm(wasmPath));
    expect(asm.bits).toBe(bits);
    expect(wasm.bits).toBe(bits);
    expect(wasm.channels).toEqual(asm.channels);
  });

  it("rejects damaged data the same way", async () => {
    const bytes = await encodeFlac({ sampleRate: 44100, channels: [tone(20000, 0)] });
    await expect(decodeFlac(bytes.slice(0, Math.floor(bytes.length / 2)), loadFlacWasm(wasmPath))).rejects.toThrow();
  });

  it.each([16, 24] as const)("streams %i-bit samples identically with acknowledged, recycled chunks", async (bits) => {
    const bytes = await encodeFlac({ sampleRate: 44100, channels: [tone(190000, 0), tone(190000, 41)], bits });
    const expected = await decodeFlac(bytes);
    const output = [new Float32Array(190000), new Float32Array(190000)];
    let written = 0,
      initialized = false,
      pending = false,
      chunks = 0;
    const buffers = new Set<ArrayBufferLike>();
    await decodeFlacTo(
      bytes,
      {
        async init(info) {
          expect(info).toEqual({ sampleRate: 44100, frames: 190000, channels: 2, bits });
          await new Promise((resolve) => setTimeout(resolve));
          initialized = true;
        },
        async write(channels, offset) {
          expect(initialized).toBe(true);
          expect(pending).toBe(false);
          expect(offset).toBe(written);
          expect(channels[0].length).toBeLessThanOrEqual(65536);
          pending = true;
          for (const channel of channels) buffers.add(channel.buffer);
          channels.forEach((channel, index) => output[index].set(channel, offset));
          written += channels[0].length;
          chunks++;
          await new Promise((resolve) => setTimeout(resolve));
          pending = false;
          return channels.map((channel) => new Float32Array(channel.buffer));
        },
      },
      loadFlacWasm(wasmPath),
    );
    expect(written).toBe(190000);
    expect(chunks).toBe(3);
    // At most two stereo scratch chunks exist, even though the full song can be arbitrarily long.
    expect(buffers.size).toBeLessThanOrEqual(4);
    expect(output).toEqual(expected.channels);
  });

  it("rejects a truncated streamed decode and propagates a failed destination", async () => {
    const bytes = await encodeFlac({ sampleRate: 44100, channels: [tone(150000, 0)] });
    const sink = { init: async () => {}, write: async () => {} };
    await expect(decodeFlacTo(bytes.slice(0, bytes.length / 2), sink, loadFlacWasm(wasmPath))).rejects.toThrow();
    await expect(
      decodeFlacTo(
        bytes,
        {
          ...sink,
          write: async () => {
            throw new Error("Destination closed");
          },
        },
        loadFlacWasm(wasmPath),
      ),
    ).rejects.toThrow("Destination closed");
  });
});
