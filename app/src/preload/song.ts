import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { ModelProgress, SongHostApi } from "@shared/host/song";
import type { LibraryTransferProgress } from "@shared/song-library";
import { invoke } from "./invoke";

export const songApi: SongHostApi = {
  library: {
    exportBackup: () => invoke("song:library:exportBackup"),
    inspectBackup: () => invoke("song:library:inspectBackup"),
    restoreBackup: (mode) => invoke("song:library:restoreBackup", mode),
    onTransferProgress(callback) {
      const listener = (_event: IpcRendererEvent, progress: LibraryTransferProgress) => callback(progress);
      ipcRenderer.on("song:library:progress", listener);
      return () => {
        ipcRenderer.removeListener("song:library:progress", listener);
      };
    },
    index: () => invoke("song:library:index"),
    v1BackupBytes: () => invoke("song:library:v1BackupBytes"),
    removeV1Backup: () => invoke("song:library:removeV1Backup"),
    audioUrls: (id) => invoke("song:library:audioUrls", id),
    updateSettings: (id, patch) => invoke("song:library:updateSettings", id, patch),
    remove: (id) => invoke("song:library:remove", id),
    // The audio is written file by file under a save session, and the song appears only when the last file is in.
    async save(song, assets) {
      const token = await invoke<string>("song:library:begin", song);
      try {
        for (const asset of assets) await invoke("song:library:write", token, asset.name, asset.bytes);
        await invoke("song:library:commit", token);
      } catch (e) {
        await invoke("song:library:abort", token).catch(() => {});
        throw e;
      }
    },
  },
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
