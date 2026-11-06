import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BandRequest, BandResult } from "./band-job";

/** Stands in for a Worker, so the test can answer, fail or cancel the job by hand. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}

const request = { sampleUrls: { "drums/kick-soft.flac": "https://app.test/kick.flac" } } as unknown as BandRequest;
const result: BandResult = { notes: { drums: [], bass: [] } };

/** The client keeps one worker between jobs, so each test starts from a fresh module. */
async function loadClient() {
  vi.resetModules();
  return import("./band-client");
}

describe("band client", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts the request under a job id, with no preview for a render", async () => {
    const client = await loadClient();
    client.startBandRender(request);
    const worker = FakeWorker.instances[0];
    expect(worker.posted).toEqual([{ id: 1, request }]);
  });

  it("posts the preview's start time and bars", async () => {
    const client = await loadClient();
    client.renderPreview(request, 12, 2);
    expect(FakeWorker.instances[0].posted).toEqual([{ id: 1, request, preview: { fromTime: 12, bars: 2 } }]);
  });

  it("reports each stage to its listeners, then resolves with the result and keeps the worker", async () => {
    const client = await loadClient();
    const job = client.startBandRender(request);
    const stages: string[] = [];
    job.onProgress((stage) => stages.push(stage));
    const worker = FakeWorker.instances[0];
    worker.onmessage!({ data: { id: 1, stage: "generating" } } as MessageEvent);
    worker.onmessage!({ data: { id: 1, stage: "rendering" } } as MessageEvent);
    worker.onmessage!({ data: { id: 1, result } } as MessageEvent);
    await expect(job.done).resolves.toBe(result);
    expect(stages).toEqual(["generating", "rendering"]);
    expect(worker.terminated).toBe(false);
  });

  it("rejects with the worker's error", async () => {
    const client = await loadClient();
    const job = client.startBandRender(request);
    FakeWorker.instances[0].onmessage!({ data: { id: 1, error: "Sample kick is missing." } } as MessageEvent);
    await expect(job.done).rejects.toThrow("Sample kick is missing.");
  });

  it("ignores replies for another job", async () => {
    const client = await loadClient();
    const job = client.startBandRender(request);
    let settled = false;
    job.done.then(() => (settled = true));
    FakeWorker.instances[0].onmessage!({ data: { id: 99, result } } as MessageEvent);
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it("cancels at once: the worker is ended and the job rejects as an abort", async () => {
    const client = await loadClient();
    const job = client.startBandRender(request);
    job.cancel();
    expect(FakeWorker.instances[0].terminated).toBe(true);
    const error = await job.done.then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.name).toBe("AbortError");
  });

  it("a job started while another runs cancels the first", async () => {
    const client = await loadClient();
    const first = client.startBandRender(request);
    const second = client.startBandRender(request);
    await expect(first.done).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].onmessage!({ data: { id: 2, result } } as MessageEvent);
    await expect(second.done).resolves.toBe(result);
  });

  it("rejects when the worker fails to start", async () => {
    const client = await loadClient();
    const job = client.startBandRender(request);
    FakeWorker.instances[0].onerror!();
    await expect(job.done).rejects.toThrow("Generating the band parts could not finish.");
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("gives absolute URLs for the bundled samples", async () => {
    const client = await loadClient();
    const urls = client.bandSampleUrls();
    expect(urls).toHaveProperty("drums/kick-soft.flac");
    expect(urls["drums/kick-soft.flac"]).toMatch(/^https?:\/\//);
  });
});
