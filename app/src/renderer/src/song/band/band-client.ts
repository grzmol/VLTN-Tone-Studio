// Runs the band pipeline in a worker, so generating and rendering a song does not block the window (spec 50, commit 5b). The worker is
// kept between jobs, so the decoded samples are decoded once per run of renders, not once per render. Cancelling ends the worker at once,
// which also drops those samples. Starting a job while another runs cancels the other one. Call these only while playback is stopped.

import type { BandRequest, BandResult, BandStage } from "./band-job";
import { monoAverage } from "./level";
import { sampleFileUrls } from "./samples";
import type { PcmAudio } from "../types";

/** What the client sends. With `preview`, the worker renders `bars` bars from `fromTime`; without it, the whole song. */
export interface BandWorkerMessage {
  id: number;
  request: BandRequest;
  preview?: { fromTime: number; bars: number };
}

/** What the worker answers: a stage as it starts, then one result or one error. */
export type BandWorkerReply = { id: number; stage: BandStage } | { id: number; result: BandResult } | { id: number; error: string };

export interface BandJob {
  /** Resolves with the rendered parts, or rejects with an AbortError after `cancel`. */
  done: Promise<BandResult>;
  /** Calls `listener` with each stage the job reaches from now on. */
  onProgress(listener: (stage: BandStage) => void): void;
  cancel(): void;
}

interface Current {
  id: number;
  listeners: ((stage: BandStage) => void)[];
  resolve(result: BandResult): void;
  reject(error: Error): void;
  cancel(): void;
}

let worker: Worker | null = null;
let current: Current | null = null;
let nextId = 1;

/** The bundled sample URLs, made absolute. The worker fetches them, and a relative URL would resolve against the worker's own file. */
export function bandSampleUrls(): Record<string, string> {
  const base = typeof location === "undefined" ? undefined : location.href;
  return Object.fromEntries([...sampleFileUrls()].map(([file, url]) => [file, base ? new URL(url, base).href : url]));
}

function abortError(): Error {
  const error = new Error("Generating the band parts was cancelled.");
  error.name = "AbortError";
  return error;
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

function workerFor(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./band-worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<BandWorkerReply>) => {
    const reply = event.data;
    const job = current;
    if (!job || reply.id !== job.id) return;
    if ("result" in reply) {
      current = null;
      job.resolve(reply.result);
    } else if ("error" in reply) {
      current = null;
      job.reject(new Error(reply.error));
    } else {
      for (const listener of job.listeners) listener(reply.stage);
    }
  };
  created.onerror = () => {
    dropWorker();
    const job = current;
    current = null;
    job?.reject(new Error("Generating the band parts could not finish."));
  };
  worker = created;
  return created;
}

/**
 * The request with its audio summed to mono averages (level kept, see level.ts). Only those mono buffers are sent, and they are
 * transferred rather than copied. The worker scales the follow audio itself, as the beat tracker does.
 */
function withMono(request: BandRequest): { request: BandRequest; transfer: ArrayBuffer[] } {
  const buffers = new Set<ArrayBuffer>();
  const mono = (audio: PcmAudio): PcmAudio => {
    const channel = monoAverage(audio);
    buffers.add(channel.buffer as ArrayBuffer);
    return { sampleRate: audio.sampleRate, channels: [channel] };
  };
  const next: BandRequest = { ...request };
  if (request.mix) next.mix = mono(request.mix);
  if (request.follow) next.follow = { source: request.follow.source, audio: mono(request.follow.audio) };
  if (request.originals) {
    const { drums, bass } = request.originals;
    next.originals = { drums: drums && mono(drums), bass: bass && mono(bass) };
  }
  return { request: next, transfer: [...buffers] };
}

function start(body: Omit<BandWorkerMessage, "id">, transfer: ArrayBuffer[]): BandJob {
  current?.cancel();
  const id = nextId++;
  let resolve!: (result: BandResult) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<BandResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const listeners: ((stage: BandStage) => void)[] = [];
  const job: Current = {
    id,
    listeners,
    resolve,
    reject,
    cancel() {
      if (current !== job) return;
      current = null;
      dropWorker();
      reject(abortError());
    },
  };
  current = job;
  workerFor().postMessage({ id, ...body } satisfies BandWorkerMessage, transfer);
  return {
    done,
    onProgress: (listener) => {
      listeners.push(listener);
    },
    cancel: () => job.cancel(),
  };
}

/** Generates and renders the whole song's drum and bass parts, as the request asks. */
export function startBandRender(request: BandRequest): BandJob {
  const { request: sent, transfer } = withMono(request);
  return start({ request: sent }, transfer);
}

/** Renders `bars` bars of the parts from `fromTime`, for listening. Nothing is saved. */
export function renderPreview(request: BandRequest, fromTime: number, bars = 4): BandJob {
  const { request: sent, transfer } = withMono(request);
  return start({ request: sent, preview: { fromTime, bars } }, transfer);
}
