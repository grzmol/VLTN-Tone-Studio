import { decodeFlac } from "@shared/flac";
import { runBandJob, runBandPreview, transferables } from "./band-job";
import type { BandWorkerMessage, BandWorkerReply } from "./band-client";
import { loadSampleSetWith, type SampleSet } from "./samples";

// The decoded samples live as long as this worker. The client keeps one worker across jobs, so a second render does not decode them again.
// The worker decodes with decodeFlac directly: it is already off the window's thread, so it does not need another worker for each file.
let samples: Promise<SampleSet> | null = null;

function loadSamples(urls: Record<string, string>): Promise<SampleSet> {
  samples ??= loadSampleSetWith(new Map(Object.entries(urls)), async (file) => decodeFlac(new Uint8Array(file))).catch((error: unknown) => {
    samples = null;
    throw error;
  });
  return samples;
}

function post(reply: BandWorkerReply, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(reply, transfer);
}

async function run({ id, request, preview }: BandWorkerMessage): Promise<void> {
  const stage = (name: "loading" | "generating" | "rendering") => post({ id, stage: name });
  try {
    stage("loading");
    const set = await loadSamples(request.sampleUrls);
    const result = preview ? runBandPreview(request, set, preview.fromTime, preview.bars, stage) : runBandJob(request, set, stage);
    post({ id, result }, transferables(result));
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<BandWorkerMessage>) => {
  void run(event.data);
};
