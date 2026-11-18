import type { PcmAudio } from "../types";
import type { Chord, ChordsInput } from "../performance/chords";
import type { KeyInput, KeyReading } from "../performance/key";
import type { HarmonyReply, HarmonyRequest } from "./harmony-worker";

export interface HarmonyJob<T> {
  done: Promise<T>;
  cancel(): void;
}
interface Pending {
  resolve(result: KeyReading | Chord[]): void;
  reject(error: Error): void;
}
interface Reader {
  worker: Worker;
  pending: Map<number, Pending>;
}

const readers = new WeakMap<PcmAudio, Reader>();
let nextId = 0;

/** Key and chord jobs for the same harmony share one worker-owned copy. Playback's borrowed channels are never transferred. */
function start<T extends KeyReading | Chord[]>(audio: PcmAudio, request: Exclude<HarmonyRequest, { kind: "audio" }>): HarmonyJob<T> {
  let reader = readers.get(audio);
  const retire = (owner: Reader) => {
    if (readers.get(audio) === owner) readers.delete(audio);
    owner.worker.onmessage = null;
    owner.worker.onerror = null;
    owner.worker.terminate();
  };
  if (!reader) {
    const worker = new Worker(new URL("./harmony-worker.ts", import.meta.url), { type: "module" });
    reader = { worker, pending: new Map() };
    const owner = reader;
    readers.set(audio, owner);
    worker.onmessage = (event: MessageEvent<HarmonyReply>) => {
      const reply = event.data;
      const job = owner.pending.get(reply.id);
      if (!job) return;
      owner.pending.delete(reply.id);
      if ("error" in reply) job.reject(new Error(reply.error));
      else job.resolve(reply.result);
      if (!owner.pending.size) retire(owner);
    };
    worker.onerror = (event) => {
      const pending = [...owner.pending.values()];
      owner.pending.clear();
      retire(owner);
      for (const job of pending) job.reject(new Error(event.message || "Harmony analysis could not finish."));
    };
    try {
      worker.postMessage({ kind: "audio", audio } satisfies HarmonyRequest);
    } catch (error) {
      retire(owner);
      throw error;
    }
  }
  const owner = reader;
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<T>((resolve, reject) => {
    rejectDone = reject;
    owner.pending.set(request.id, { resolve: (result) => resolve(result as T), reject });
    try {
      owner.worker.postMessage(request);
    } catch (error) {
      owner.pending.delete(request.id);
      if (!owner.pending.size) retire(owner);
      reject(error);
    }
  });
  void done.catch(() => {});
  return {
    done,
    cancel() {
      if (!owner.pending.delete(request.id)) return;
      const error = new Error("Harmony analysis was cancelled.");
      error.name = "AbortError";
      rejectDone(error);
      if (!owner.pending.size) retire(owner);
    },
  };
}

/** Estimates a key while sharing the harmony copy with any simultaneous chord estimate. */
export function startKeyReading({ harmony, ...input }: KeyInput): HarmonyJob<KeyReading> {
  return start(harmony, { kind: "key", id: ++nextId, input });
}

/** Estimates chords while sharing the harmony copy with any simultaneous key estimate. */
export function startChordReading({ harmony, ...input }: ChordsInput): HarmonyJob<Chord[]> {
  return start(harmony, { kind: "chords", id: ++nextId, input });
}
