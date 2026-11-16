import { decodeFlac, decodeFlacTo, encodeFlac, loadFlacWasm, type FlacAudio, type FlacStreamInfo } from "@shared/flac";
// Vite emits the WASM decoder as a file of the bundle; the decoder fetches it from this URL in the worker.
import flacWasmUrl from "libflacjs/dist/libflac.wasm.wasm?url";

/** One FLAC job at a time per worker. Library playback reuses two decoder heaps. */
export type FlacRequest =
  { kind: "encode"; audio: FlacAudio } | { kind: "decode" | "decode-playback"; bytes: Uint8Array } | { kind: "continue"; buffers?: ArrayBuffer[] };
export type FlacResponse =
  | { ok: true; audio?: FlacAudio; bytes?: Uint8Array; header?: FlacStreamInfo; chunk?: { channels: Float32Array[]; offset: number }; done?: boolean }
  | { ok: false; error: string };
let resume: ((buffers: ArrayBuffer[]) => void) | undefined;
const deliver = (message: FlacResponse, transfer: Transferable[] = []) =>
  new Promise<ArrayBuffer[]>((resolve) => {
    resume = resolve;
    (self as unknown as Worker).postMessage(message, transfer);
  });

self.onmessage = async (event: MessageEvent<FlacRequest>) => {
  try {
    const request = event.data;
    if (request.kind === "continue") {
      const next = resume;
      resume = undefined;
      next?.(request.buffers ?? []);
      return;
    }
    if (request.kind === "encode") {
      const bytes = await encodeFlac(request.audio);
      (self as unknown as Worker).postMessage({ ok: true, bytes } satisfies FlacResponse, [bytes.buffer]);
    } else if (request.kind === "decode-playback") {
      await decodeFlacTo(
        request.bytes,
        {
          init: async (header) => {
            await deliver({ ok: true, header });
          },
          write: async (channels, offset) => {
            const returned = await deliver(
              { ok: true, chunk: { channels, offset } },
              channels.map((channel) => channel.buffer),
            );
            return returned.map((buffer) => new Float32Array(buffer));
          },
        },
        loadFlacWasm(flacWasmUrl),
      );
      (self as unknown as Worker).postMessage({ ok: true, done: true } satisfies FlacResponse);
    } else {
      const audio = await decodeFlac(request.bytes, loadFlacWasm(flacWasmUrl));
      (self as unknown as Worker).postMessage(
        { ok: true, audio } satisfies FlacResponse,
        audio.channels.map((c) => c.buffer),
      );
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies FlacResponse);
  }
};
