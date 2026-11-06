import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { ModelProgress, SongHostApi } from "@shared/host/song";
import { invoke } from "./invoke";

export const songApi: SongHostApi = {
  stagePower: (token,enabled) => invoke('song:stagePower',token,enabled),
  library: {
    preflight: ids => invoke('song:library:preflight', ids),
    exportBackup: () => invoke('song:library:exportBackup'),
    inspectBackup: () => invoke('song:library:inspectBackup'),
    restoreBackup: mode => invoke('song:library:restoreBackup', mode),
    onTransferProgress(callback) {
      const listener=(_event:IpcRendererEvent,progress:import('@shared/song-library').LibraryTransferProgress)=>callback(progress);
      ipcRenderer.on('song:library:progress',listener);
      return ()=>{ipcRenderer.removeListener('song:library:progress',listener);};
    },
    index: () => invoke('song:library:index'),
    v1BackupBytes: () => invoke('song:library:v1BackupBytes'),
    removeV1Backup: () => invoke('song:library:removeV1Backup'),
    audioUrls: id => invoke('song:library:audioUrls', id),
    playlists: playlists => invoke('song:library:playlists', playlists),
    organise: change => invoke('song:library:organise', change),
    updateSettings: (id, patch) => invoke('song:library:updateSettings', id, patch),
    applyTrackSettings: id => invoke('song:library:applyTrackSettings', id),
    remove: id => invoke('song:library:remove', id),
    attachChart: (id, bytes) => invoke('song:library:attachChart', id, bytes),
    removeChart: id => invoke('song:library:removeChart', id),
    saveAnnotations: (id, json) => invoke('song:library:saveAnnotations', id, json),
    chartUrls: id => invoke('song:library:chartUrls', id),
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
  cancelDownload: (id) => invoke("song:cancelDownload", id),
  modelFile: (file) => invoke("song:modelFile", file),
  deleteModel: (id) => invoke("song:deleteModel", id),
  onSystemResume(callback) {
    const listener = () => callback();
    ipcRenderer.on("song:systemResume", listener);
    return () => ipcRenderer.removeListener("song:systemResume", listener);
  },
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
