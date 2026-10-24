import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { ModelProgress, SongHostApi } from "@shared/host/song";
import { invoke } from "./invoke";

export const songApi: SongHostApi = {
  stagePower: (token,enabled) => invoke('song:stagePower',token,enabled),
  library: {
    preflight: ids => invoke('song:library:preflight', ids),
    exportBackup: () => invoke('song:library:exportBackup'),
    restoreBackup: () => invoke('song:library:restoreBackup'),
    onTransferProgress(callback) {
      const listener=(_event:IpcRendererEvent,progress:import('@shared/song-library').LibraryTransferProgress)=>callback(progress);
      ipcRenderer.on('song:library:progress',listener);
      return ()=>{ipcRenderer.removeListener('song:library:progress',listener);};
    },
    index: () => invoke('song:library:index'),
    audio: (id, name) => invoke('song:library:audio', id, name),
    playlists: playlists => invoke('song:library:playlists', playlists),
    settings: (id, values) => invoke('song:library:settings', id, values),
    remove: id => invoke('song:library:remove', id),
    async save(song, assets) {
      const token = await invoke<string>('song:library:begin', song);
      try {
        for (const asset of assets) await invoke('song:library:write', token, asset.name, asset.bytes);
        await invoke('song:library:commit', token);
      } catch (e) { await invoke('song:library:abort', token).catch(() => {}); throw e; }
    },
  },
  downloadedFiles: () => invoke("song:downloadedFiles"),
  downloadModel: (id) => invoke("song:downloadModel", id),
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
