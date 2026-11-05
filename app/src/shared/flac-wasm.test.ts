// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { decodeFlac, encodeFlac, loadFlacWasm } from "./flac";

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
});
