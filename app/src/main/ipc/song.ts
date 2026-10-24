import { app, net, powerSaveBlocker, type BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  findModel,
  MODEL_CHECKSUM_ERROR,
  MODEL_FILES,
  MODEL_MISSING_ERROR,
  modelDownloadError,
  modelFiles,
  UNKNOWN_MODEL_ERROR,
  type ModelFile,
  type ModelProgress,
  type SeparationModel,
} from "@shared/host/song";
import { sanitizeFileName } from "@shared/files-naming";
import { HostError } from "@shared/ipc";
import { handle, showOpenDialog, showSaveDialog } from "./handle";
import { songSaveFilters } from './song-save-options';
import { StagePower } from './stage-power';
import { SongLibraryStore } from './song-library-store';
import type { LibrarySong, Playlist } from '@shared/song-library';

// The Song screen's separation models (src/shared/host/song.ts): each file is downloaded on first use into
// userData/models, resumed from a `.part` file after an interrupted download, checked against its pinned SHA-256
// and only then renamed to its final name. Only registry files are touched, never a path from the renderer.
// Saving exported stems: one Save dialog, or a folder for several files.

const modelsDir = () => join(app.getPath("userData"), "models");
const filePath = (f: ModelFile) => join(modelsDir(), f.file);
const partPath = (f: ModelFile) => `${filePath(f)}.part`;
const PROGRESS_EVERY_BYTES = 1 << 20;

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

/** Append the rest of `f` to its `.part` (HTTP Range when part of it is there already); `onBytes` gets the bytes in `.part`. */
async function downloadPart(f: ModelFile, onBytes: (received: number) => void): Promise<void> {
  let have = (await fileSize(partPath(f))) ?? 0;
  if (have > f.bytes) {
    await rm(partPath(f));
    have = 0;
  }
  if (have === f.bytes) return;
  let res: Response;
  try {
    res = await net.fetch(f.url, { headers: have ? { Range: `bytes=${have}-` } : {} });
  } catch {
    throw new HostError("network", modelDownloadError(null));
  }
  if (res.status !== 200 && res.status !== 206) throw new HostError("network", modelDownloadError(res.status));
  // A server that ignores Range sends the whole file again: start over.
  if (res.status === 200) have = 0;
  const file = await open(partPath(f), have ? "a" : "w");
  try {
    let received = have;
    let reported = 0;
    onBytes(received);
    const reader = res.body!.getReader();
    for (;;) {
      const chunk = await reader.read().catch(() => {
        throw new HostError("network", modelDownloadError(null));
      });
      if (chunk.done) break;
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
}

async function ensureFile(f: ModelFile, onBytes: (received: number) => void): Promise<void> {
  if (await isDownloaded(f)) return;
  await mkdir(modelsDir(), { recursive: true });
  await downloadPart(f, onBytes);
  if ((await fileSize(partPath(f))) !== f.bytes || (await sha256File(partPath(f))) !== f.sha256) {
    await rm(partPath(f), { force: true });
    throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
  }
  await rename(partPath(f), filePath(f));
}

export function registerSongIpc(getWindow: () => BrowserWindow | null): void {
  const stagePower=new StagePower(powerSaveBlocker), watched=new Set<number>();
  handle('song:stagePower',(event,token:string,enabled:boolean)=>{
    const owner=event.sender.id;
    if(!watched.has(owner)){
      watched.add(owner);
      event.sender.once('destroyed',()=>{stagePower.release(owner);watched.delete(owner);});
      event.sender.on('render-process-gone',()=>stagePower.release(owner));
    }
    stagePower.update(owner,token,enabled);
  });
  app.once('will-quit',()=>stagePower.close());
  const library = new SongLibraryStore(join(app.getPath('userData'), 'song-library'));
  handle('song:library:preflight', (_e, ids: string[]) => library.preflight(ids));
  handle('song:library:index', () => library.index());
  handle('song:library:begin', (_e, song: LibrarySong) => library.begin(song));
  handle('song:library:write', (_e, token: string, name: string, bytes: Uint8Array) => library.write(token, name, bytes));
  handle('song:library:commit', (_e, token: string) => library.commit(token));
  handle('song:library:abort', (_e, token: string) => library.abort(token));
  handle('song:library:audio', (_e, id: string, name: string) => library.audio(id, name));
  handle('song:library:playlists', (_e, playlists: Playlist[]) => library.playlists(playlists));
  handle('song:library:settings', (_e, id: string, values: Record<string, string>) => library.settings(id, values));
  handle('song:library:remove', (_e, id: string) => library.remove(id));
  const transferProgress=(value: import('../../shared/song-library').LibraryTransferProgress)=>getWindow()?.webContents.send('song:library:progress',value);
  handle('song:library:exportBackup', async()=>{
    const selection=await showSaveDialog(getWindow(),{title:'Export portable song library',defaultPath:join(app.getPath('documents'),'Tone-Studio-library-'+new Date().toISOString().slice(0,10)+'.tar.gz'),filters:[{name:'Portable song library',extensions:['tar.gz']}]});
    if(selection.canceled || !selection.filePath)return null;
    const result=await library.exportBackup(selection.filePath,transferProgress);
    return {...result,fileName:basename(selection.filePath)};
  });
  handle('song:library:restoreBackup', async()=>{
    const selection=await showOpenDialog(getWindow(),{title:'Restore song library as new copies',properties:['openFile'],filters:[{name:'Portable song library',extensions:['gz','tgz']}]});
    if(selection.canceled || !selection.filePaths[0])return null;
    const path=selection.filePaths[0],result=await library.restoreBackup(path,transferProgress);
    return {...result,fileName:basename(path)};
  });
  // One download per file at a time; a second request (retry, another model sharing the file) joins it.
  const pending = new Map<string, Promise<void>>();
  const progress = (p: ModelProgress) => getWindow()?.webContents.send("song:modelProgress", p);

  function fileOnce(f: ModelFile, onBytes: (received: number) => void): Promise<void> {
    let job = pending.get(f.file);
    if (!job) {
      job = ensureFile(f, onBytes).finally(() => pending.delete(f.file));
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
    let done = 0;
    for (const f of missing) {
      await fileOnce(f, (received) => progress({ received: done + received, total }));
      done += f.bytes;
    }
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
