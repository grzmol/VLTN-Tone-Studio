import type { HostApi } from "@shared/host";
import { webApp } from "./app";
import { webFiles } from "./files";
import { webTones } from "./tones";
import { webCapture } from "./capture";
import { webDevice } from "./device";
import { webSnapTone } from "./snaptone";
import { webSong } from "./song";
import { webUpdate } from "./update";
import { webGp200Catalog } from "./gp200-catalog";
import { webLog } from "./log";
import { webAudience } from "./audience";

export const webHost: HostApi = {
  kind: "web",
  platform: "web",
  app: webApp,
  files: webFiles,
  tones: webTones,
  capture: webCapture,
  device: webDevice,
  snaptone: webSnapTone,
  song: webSong,
  update: webUpdate,
  gp200Catalog: webGp200Catalog,
  log: webLog,
  audience: webAudience,
};
