import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { ModelProgress, SongHostApi } from "@shared/host/song";
import { invoke } from "./invoke";

export const songApi: SongHostApi = {
  downloadedFiles: () => invoke("song:downloadedFiles"),
  downloadModel: (id) => invoke("song:downloadModel", id),
  cancelDownload: (id) => invoke("song:cancelDownload", id),
  modelFile: (file) => invoke("song:modelFile", file),
  deleteModel: (id) => invoke("song:deleteModel", id),
  onModelProgress: (cb) => {
    const handler = (_e: IpcRendererEvent, p: ModelProgress) => cb(p);
    ipcRenderer.on("song:modelProgress", handler);
    return () => ipcRenderer.removeListener("song:modelProgress", handler);
  },
  // One IPC message per file: stems of a long song are tens of megabytes each.
  async saveFiles(files, title) {
    const where = await invoke<string | null>("song:pickTarget", files.map((f) => f.name), title);
    if (!where) return null;
    for (const f of files) await invoke("song:writeFile", f.name, f.bytes);
    return where;
  },
};
