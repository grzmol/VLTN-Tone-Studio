import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";
import { modelDownloadError } from "@shared/host/song";
import { raceAbort, type IdleAbort } from "@shared/idle-abort";
import { HostError } from "@shared/ipc";

/**
 * Stream a response body to `path` (via a .part file) reporting bytes received. Returns the byte count.
 * `watch` is the download's watchdog: every chunk restarts its idle timer, and a stall or a cancel fails the download
 * (the .part file is removed, since a TONE3000 download doesn't resume).
 */
export async function streamToFile(
  res: Response,
  path: string,
  onProgress: (received: number, total: number | null) => void,
  watch: IdleAbort,
): Promise<number> {
  if (!res.body) throw new Error("Empty download");
  const total = Number(res.headers.get("content-length")) || null;
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  const out = createWriteStream(part);
  const reader = res.body.getReader();
  let received = 0;
  let lastReport = 0;
  watch.touch();
  const failed = () => (watch.cancelled() ? new HostError("cancelled", "The download was cancelled.") : new HostError("network", modelDownloadError(null)));
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), watch.signal).catch(() => {
        throw failed();
      });
      if (done) break;
      watch.touch();
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      const now = Date.now();
      if (now - lastReport > 100) {
        lastReport = now;
        onProgress(received, total);
      }
    }
    out.end();
    await finished(out);
    await rename(part, path);
    onProgress(received, total);
    return received;
  } catch (e) {
    out.destroy();
    await rm(part, { force: true });
    throw e;
  }
}
