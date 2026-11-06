import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { AudienceHostApi, AudienceStatus } from "@shared/host/audience";
import type { AudienceUpdate } from "@shared/audience";
import { invoke } from "./invoke";

export const audienceApi: AudienceHostApi = {
  status: () => invoke<AudienceStatus>("audience:status"),
  onStatus: (callback) => {
    const handler = (_e: IpcRendererEvent, status: AudienceStatus) => callback(status);
    ipcRenderer.on("audience:status", handler);
    return () => ipcRenderer.removeListener("audience:status", handler);
  },
  open: () => invoke<AudienceStatus>("audience:open"),
  close: () => invoke<AudienceStatus>("audience:close"),
  chooseDisplay: (displayId) => invoke<AudienceStatus>("audience:chooseDisplay", displayId),
  publish: (update: AudienceUpdate) => invoke<void>("audience:publish", update),
};
