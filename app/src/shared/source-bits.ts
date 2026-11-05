/**
 * The bit depth an imported audio file was recorded at, read from its header. The browser's decoder hands back float samples, so the depth
 * is lost there; the library needs it to decide whether the saved source is 16 or 24 bits (see `storedBits`). Only the first bytes are read.
 * Returns undefined for formats with no fixed depth (MP3, AAC, Ogg), which are stored at 16 bits.
 */
export function sourceBitDepth(head: Uint8Array): number | undefined {
  const text = (start: number, length: number) => String.fromCharCode(...head.subarray(start, start + length));
  if (head.length >= 36 && text(0, 4) === "RIFF" && text(8, 4) === "WAVE" && text(12, 4) === "fmt ") {
    const depth = head[34] | (head[35] << 8);
    return depth > 0 ? depth : undefined;
  }
  if (head.length >= 28 && text(0, 4) === "fLaC") {
    // STREAMINFO: the sample rate (20 bits), channels (3) and bits per sample minus one (5) share the eight bytes at offset 18.
    const bitsMinusOne = ((head[20] & 0x01) << 4) | (head[21] >> 4);
    return bitsMinusOne + 1;
  }
  return undefined;
}
