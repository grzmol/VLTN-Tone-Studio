import type { TonesApi } from "@shared/host/tones";
import { HostError } from "@shared/ipc";

// TONE3000 needs the desktop app: sign-in runs in an embedded view with a redirect only the desktop app can
// intercept, tokens live in the OS keychain, and every API call (lists included) needs the Bearer token.
const desktopOnly = (what: string) => async (): Promise<never> => {
  throw new HostError("unsupported", `${what} needs the desktop app`);
};

export const webTones: TonesApi = {
  account: async () => ({ status: "signed-out", user: null, configured: false, appKey: null, splashSeen: true, insecureStorage: false }),
  markSplashSeen: async () => {},
  beginFlow: desktopOnly("Signing in to TONE3000"),
  setFlowBounds: async () => {},
  cancelFlow: async () => {},
  signOut: async () => {},
  setAppKey: desktopOnly("The TONE3000 app key"),
  list: desktopOnly("TONE3000"),
  search: desktopOnly("TONE3000"),
  tone: desktopOnly("TONE3000"),
  models: desktopOnly("TONE3000"),
  image: async () => null,
  downloadModel: desktopOnly("Downloading from TONE3000"),
  prepareIr: desktopOnly("Downloading from TONE3000"),
  prepareSnapTone: desktopOnly("Downloading from TONE3000"),
  readLocalIr: desktopOnly("Opening files by path"),
  readLocalNam: desktopOnly("Opening files by path"),
  readIr: desktopOnly("Reading downloaded impulse responses"),
  readNam: desktopOnly("Reading downloaded captures"),
  link: desktopOnly("Linking slots to TONE3000 tones"),
  local: async () => [],
  onEvent: () => () => {},
};
