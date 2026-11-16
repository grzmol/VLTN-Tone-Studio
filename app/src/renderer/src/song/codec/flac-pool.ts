type Release = (healthy: boolean) => void;
interface DecodeJob {
  start(worker: Worker, release: Release): void;
  reject(error: unknown): void;
}

/** Reuses at most two decoder heaps instead of creating and retiring a WASM runtime for every library track. */
export class FlacDecoderPool {
  private workers = new Set<Worker>();
  private idle: Worker[] = [];
  private queued: DecodeJob[] = [];
  private active = new Map<Worker, DecodeJob>();
  private generation = 0;

  constructor(private readonly create = () => new Worker(new URL("./flac-worker.ts", import.meta.url), { type: "module" })) {}

  run(job: DecodeJob): void {
    this.queued.push(job);
    this.drain();
  }

  private drain(): void {
    while (this.queued.length && (this.idle.length || this.workers.size < 2)) {
      const job = this.queued.shift()!;
      let worker: Worker;
      try {
        worker = this.idle.pop() ?? this.create();
      } catch (error) {
        job.reject(error);
        continue;
      }
      this.workers.add(worker);
      this.active.set(worker, job);
      let released = false;
      const generation = this.generation;
      const release: Release = (healthy) => {
        if (released || generation !== this.generation) return;
        released = true;
        this.active.delete(worker);
        worker.onmessage = null;
        worker.onerror = null;
        if (healthy) {
          this.idle.push(worker);
          worker.onerror = () => this.discard(worker);
        } else this.discard(worker);
        this.drain();
      };
      try {
        job.start(worker, release);
      } catch (error) {
        release(false);
        job.reject(error);
      }
    }
  }

  private discard(worker: Worker): void {
    this.idle = this.idle.filter((idle) => idle !== worker);
    if (!this.workers.delete(worker)) return;
    worker.terminate();
    this.drain();
  }

  /** Page shutdown ends pending jobs and frees the warm codec threads. The pool may be used again after a restored page. */
  dispose(): void {
    this.generation++;
    const pending = [...this.queued, ...this.active.values()];
    this.queued = [];
    for (const worker of this.workers) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    this.workers.clear();
    this.active.clear();
    this.idle = [];
    for (const job of pending) job.reject(new Error("Audio decoding stopped because the page closed."));
  }
}
