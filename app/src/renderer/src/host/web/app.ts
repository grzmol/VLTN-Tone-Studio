import { DEFAULT_SETTINGS, type AppApi, type AppSettings } from "@shared/host/app";
import { HostError } from "@shared/ipc";

const KEY = "gp5.settings";
const read = (): AppSettings => ({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") });

export const webApp: AppApi = {
  version: async () => "web",
  getSettings: async () => read(),
  setSettings: async (patch) => {
    const next = { ...read(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  },
  openExternal: async (url) => {
    if (!/^https?:\/\//i.test(url)) throw new HostError("invalid", "Only http(s) links can be opened");
    window.open(url, "_blank", "noopener");
  },
  showItemInFolder: async () => {
    throw new HostError("unsupported", "Showing files in a folder needs the desktop app");
  },
  openPath: async () => {
    throw new HostError("unsupported", "Opening files needs the desktop app");
  },
  launchSuite: async () => {
    throw new HostError("unsupported", "Opening Valeton Suite needs the desktop app");
  },
  setProgress: async () => {},
  takeOpenedFiles: async () => [],
  pathForFile: () => null,
  onEvent: () => () => {},
};
