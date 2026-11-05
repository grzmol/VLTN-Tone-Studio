import type { FlacBits } from "@shared/flac";
import type { PcmAudio } from "../types";
import type { FlacRequest, FlacResponse } from "./flac-worker";

function run(request: FlacRequest, transfer: Transferable[]): Promise<FlacResponse & { ok: true }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./flac-worker.ts", import.meta.url), { type: "module" });
    const done = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<FlacResponse>) => {
      done();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || "The audio codec failed to start."));
    };
    worker.postMessage(request, transfer);
  });
}

/** Encodes one track at the given depth (16 for stems and imports; see `storedBits`). The channels are copied into the worker, so the song in memory stays intact. */
export async function encodeTrack(audio: PcmAudio, bits: FlacBits = 16): Promise<Uint8Array> {
  const result = await run({ kind: "encode", audio: { sampleRate: audio.sampleRate, channels: audio.channels, bits } }, []);
  return result.bytes!;
}

/** Decodes one track. The file's buffer is handed to the worker instead of copied. */
export async function decodeTrack(file: ArrayBuffer): Promise<PcmAudio> {
  const result = await run({ kind: "decode", bytes: new Uint8Array(file) }, [file]);
  return result.audio!;
}
