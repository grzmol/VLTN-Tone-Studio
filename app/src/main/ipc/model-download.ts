import { open, rm, stat } from "node:fs/promises";
import { modelDownloadError } from "@shared/host/song";
import { DOWNLOAD_TIMEOUTS, idleAbort, raceAbort } from "@shared/idle-abort";
import { HostError } from "@shared/ipc";

// Downloads one model file into its `.part` file, resuming from the bytes already there (HTTP Range). The watchdog
// fails a stalled transfer (no response, or no chunk for a while), and `signal` cancels it. Either way the `.part`
// stays, so the next try picks up where this one stopped.

export const PROGRESS_EVERY_BYTES = 1 << 20;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Append the rest of a `bytes`-long file from `url` to `part`. `onBytes` gets the bytes in `part`. */
export async function downloadPart(
  url: string,
  bytes: number,
  part: string,
  fetchFn: Fetch,
  onBytes: (received: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let have = (await stat(part).then((s) => s.size, () => null)) ?? 0;
  if (have > bytes) {
    await rm(part);
    have = 0;
  }
  if (have === bytes) return;
  const watch = idleAbort(DOWNLOAD_TIMEOUTS);
  if (signal?.aborted) watch.cancel();
  else signal?.addEventListener("abort", () => watch.cancel(), { once: true });
  const failed = () => (watch.cancelled() ? new HostError("cancelled", "The download was cancelled.") : new HostError("network", modelDownloadError(null)));
  try {
    if (watch.signal.aborted) throw failed();
    let res: Response;
    try {
      res = await raceAbort(fetchFn(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: watch.signal }), watch.signal);
    } catch {
      throw failed();
    }
    if (res.status !== 200 && res.status !== 206) throw new HostError("network", modelDownloadError(res.status));
    watch.touch();
    // A server that ignores Range sends the whole file again: start over.
    if (res.status === 200) have = 0;
    const file = await open(part, have ? "a" : "w");
    try {
      let received = have;
      let reported = 0;
      onBytes(received);
      const reader = res.body!.getReader();
      for (;;) {
        const chunk = await raceAbort(reader.read(), watch.signal).catch(() => {
          throw failed();
        });
        if (chunk.done) break;
        watch.touch();
        await file.write(chunk.value);
        received += chunk.value.byteLength;
        if (received - reported >= PROGRESS_EVERY_BYTES) {
          reported = received;
          onBytes(received);
        }
      }
      onBytes(received);
    } finally {
      await file.close();
    }
  } finally {
    watch.finish();
  }
}
