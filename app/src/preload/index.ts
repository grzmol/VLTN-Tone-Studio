import { contextBridge } from "electron";
import type { HostApi } from "@shared/host";
import { appApi } from "./app";
import { filesApi } from "./files";
import { tonesApi } from "./tones";
import { captureApi } from "./capture";
import { deviceApi } from "./device";
import { snapToneApi } from "./snaptone";
import { songApi } from "./song";
import { updateApi } from "./update";
import { gp200CatalogApi } from "./gp200-catalog";
import { logApi } from "./log";
import { audienceApi } from "./audience";
import { bandSyncApi } from "./band-sync";

const host: HostApi = {
  kind: "electron",
  platform: process.platform as HostApi["platform"],
  app: appApi,
  files: filesApi,
  tones: tonesApi,
  capture: captureApi,
  device: deviceApi,
  snaptone: snapToneApi,
  song: songApi,
  update: updateApi,
  gp200Catalog: gp200CatalogApi,
  log: logApi,
  audience: audienceApi,
  bandSync: bandSyncApi,
};

contextBridge.exposeInMainWorld("gp5host", host);
