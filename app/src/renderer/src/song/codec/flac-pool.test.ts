import { expect, it, vi } from "vitest";
import { FlacDecoderPool } from "./flac-pool";

class FakeWorker {
  onmessage = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
}
function fixture() {
  const workers: FakeWorker[] = [];
  const create = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { workers, create, pool: new FlacDecoderPool(create) };
}
function job() {
  let release!: (healthy: boolean) => void;
  const start = vi.fn((_worker: Worker, complete: typeof release) => {
    release = complete;
  });
  return { start, reject: vi.fn(), release: (healthy = true) => release(healthy) };
}

it("keeps two concurrent heaps and reuses them for queued tracks", () => {
  const { pool, workers, create } = fixture();
  const jobs = Array.from({ length: 4 }, job);
  jobs.forEach((item) => pool.run(item));
  expect(create).toHaveBeenCalledTimes(2);
  expect(jobs[2].start).not.toHaveBeenCalled();
  jobs[0].release();
  expect(jobs[2].start.mock.calls[0][0]).toBe(workers[0]);
  jobs[1].release();
  expect(jobs[3].start.mock.calls[0][0]).toBe(workers[1]);
  jobs[2].release();
  jobs[3].release();
  expect(create).toHaveBeenCalledTimes(2);
  pool.dispose();
  workers.forEach((worker) => expect(worker.terminate).toHaveBeenCalledOnce());
});

it("replaces a failed decoder without passing it to the next track", () => {
  const { pool, workers } = fixture();
  const jobs = Array.from({ length: 3 }, job);
  jobs.forEach((item) => pool.run(item));
  jobs[0].release(false);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(jobs[2].start.mock.calls[0][0]).toBe(workers[2]);
  jobs[1].release();
  jobs[2].release();
  workers[1].onerror?.();
  expect(workers[1].terminate).toHaveBeenCalledOnce();
  pool.dispose();
});

it("rejects active and waiting tracks on shutdown and ignores stale completions", () => {
  const { pool, workers } = fixture();
  const jobs = Array.from({ length: 3 }, job);
  jobs.forEach((item) => pool.run(item));
  pool.dispose();
  jobs.forEach((item) => expect(item.reject).toHaveBeenCalledWith(expect.any(Error)));
  jobs[0].release();
  jobs[1].release();
  const next = job();
  pool.run(next);
  expect(next.start.mock.calls[0][0]).toBe(workers[2]);
  next.release();
  pool.dispose();
  workers.forEach((worker) => expect(worker.terminate).toHaveBeenCalledOnce());
});

it("rejects a worker creation failure without consuming a pool slot", () => {
  const { create, pool } = fixture();
  create.mockImplementationOnce(() => {
    throw new Error("worker unavailable");
  });
  const failed = job();
  pool.run(failed);
  expect(failed.reject).toHaveBeenCalledWith(expect.objectContaining({ message: "worker unavailable" }));
  const next = job();
  pool.run(next);
  expect(next.start).toHaveBeenCalledOnce();
  next.release();
  pool.dispose();
});
