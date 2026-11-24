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
  /** The audios this worker holds a copy of, and the index each was sent under. */
  copies: Map<PcmAudio, number>;
}
type JobRequest = { kind: "key"; id: number; harmony: number; input: Omit<KeyInput, "harmony"> } | { kind: "chords"; id: number; harmony: number[]; input: Omit<ChordsInput, "harmony" | "harmonyParts"> };

const readers = new WeakMap<PcmAudio, Reader>();
let nextId = 0;

/**
 * Key and chord jobs that read any of the same audio share one worker, and each distinct audio is copied to it once. The worker derives the
 * chord harmony (the sum of its parts) itself. Playback's borrowed channels are never transferred.
 */
function start<T extends KeyReading | Chord[]>(audios: readonly PcmAudio[], build: (indexOf: (audio: PcmAudio) => number) => JobRequest): HarmonyJob<T> {
  let reader = audios.map((audio) => readers.get(audio)).find((found) => found);
  const retire = (owner: Reader) => {
    for (const audio of owner.copies.keys()) if (readers.get(audio) === owner) readers.delete(audio);
    owner.worker.onmessage = null;
    owner.worker.onerror = null;
    owner.worker.terminate();
  };
  let created: Reader | null = null;
  if (!reader) {
    const worker = new Worker(new URL("./harmony-worker.ts", import.meta.url), { type: "module" });
    const owner: Reader = { worker, pending: new Map(), copies: new Map() };
    reader = created = owner;
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
  }
  const owner = reader;
  const indexOf = (audio: PcmAudio): number => {
    const known = owner.copies.get(audio);
    if (known !== undefined) return known;
    const index = owner.copies.size;
    owner.worker.postMessage({ kind: "audio", index, audio } satisfies HarmonyRequest);
    owner.copies.set(audio, index);
    readers.set(audio, owner);
    return index;
  };
  let request: JobRequest;
  try {
    request = build(indexOf);
  } catch (error) {
    if (created || !owner.pending.size) retire(owner);
    throw error;
  }
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<T>((resolve, reject) => {
    rejectDone = reject;
    owner.pending.set(request.id, { resolve: (result) => resolve(result as T), reject });
    try {
      owner.worker.postMessage(request satisfies HarmonyRequest);
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
  return start([harmony], (indexOf) => ({ kind: "key", id: ++nextId, harmony: indexOf(harmony), input }));
}

/** Estimates chords, sharing each harmony stem's copy with any simultaneous key estimate. */
export function startChordReading({ harmony, harmonyParts, ...input }: ChordsInput): HarmonyJob<Chord[]> {
  const parts = harmonyParts?.length ? harmonyParts : [harmony];
  return start(parts, (indexOf) => ({ kind: "chords", id: ++nextId, harmony: parts.map(indexOf), input }));
}
