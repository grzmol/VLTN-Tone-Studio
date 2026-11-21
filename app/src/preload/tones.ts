import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { TonesApi, TonesEvent } from "@shared/host/tones";
import { invoke } from "./invoke";

export const tonesApi: TonesApi = {
  account: () => invoke("tones:account"),
  markSplashSeen: () => invoke("tones:markSplashSeen"),
  beginFlow: (req, bounds) => invoke("tones:beginFlow", req, bounds),
  setFlowBounds: (bounds) => invoke("tones:setFlowBounds", bounds),
  cancelFlow: () => invoke("tones:cancelFlow"),
  signOut: () => invoke("tones:signOut"),
  setAppKey: (appKey) => invoke("tones:setAppKey", appKey),
  list: (kind, page, refresh) => invoke("tones:list", kind, page, refresh),
  search: (params, page, refresh) => invoke("tones:search", params, page, refresh),
  tone: (id) => invoke("tones:tone", id),
  models: (toneId) => invoke("tones:models", toneId),
  image: (url) => invoke("tones:image", url),
  downloadModel: (toneId, modelId) => invoke("tones:downloadModel", toneId, modelId),
  prepareIr: (req) => invoke("tones:prepareIr", req),
  prepareSnapTone: (req) => invoke("tones:prepareSnapTone", req),
  readLocalIr: (path) => invoke("tones:readLocalIr", path),
  readLocalNam: (path) => invoke("tones:readLocalNam", path),
  chooseLocalFile: (kind) => invoke("tones:chooseLocalFile", kind),
  readIr: (toneId) => invoke("tones:readIr", toneId),
  readNam: (toneId, modelId) => invoke("tones:readNam", toneId, modelId),
  link: (toneId, link) => invoke("tones:link", toneId, link),
  local: () => invoke("tones:local"),
  onEvent: (cb) => {
    const handler = (_e: IpcRendererEvent, event: TonesEvent) => cb(event);
    ipcRenderer.on("tones:event", handler);
    return () => ipcRenderer.removeListener("tones:event", handler);
  },
};
