import { webUtils } from "electron";
import type { FilesApi } from "@shared/host/files";
import { invoke } from "./invoke";

export const filesApi: FilesApi = {
  listCollections: () => invoke("files:listCollections"),
  listPresets: (id) => invoke("files:listPresets", id),
  saveBackup: (slots, sourceDevice) => invoke("files:saveBackup", slots, sourceDevice),
  createCollection: (title) => invoke("files:createCollection", title),
  renameCollection: (id, title) => invoke("files:renameCollection", id, title),
  deleteCollection: (id) => invoke("files:deleteCollection", id),
  addPresets: (id, items) => invoke("files:addPresets", id, items),
  removePreset: (id, presetId) => invoke("files:removePreset", id, presetId),
  pickPrstFiles: () => invoke("files:pickPrstFiles"),
  pickPrstFolder: () => invoke("files:pickPrstFolder"),
  readPaths: (paths) => invoke("files:readPaths", paths),
  // Dropped File objects only carry their path in the preload world (webUtils); main reads and checks them.
  readDropped: (files) => invoke("files:readPaths", files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  exportPresets: (items) => invoke("files:exportPresets", items),
  openBackupsFolder: () => invoke("files:openBackupsFolder"),
  revealCollection: (id) => invoke("files:revealCollection", id),
};
