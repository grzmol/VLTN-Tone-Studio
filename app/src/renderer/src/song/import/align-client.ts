import type { AlignedTrack, AlignReply, AlignRequest } from "./import-worker";

// Runs the alignment and the mix in a worker. The request's buffers are given to the worker, so the caller must not use them after.

/** Aligns `tracks` to `frames` and optionally sums them, in a worker. Rejects if the worker fails. */
export function alignInWorker(request: Omit<AlignRequest, "id">): Promise<{ tracks: AlignedTrack[]; mix: Float32Array[] | null }> {
  const worker = new Worker(new URL("./import-worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<AlignReply>) => {
      finish();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve({ tracks: event.data.tracks, mix: event.data.mix });
    };
    worker.onerror = () => {
      finish();
      reject(new Error("The import worker failed. Try the import again."));
    };
    const message: AlignRequest = { ...request, id: 0 };
    const transfer = request.tracks.flatMap((track) => track.channels.map((channel) => channel.buffer));
    worker.postMessage(message, transfer);
  });
}
