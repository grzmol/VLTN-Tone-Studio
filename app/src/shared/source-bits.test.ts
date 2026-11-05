import { describe, expect, it } from "vitest";
import { sourceBitDepth } from "./source-bits";

function wav(bits: number): Uint8Array {
  const head = new Uint8Array(44);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode("RIFF"), 0);
  head.set(new TextEncoder().encode("WAVE"), 8);
  head.set(new TextEncoder().encode("fmt "), 12);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true);
  view.setUint16(34, bits, true);
  return head;
}

/** A FLAC header: the marker, a last-metadata STREAMINFO block header, then the packed rate, channels and depth. */
function flac(bits: number): Uint8Array {
  const head = new Uint8Array(42);
  head.set(new TextEncoder().encode("fLaC"), 0);
  head[4] = 0x80;
  const rate = 44100,
    channels = 2;
  // 20-bit rate, 3-bit channels-1, 5-bit bits-1, 36-bit total samples, all big-endian from byte 18.
  const packed = (BigInt(rate) << 44n) | (BigInt(channels - 1) << 41n) | (BigInt(bits - 1) << 36n);
  for (let i = 0; i < 8; i++) head[18 + i] = Number((packed >> BigInt(56 - 8 * i)) & 0xffn);
  return head;
}

describe("sourceBitDepth", () => {
  it("reads the depth of a WAV file", () => {
    expect(sourceBitDepth(wav(16))).toBe(16);
    expect(sourceBitDepth(wav(24))).toBe(24);
    expect(sourceBitDepth(wav(32))).toBe(32);
  });

  it("reads the depth of a FLAC file", () => {
    expect(sourceBitDepth(flac(16))).toBe(16);
    expect(sourceBitDepth(flac(24))).toBe(24);
  });

  it("returns undefined for lossy or unknown data", () => {
    expect(sourceBitDepth(new TextEncoder().encode("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000 and more bytes here"))).toBeUndefined();
    expect(sourceBitDepth(new Uint8Array(4))).toBeUndefined();
  });
});
