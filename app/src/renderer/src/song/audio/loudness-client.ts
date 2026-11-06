import type { PcmAudio } from "../types";
import type { LoudnessReply, LoudnessRequest } from "./loudness-worker";
import type { SongMeasure } from "./loudness";

// Measures a song's loudness and sample peak in a worker and resolves with both. The caller keeps its own buffers: they are copied before
// they are transferred.

/** The song's integrated loudness (LUFS, -Infinity for silence) and sample peak (dBFS). Rejects if the worker fails. */
export function measureLoudnessInWorker(pcm: PcmAudio): Promise<SongMeasure> {
  const worker = new Worker(new URL("./loudness-worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<LoudnessReply>) => {
      finish();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve({ lufs: event.data.lufs, peakDb: event.data.peakDb });
    };
    worker.onerror = () => {
      finish();
      reject(new Error("The loudness worker failed. Try again."));
    };
    const copy: PcmAudio = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((channel) => channel.slice()) };
    const request: LoudnessRequest = { id: 0, pcm: copy };
    worker.postMessage(
      request,
      copy.channels.map((channel) => channel.buffer),
    );
  });
}
