import { app, net, type BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  findModel,
  MODEL_CHECKSUM_ERROR,
  MODEL_FILES,
  MODEL_MISSING_ERROR,
  modelFiles,
  UNKNOWN_MODEL_ERROR,
  type ModelFile,
  type ModelProgress,
  type SeparationModel,
} from "@shared/host/song";
import { sanitizeFileName } from "@shared/files-naming";
import { HostError } from "@shared/ipc";
import { handle, sendTo, showOpenDialog, showSaveDialog } from "./handle";
import { downloadPart as downloadPartFile, PROGRESS_EVERY_BYTES } from "./model-download";

// The Song screen's separation models (src/shared/host/song.ts): each file is downloaded on first use into
// userData/models, resumed from a `.part` file after an interrupted download, checked against its pinned SHA-256
// and only then renamed to its final name. Only registry files are touched, never a path from the renderer.
// Saving exported stems: one Save dialog, or a folder for several files.

const modelsDir = () => join(app.getPath("userData"), "models");
const filePath = (f: ModelFile) => join(modelsDir(), f.file);
const partPath = (f: ModelFile) => `${filePath(f)}.part`;

async function fileSize(path: string): Promise<number | null> {
  return stat(path).then((s) => s.size, () => null);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const isDownloaded = async (f: ModelFile) => (await fileSize(filePath(f))) === f.bytes;

function modelOrThrow(id: string): SeparationModel {
  const model = findModel(id);
  if (!model) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
  return model;
}

/** Append the rest of `f` to its `.part`; see model-download.ts for the watchdog and resume. */
const downloadPart = (f: ModelFile, onBytes: (received: number) => void, signal?: AbortSignal) =>
  downloadPartFile(f.url, f.bytes, partPath(f), (url, init) => net.fetch(url, init), onBytes, signal);

async function ensureFile(f: ModelFile, onBytes: (received: number) => void, signal?: AbortSignal): Promise<void> {
  if (await isDownloaded(f)) return;
  await mkdir(modelsDir(), { recursive: true });
  await downloadPart(f, onBytes, signal);
  if ((await fileSize(partPath(f))) !== f.bytes || (await sha256File(partPath(f))) !== f.sha256) {
    await rm(partPath(f), { force: true });
    throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
  }
  await rename(partPath(f), filePath(f));
}

export function registerSongIpc(getWindow: () => BrowserWindow | null): void {
  // One download per file at a time; a second request (retry, another model sharing the file) joins it. A joined
  // download keeps the signal of the request that started it, so cancelling a joiner doesn't stop the file.
  const pending = new Map<string, Promise<void>>();
  // The model downloads running now, by model id: song:cancelDownload aborts one.
  const running = new Map<string, AbortController>();
  const progress = (p: ModelProgress) => sendTo(getWindow, "song:modelProgress", p);

  function fileOnce(f: ModelFile, onBytes: (received: number) => void, signal?: AbortSignal): Promise<void> {
    let job = pending.get(f.file);
    if (!job) {
      job = ensureFile(f, onBytes, signal).finally(() => pending.delete(f.file));
      pending.set(f.file, job);
    }
    return job;
  }

  handle("song:downloadedFiles", async () => {
    const files = [...MODEL_FILES.values()];
    const have = await Promise.all(files.map(isDownloaded));
    return files.filter((_, i) => have[i]).map((f) => f.file);
  });

  handle("song:downloadModel", async (_e, id: string) => {
    const model = modelOrThrow(id);
    const missing: ModelFile[] = [];
    for (const f of modelFiles(model)) if (!(await isDownloaded(f))) missing.push(f);
    const total = missing.reduce((sum, f) => sum + f.bytes, 0);
    const stop = new AbortController();
    running.set(id, stop);
    try {
      let done = 0;
      for (const f of missing) {
        if (stop.signal.aborted) throw new HostError("cancelled", "The download was cancelled.");
        await fileOnce(f, (received) => progress({ received: done + received, total }), stop.signal);
        done += f.bytes;
      }
    } finally {
      if (running.get(id) === stop) running.delete(id);
    }
  });

  // Stops the running download of model `id` (if any). Its finished files stay, and the partial one stays as a .part.
  handle("song:cancelDownload", (_e, id: string) => {
    modelOrThrow(id);
    running.get(id)?.abort();
  });

  handle("song:modelFile", async (_e, name: string) => {
    const f = MODEL_FILES.get(name);
    if (!f) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    if (!(await isDownloaded(f))) throw new HostError("not-found", MODEL_MISSING_ERROR);
    return new Uint8Array(await readFile(filePath(f)));
  });

  handle("song:deleteModel", async (_e, id: string) => {
    const files = modelFiles(modelOrThrow(id));
    // A download in flight would recreate the file; wait for it (or its failure) first.
    await Promise.allSettled(files.map((f) => pending.get(f.file)));
    for (const f of files) {
      await rm(filePath(f), { force: true });
      await rm(partPath(f), { force: true });
    }
  });

  // Saving is two steps so each IPC message carries one file: pick the target, then write the files into it.
  let target: { kind: "file"; path: string } | { kind: "dir"; path: string } | null = null;
  handle("song:pickTarget", async (_e, names: string[], title: string) => {
    const win = getWindow();
    if (names.length === 1) {
      const name = sanitizeFileName(names[0], "Audio");
      const opts = { title, defaultPath: join(app.getPath("music"), name), filters: [{ name: "WAV audio", extensions: ["wav"] }] };
      const res = await showSaveDialog(win, opts);
      target = res.canceled || !res.filePath ? null : { kind: "file", path: res.filePath };
    } else {
      const opts = { title, defaultPath: app.getPath("music"), properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
      const res = await showOpenDialog(win, opts);
      target = res.canceled || !res.filePaths[0] ? null : { kind: "dir", path: res.filePaths[0] };
    }
    return target?.path ?? null;
  });
  handle("song:writeFile", async (_e, name: string, bytes: Uint8Array) => {
    if (!target) throw new HostError("invalid", "Choose where to save first.");
    const path = target.kind === "file" ? target.path : join(target.path, sanitizeFileName(name, "Audio"));
    await writeFile(path, bytes);
  });
}
