import { app, net, powerMonitor, powerSaveBlocker, shell, type BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
import { songSaveFilters } from './song-save-options';
import { StagePower } from './stage-power';
import { SongLibraryStore } from './song-library-store';
import { createTrash } from './trash';
import type { LibraryChange, LibrarySong, LibraryTransferProgress, Playlist, RestoreMode } from '@shared/song-library';

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

/** Where saved songs live. `main/index.ts` serves files below it through the `app://library` protocol. */
export const libraryRoot = () => join(app.getPath('userData'), 'song-library');

export function registerSongIpc(getWindow: () => BrowserWindow | null): void {
  const stagePower = new StagePower(powerSaveBlocker);
  const watched = new Set<number>();
  handle('song:stagePower', (event, token: string, enabled: boolean) => {
    const owner = event.sender.id;
    if (!watched.has(owner)) {
      watched.add(owner);
      event.sender.once('destroyed', () => {
        stagePower.release(owner);
        watched.delete(owner);
      });
      event.sender.on('render-process-gone', () => stagePower.release(owner));
    }
    stagePower.update(owner, token, enabled);
  });
  app.once('will-quit', () => stagePower.close());
  // After sleep the USB MIDI ports are re-enumerated. The renderer asks the browser for them again rather than trusting the old ones.
  powerMonitor.on('resume', () => sendTo(getWindow, 'song:systemResume'));
  // Deleted songs and PDFs go to the OS Trash; the library's own .trash folder only when the OS refuses.
  const library = new SongLibraryStore(libraryRoot(), Date.now, createTrash(libraryRoot(), (path) => shell.trashItem(path)));
  handle('song:library:preflight', (_e, ids: string[]) => library.preflight(ids));
  handle('song:library:index', () => library.index());
  handle('song:library:v1BackupBytes', () => library.v1BackupBytes());
  handle('song:library:removeV1Backup', () => library.removeV1Backup());
  handle('song:library:begin', (_e, song: LibrarySong) => library.begin(song));
  handle('song:library:write', (_e, token: string, name: string, bytes: Uint8Array) => library.write(token, name, bytes));
  handle('song:library:commit', (_e, token: string) => library.commit(token));
  handle('song:library:abort', (_e, token: string) => library.abort(token));
  handle('song:library:audioUrls', (_e, id: string) => library.audioUrls(id));
  handle('song:library:playlists', (_e, playlists: Playlist[]) => library.playlists(playlists));
  handle('song:library:organise', (_e, change: LibraryChange) => library.organise(change));
  handle('song:library:updateSettings', (_e, id: string, patch: Record<string, string>) => library.updateSettings(id, patch));
  handle('song:library:applyTrackSettings', (_e, id: string) => library.applyTrackSettings(id));
  handle('song:library:remove', (_e, id: string) => library.remove(id));
  handle('song:library:attachChart', (_e, id: string, bytes: Uint8Array) => library.attachChart(id, bytes));
  handle('song:library:removeChart', (_e, id: string) => library.removeChart(id));
  handle('song:library:saveAnnotations', (_e, id: string, json: string) => library.saveAnnotations(id, json));
  handle('song:library:chartUrls', (_e, id: string) => library.chartUrls(id));
  const transferProgress = (value: LibraryTransferProgress) => sendTo(getWindow, 'song:library:progress', value);
  handle('song:library:exportBackup', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const selection = await showSaveDialog(getWindow(), {
      title: 'Export portable song library',
      defaultPath: join(app.getPath('documents'), 'Tone-Studio-library-' + stamp + '.tar.gz'),
      filters: [{ name: 'Portable song library', extensions: ['tar.gz'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    const result = await library.exportBackup(selection.filePath, transferProgress);
    return { ...result, fileName: basename(selection.filePath) };
  });
  // The renderer never names a path: the backup it inspected is the one it restores.
  let chosenBackup: string | null = null;
  handle('song:library:inspectBackup', async () => {
    const selection = await showOpenDialog(getWindow(), {
      title: 'Restore song library',
      properties: ['openFile'],
      filters: [{ name: 'Portable song library', extensions: ['gz', 'tgz'] }],
    });
    chosenBackup = null;
    if (selection.canceled || !selection.filePaths[0]) return null;
    const path = selection.filePaths[0];
    const preview = await library.inspectBackup(path);
    chosenBackup = path;
    return { ...preview, fileName: basename(path) };
  });
  handle('song:library:restoreBackup', async (_e, mode: RestoreMode) => {
    if (!chosenBackup) throw new HostError('invalid', 'Choose a backup to restore first.');
    if (mode !== 'skip' && mode !== 'copy') throw new HostError('invalid', 'Unknown restore mode.');
    const path = chosenBackup;
    chosenBackup = null;
    const result = await library.restoreBackup(path, transferProgress, mode);
    return { ...result, fileName: basename(path) };
  });
  library.startSweeping();
  app.once('will-quit', () => library.stopSweeping());
  // Songs saved by an earlier version are converted to FLAC in the background; the song list shows them as soon as they have finished.
  void library.migrate(transferProgress).catch((e) => console.error('Song library conversion failed', e));
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
      const opts = { title, defaultPath: join(app.getPath("music"), name), filters: songSaveFilters(name) };
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
