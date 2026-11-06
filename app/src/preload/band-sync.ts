// The performance window's band sync bridge (spec 44). Start, stop and the settings go through invoke; a follower's transport action
// arrives as an event that the performance screen checks before it runs.
import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { FollowerAction } from "@shared/band-sync";
import type { BandSyncHostApi, BandSyncStatus } from "@shared/host/band-sync";
import { invoke } from "./invoke";

export const bandSyncApi: BandSyncHostApi = {
  status: () => invoke<BandSyncStatus>("band-sync:status"),
  onStatus: (callback) => {
    const handler = (_e: IpcRendererEvent, status: BandSyncStatus) => callback(status);
    ipcRenderer.on("band-sync:status", handler);
    return () => ipcRenderer.removeListener("band-sync:status", handler);
  },
  start: (options) => invoke<BandSyncStatus>("band-sync:start", options),
  stop: () => invoke<BandSyncStatus>("band-sync:stop"),
  newPin: () => invoke<BandSyncStatus>("band-sync:newPin"),
  setAllowControl: (allowControl: boolean) => invoke<BandSyncStatus>("band-sync:setAllowControl", allowControl),
  onControl: (callback) => {
    const handler = (_e: IpcRendererEvent, action: FollowerAction) => callback(action);
    ipcRenderer.on("band-sync:control", handler);
    return () => ipcRenderer.removeListener("band-sync:control", handler);
  },
};
