import type * as FlacModule from "libflacjs/dist/libflac";
import type { TrackKind } from "./song-library";

/**
 * Lossless FLAC for the song library. The same module runs in the main process (migration) and in a renderer worker (save and load), so it
 * uses the plain pure-JavaScript libflac build, whose memory image is embedded. The WASM build and the `min` build fetch a second file by URL,
 * which neither Node nor the packaged app can serve; with the `min` build the encoder silently fails to initialise.
 *
 * Samples are stored as integers at 16 or 24 bits. Stems and imported tracks are 16-bit with TPDF dither; the source is 24-bit only when its
 * original file was more than 16-bit (see `storedBits`). Decoding reads either depth, so older 24-bit files stay readable.
 */
export type FlacBits = 16 | 24;
const COMPRESSION_LEVEL = 5;
const BLOCK_FRAMES = 65536;

export interface FlacAudio {
  sampleRate: number;
  channels: Float32Array[];
  /** Encode: the depth to store at, default 16. Decode: the depth the file was stored at. */
  bits?: FlacBits;
}

/** The largest integer a sample of this depth is stored as. */
export const scaleOf = (bits: FlacBits): number => 2 ** (bits - 1) - 1;

/**
 * The bit depth a track is stored at. Stems and imported tracks are 16-bit. The source is 24-bit only when its original file was more than
 * 16 bits deep; when that is not known (a lossy file, a v1 migration) it is 16-bit.
 */
export function storedBits(kind: TrackKind, sourceBits?: number): FlacBits {
  return kind === "source" && (sourceBits ?? 0) > 16 ? 24 : 16;
}

/**
 * Turns float samples into the integers a FLAC stream holds, frame by frame and channel by channel. At 16 bits each sample gets TPDF dither
 * (two uniform values of half a step each), so the rounding error is noise instead of distortion. The dither comes from a fixed-seed generator,
 * so the same input always gives the same integers. Each call starts that generator again.
 */
export function quantizer(bits: FlacBits): (channels: Float32Array[], start: number, count: number, out: Int32Array) => void {
  const scale = scaleOf(bits);
  let seed = 0x2545f491;
  const next = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
  return (channels, start, count, out) => {
    const width = channels.length;
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < width; c++) {
        const x = Math.max(-1, Math.min(1, channels[c][start + i])) * scale;
        const dither = bits === 16 ? next() + next() - 1 : 0;
        out[i * width + c] = Math.max(-scale, Math.min(scale, Math.round(x + dither)));
      }
    }
  };
}

/** The integers a track is stored as, per channel. Used by the migration to check what it wrote. */
export function toPcm(channels: Float32Array[], bits: FlacBits): Int32Array[] {
  const frames = channels[0]?.length ?? 0;
  const interleaved = new Int32Array(frames * channels.length);
  quantizer(bits)(channels, 0, frames, interleaved);
  return channels.map((_, c) => Int32Array.from({ length: frames }, (_v, i) => interleaved[i * channels.length + c]));
}

/** Whether a decoded track holds exactly the integers `toPcm` gives for the original float samples at this depth. */
export function matchesQuantized(decoded: FlacAudio, channels: Float32Array[], bits: FlacBits): boolean {
  const scale = scaleOf(bits),
    expected = toPcm(channels, bits);
  return (
    decoded.channels.length === channels.length &&
    decoded.channels.every((ch, c) => ch.length === expected[c].length && ch.every((v, i) => Math.round(v * scale) === expected[c][i]))
  );
}

let loading: Promise<typeof FlacModule> | undefined;
function loadFlac(): Promise<typeof FlacModule> {
  loading ??= import("libflacjs/dist/libflac.js").then(
    (m) =>
      new Promise<typeof FlacModule>((resolve) => {
        const flac = ((m as { default?: unknown }).default ?? m) as typeof FlacModule;
        if (flac.isReady()) resolve(flac);
        else flac.on("ready", () => resolve(flac));
      }),
  );
  return loading;
}

export async function encodeFlac(audio: FlacAudio): Promise<Uint8Array> {
  const { sampleRate, channels } = audio;
  const bits = audio.bits ?? 16;
  const frames = channels[0]?.length ?? 0;
  if (!channels.length || channels.length > 2 || !frames || channels.some((c) => c.length !== frames)) throw new Error("Invalid audio for FLAC encoding.");
  const flac = await loadFlac();
  const encoder = flac.create_libflac_encoder(sampleRate, channels.length, bits, COMPRESSION_LEVEL, frames, false);
  if (!encoder) throw new Error("Could not start the FLAC encoder.");
  const chunks: Uint8Array[] = [];
  try {
    const status = flac.init_encoder_stream(encoder, (data) => {
      chunks.push(data.slice());
    });
    if (status !== 0) throw new Error(`Could not start the FLAC encoder (status ${status}).`);
    const quantize = quantizer(bits);
    const block = new Int32Array(BLOCK_FRAMES * channels.length);
    for (let start = 0, blockNo = 0; start < frames; start += BLOCK_FRAMES, blockNo++) {
      // The main process migrates songs with this; give its event loop a turn about every million frames.
      if (blockNo % 16 === 15) await new Promise((resolve) => setTimeout(resolve));
      const count = Math.min(BLOCK_FRAMES, frames - start);
      quantize(channels, start, count, block);
      if (!flac.FLAC__stream_encoder_process_interleaved(encoder, block.subarray(0, count * channels.length), count)) throw new Error("FLAC encoding failed.");
    }
    if (!flac.FLAC__stream_encoder_finish(encoder)) throw new Error("FLAC encoding failed.");
  } finally {
    flac.FLAC__stream_encoder_delete(encoder);
  }
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function decodeFlac(bytes: Uint8Array): Promise<FlacAudio> {
  const flac = await loadFlac();
  const decoder = flac.create_libflac_decoder(false);
  if (!decoder) throw new Error("Could not start the FLAC decoder.");
  let sampleRate = 0,
    total = 0,
    channelCount = 0,
    bits = 0,
    channels: Float32Array[] = [],
    written = 0,
    position = 0,
    failure = "";
  try {
    const status = flac.init_decoder_stream(
      decoder,
      (wanted) => {
        const count = Math.min(wanted, bytes.length - position);
        // libflac only reads the bytes; the cast narrows away SharedArrayBuffer, which a stored file never is.
        const buffer = bytes.subarray(position, position + count) as Uint8Array<ArrayBuffer>;
        position += count;
        return { buffer, readDataLength: count, error: false };
      },
      (data) => {
        // libflac hands out each channel as little-endian integers: 16-bit streams as 16-bit values, deeper ones as 32-bit.
        const samples = data.map((d) => (bits > 16 ? new Int32Array(d.buffer, d.byteOffset, d.byteLength >> 2) : new Int16Array(d.buffer, d.byteOffset, d.byteLength >> 1)));
        const frames = samples[0].length;
        if (written + frames > total) {
          failure = "The FLAC stream is longer than its header says.";
          return;
        }
        const scale = scaleOf(bits as FlacBits);
        for (let c = 0; c < channelCount; c++) for (let i = 0; i < frames; i++) channels[c][written + i] = samples[c][i] / scale;
        written += frames;
      },
      (_code, description) => {
        failure = String(description || "The FLAC stream is damaged.");
      },
      (meta) => {
        if (!meta) return;
        sampleRate = meta.sampleRate;
        total = meta.total_samples;
        channelCount = meta.channels;
        bits = meta.bitsPerSample;
        if (!total || channelCount < 1 || channelCount > 2 || bits < 8 || bits > 24) {
          failure = "Unsupported FLAC stream.";
          return;
        }
        channels = Array.from({ length: channelCount }, () => new Float32Array(total));
      },
    );
    if (status !== 0) throw new Error("This is not a FLAC file.");
    if (!flac.FLAC__stream_decoder_process_until_end_of_stream(decoder) || failure) throw new Error(failure || "The FLAC stream is damaged.");
    flac.FLAC__stream_decoder_finish(decoder);
  } finally {
    flac.FLAC__stream_decoder_delete(decoder);
  }
  if (!channels.length || written !== total) throw new Error("The FLAC stream is truncated.");
  return { sampleRate, channels, bits: bits as FlacBits };
}
