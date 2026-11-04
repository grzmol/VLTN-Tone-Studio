// Tune a split's stems down or up (transpose-core.ts) in a Web Worker. The result is a new Stems of the same length;
// the original stays with the caller, so going back to 0 costs nothing.
import type { StemName } from "@shared/host/song";
import type { Stems } from "@/song/types";

export interface ShiftRequest {
  sampleRate: number;
  semitones: number;
  stems: { name: string; channels: Float32Array[] }[];
}

export type ShiftReply = { type: "progress"; fraction: number } | { type: "done"; stems: { name: string; channels: Float32Array[] }[] } | { type: "error"; message: string };

/** `stems` shifted by `semitones`. Rejects with AbortError on `signal`. */
export function transposeStems(stems: Stems, semitones: number, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Stems> {
  const entries = Object.entries(stems).filter((e): e is [StemName, NonNullable<Stems[StemName]>] => !!e[1]);
  const sampleRate = entries[0]?.[1].sampleRate ?? 44100;
  // copied: the originals stay with the player, and the copies are handed over to the worker
  const request: ShiftRequest = { sampleRate, semitones, stems: entries.map(([name, pcm]) => ({ name, channels: pcm.channels.map((c) => c.slice()) })) };
  const worker = new Worker(new URL("./transpose-worker.ts", import.meta.url), { type: "module" });
  return new Promise<Stems>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Transposing cancelled", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort);
    worker.onmessage = (e: MessageEvent<ShiftReply>) => {
      const msg = e.data;
      if (msg.type === "progress") return onProgress?.(msg.fraction);
      finish();
      if (msg.type === "error") return reject(new Error(msg.message));
      resolve(Object.fromEntries(msg.stems.map((s) => [s.name, { sampleRate, channels: s.channels }])) as Stems);
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "The pitch shifter stopped"));
    };
    worker.postMessage(request, request.stems.flatMap((s) => s.channels.map((c) => c.buffer)));
  });
}
