import {
  findModel,
  MODEL_CHECKSUM_ERROR,
  MODEL_FILES,
  MODEL_MISSING_ERROR,
  modelDownloadError,
  modelFiles,
  sha256Hex,
  UNKNOWN_MODEL_ERROR,
  type ModelFile,
  type ModelProgress,
  type SongHostApi,
} from "@shared/host/song";
import { DOWNLOAD_TIMEOUTS, idleAbort, raceAbort } from "@shared/idle-abort";
import { HostError } from "@shared/ipc";

// Browser build: each model file is cached in Cache Storage under its pinned URL, checked before it is stored.
// A model's files download one after another, so an interrupted download keeps the files already finished
// (Cache Storage can't append to a partial entry). Exported files are downloads.
const CACHE = "vltn-models";
const listeners = new Set<(p: ModelProgress) => void>();
const PROGRESS_EVERY_BYTES = 1 << 20;
const pending = new Map<string, Promise<void>>();
// The model downloads running now, by model id: cancelDownload aborts one.
const running = new Map<string, AbortController>();

const openCache = () => caches.open(CACHE);

/** Download `f`, check it and store it; `onBytes` gets the bytes received so far. A stall or a cancel fails it (see idle-abort.ts). */
async function download(f: ModelFile, onBytes: (received: number) => void, signal?: AbortSignal): Promise<void> {
  const watch = idleAbort(DOWNLOAD_TIMEOUTS);
  if (signal?.aborted) watch.cancel();
  else signal?.addEventListener("abort", () => watch.cancel(), { once: true });
  const failed = () => (watch.cancelled() ? new HostError("cancelled", "The download was cancelled.") : new HostError("network", modelDownloadError(null)));
  try {
    let res: Response;
    try {
      res = await raceAbort(fetch(f.url, { signal: watch.signal }), watch.signal);
    } catch {
      throw failed();
    }
    if (!res.ok || !res.body) throw new HostError("network", modelDownloadError(res.status));
    watch.touch();
    const bytes = new Uint8Array(f.bytes);
    let received = 0;
    let reported = 0;
    const reader = res.body.getReader();
    onBytes(0);
    for (;;) {
      const chunk = await raceAbort(reader.read(), watch.signal).catch(() => {
        throw failed();
      });
      if (chunk.done) break;
      watch.touch();
      if (received + chunk.value.byteLength > f.bytes) throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
      bytes.set(chunk.value, received);
      received += chunk.value.byteLength;
      if (received - reported >= PROGRESS_EVERY_BYTES) {
        reported = received;
        onBytes(received);
      }
    }
    onBytes(received);
    if (received !== f.bytes || (await sha256Hex(bytes)) !== f.sha256) throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
    await (await openCache()).put(f.url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  } finally {
    watch.finish();
  }
}

/** One download per file at a time; a second request joins it (and the cancel of the request that started it). */
function downloadOnce(f: ModelFile, onBytes: (received: number) => void, signal?: AbortSignal): Promise<void> {
  let job = pending.get(f.file);
  if (!job) {
    job = download(f, onBytes, signal).finally(() => pending.delete(f.file));
    pending.set(f.file, job);
  }
  return job;
}

function downloadFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const webSong: SongHostApi = {
  async downloadedFiles() {
    const cache = await openCache();
    const files = [...MODEL_FILES.values()];
    const have = await Promise.all(files.map(async (f) => (await cache.match(f.url)) !== undefined));
    return files.filter((_, i) => have[i]).map((f) => f.file);
  },
  async downloadModel(id) {
    const model = findModel(id);
    if (!model) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    const cache = await openCache();
    const missing: ModelFile[] = [];
    for (const f of modelFiles(model)) if (!(await cache.match(f.url))) missing.push(f);
    const total = missing.reduce((sum, f) => sum + f.bytes, 0);
    const stop = new AbortController();
    running.set(id, stop);
    try {
      let done = 0;
      for (const f of missing) {
        if (stop.signal.aborted) throw new HostError("cancelled", "The download was cancelled.");
        await downloadOnce(f, (received) => listeners.forEach((cb) => cb({ received: done + received, total })), stop.signal);
        done += f.bytes;
      }
    } finally {
      if (running.get(id) === stop) running.delete(id);
    }
  },
  async cancelDownload(id) {
    if (!findModel(id)) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    running.get(id)?.abort();
  },
  async modelFile(name) {
    const f = MODEL_FILES.get(name);
    if (!f) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    const res = await (await openCache()).match(f.url);
    const bytes = res ? new Uint8Array(await res.arrayBuffer()) : null;
    if (!bytes || bytes.byteLength !== f.bytes) throw new HostError("not-found", MODEL_MISSING_ERROR);
    return bytes;
  },
  async deleteModel(id) {
    const model = findModel(id);
    if (!model) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    const files = modelFiles(model);
    await Promise.allSettled(files.map((f) => pending.get(f.file)));
    const cache = await openCache();
    for (const f of files) await cache.delete(f.url);
  },
  onModelProgress(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async saveFiles(files) {
    files.forEach((f) => downloadFile(f.name, f.bytes));
    return files.length === 1 ? files[0].name : `${files.length} files`;
  },
};
