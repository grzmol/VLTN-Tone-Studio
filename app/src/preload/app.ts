import { ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { AppApi } from "@shared/host/app";
import type { AppEvent } from "@shared/ipc";
import { invoke } from "./invoke";

export const appApi: AppApi = {
  version: () => invoke("app:version"),
  getSettings: () => invoke("app:getSettings"),
  setSettings: (patch) => invoke("app:setSettings", patch),
  openExternal: (url) => invoke("app:openExternal", url),
  showItemInFolder: (path) => invoke("app:showItemInFolder", path),
  openPath: (path) => invoke("app:openPath", path),
  launchSuite: () => invoke("app:launchSuite"),
  setProgress: (fraction) => invoke("app:setProgress", fraction),
  takeOpenedFiles: () => invoke("app:takeOpenedFiles"),
  pathForFile: (file) => webUtils.getPathForFile(file) || null,
  onEvent: (cb) => {
    const handler = (_e: IpcRendererEvent, event: AppEvent) => cb(event);
    ipcRenderer.on("app:event", handler);
    return () => ipcRenderer.removeListener("app:event", handler);
  },
};
