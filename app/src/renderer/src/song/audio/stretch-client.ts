import type { PcmAudio } from "../types";
import type { StretchReply, StretchRequest } from "./stretch-worker";
import type { StretchSettings } from "./stretch";

// Renders a stem's stretch in a small pool of workers and resolves with the result. A multitrack song asks for many stems at once,
// and one worker per stem would hold every stem's copy and output in memory together, so only a few run at a time and the rest wait.
// An aborted render is dropped at once: a queued one never starts, and a running one has its worker ended, which frees its buffers.
// The caller keeps its own buffers: they are copied before they are transferred, so the stems a session already holds stay playable.

/** How many stretches run at once: one core is left to the renderer, and there are never more than four. */
export function stretchPoolSize(cores: number = navigator.hardwareConcurrency || 2): number {
  return Math.max(1, Math.min(4, cores - 1));
}

/** The error an aborted render rejects with. */
export function abortError(): Error {
  const error = new Error("The render was cancelled.");
  error.name = "AbortError";
  return error;
}

interface Job {
  request: StretchRequest;
  transfer: ArrayBuffer[];
  resolve: (pcm: PcmAudio) => void;
  reject: (error: Error) => void;
}

/** The part of a Worker the pool uses, so a test can stand in for it. */
export interface PoolWorker {
  onmessage: ((event: MessageEvent<StretchReply>) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(request: StretchRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export class StretchPool {
  private idle: PoolWorker[] = [];
  private running = new Map<Job, PoolWorker>();
  private queue: Job[] = [];

  constructor(
    private readonly size: number,
    private readonly create: () => PoolWorker,
  ) {}

  /** Renders `pcm` at `settings`. Rejects with an AbortError when `signal` aborts, whether the render waits or runs. */
  stretch(pcm: PcmAudio, settings: StretchSettings, signal?: AbortSignal): Promise<PcmAudio> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const copy: PcmAudio = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((channel) => channel.slice()) };
      const job: Job = { request: { id: 0, pcm: copy, settings }, transfer: copy.channels.map((channel) => channel.buffer as ArrayBuffer), resolve, reject };
      signal?.addEventListener("abort", () => this.abort(job), { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  /** Ends every worker. The jobs still running or waiting are rejected as aborted. */
  dispose(): void {
    for (const worker of [...this.idle, ...this.running.values()]) worker.terminate();
    this.idle = [];
    const jobs = [...this.running.keys(), ...this.queue.splice(0)];
    this.running.clear();
    for (const job of jobs) job.reject(abortError());
  }

  private abort(job: Job): void {
    const waiting = this.queue.indexOf(job);
    if (waiting >= 0) this.queue.splice(waiting, 1);
    const worker = this.running.get(job);
    // Ending the worker frees the copy it holds. The next waiting job starts on a fresh worker.
    if (worker) this.discard(worker, job);
    job.request.pcm.channels = [];
    job.reject(abortError());
  }

  /** Starts waiting jobs while a worker is free. */
  private pump(): void {
    while (this.queue.length && this.running.size < this.size) {
      const job = this.queue.shift()!;
      const worker = this.idle.pop() ?? this.create();
      this.running.set(job, worker);
      worker.onmessage = (event) => {
        this.release(worker, job);
        if ("error" in event.data) job.reject(new Error(event.data.error));
        else job.resolve(event.data.pcm);
      };
      worker.onerror = () => {
        this.discard(worker, job);
        job.reject(new Error("The stretch worker failed. Try again, or play the song at its own speed."));
      };
      worker.postMessage(job.request, job.transfer);
    }
  }

  /** A worker that finished goes back to the pool, and the next waiting job starts. */
  private release(worker: PoolWorker, job: Job): void {
    this.running.delete(job);
    this.idle.push(worker);
    this.pump();
  }

  /** A worker that is aborted or failed is ended, and the next waiting job starts. */
  private discard(worker: PoolWorker, job: Job): void {
    this.running.delete(job);
    worker.terminate();
    this.pump();
  }
}

let shared: StretchPool | null = null;

/** Renders `pcm` at `settings` on the shared pool. Rejects if a worker fails, the stretch throws, or `signal` aborts. */
export function stretchInWorker(pcm: PcmAudio, settings: StretchSettings, signal?: AbortSignal): Promise<PcmAudio> {
  shared ??= new StretchPool(stretchPoolSize(), () => new Worker(new URL("./stretch-worker.ts", import.meta.url), { type: "module" }) as unknown as PoolWorker);
  return shared.stretch(pcm, settings, signal);
}
