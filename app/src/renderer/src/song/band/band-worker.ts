import { decodeFlac } from "@shared/flac";
import { runBandJob, runBandPreview, transferables } from "./band-job";
import type { BandWorkerMessage, BandWorkerReply } from "./band-client";
import { kitFor } from "./arrangement";
import { loadSampleSetWith, type SampleSet } from "./samples";

// The decoded samples live as long as this worker. The client keeps one worker across jobs, so a second render does not decode them again.
// The worker decodes with decodeFlac directly: it is already off the window's thread, so it does not need another worker for each file.
// Only the kit a request names is decoded, and each kit is kept once it has been.
const samples = new Map<string, Promise<SampleSet>>();

function loadSamples(urls: Record<string, string>, kit: string): Promise<SampleSet> {
  let set = samples.get(kit);
  if (!set) {
    set = loadSampleSetWith(new Map(Object.entries(urls)), async (file) => decodeFlac(new Uint8Array(file)), kit).catch((error: unknown) => {
      samples.delete(kit);
      throw error;
    });
    samples.set(kit, set);
  }
  return set;
}

function post(reply: BandWorkerReply, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(reply, transfer);
}

async function run({ id, request, preview }: BandWorkerMessage): Promise<void> {
  const stage = (name: "loading" | "generating" | "rendering") => post({ id, stage: name });
  try {
    stage("loading");
    const set = await loadSamples(request.sampleUrls, kitFor(request.settings));
    const result = preview ? runBandPreview(request, set, preview.fromTime, preview.bars, stage) : runBandJob(request, set, stage);
    post({ id, result }, transferables(result));
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<BandWorkerMessage>) => {
  void run(event.data);
};
