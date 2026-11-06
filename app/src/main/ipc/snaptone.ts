import { app, type BrowserWindow, type OpenDialogOptions } from "electron";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readSignalWav } from "@shared/host/snaptone";
import { HostError } from "@shared/ipc";
import { loadSettings } from "./app";
import { handle, showOpenDialog } from "./handle";
import { MAC_SUITE } from "./shell-paths";

// Valeton's test signal for the SnapTone conversion (see src/shared/host/snaptone.ts). A checked copy is kept in
// userData/snaptone; until then it comes from the build (local builds with the git-ignored fixture) or the
// Valeton Suite install.
const SIGNAL_NAME = "nam_input_wav.wav";
const storedPath = () => join(app.getPath("userData"), "snaptone", SIGNAL_NAME);

/** Where Suite keeps the file for a given Suite path (the .exe on Windows, the .app on macOS). */
function inSuite(suitePath: string): string | null {
  if (process.platform === "darwin") return join(suitePath, "Contents/Frameworks/App.framework/Resources/flutter_assets/assets/wavs", SIGNAL_NAME);
  if (process.platform === "win32") return join(dirname(suitePath), "data", "flutter_assets", "assets", "wavs", SIGNAL_NAME);
  return null;
}

/** Check `bytes` is the test signal and keep a copy of `source`. Throws HostError("invalid") when it isn't. */
async function keep(source: string, bytes: Uint8Array): Promise<Uint8Array> {
  try {
    readSignalWav(bytes);
  } catch (e) {
    throw new HostError("invalid", e instanceof Error ? e.message : String(e));
  }
  await mkdir(dirname(storedPath()), { recursive: true });
  await copyFile(source, storedPath());
  return bytes;
}

/** The kept copy, else the build's copy or the file from the Suite install (then kept), else null. */
async function findSignal(): Promise<Uint8Array | null> {
  const stored = await readFile(storedPath()).catch(() => null);
  if (stored) return new Uint8Array(stored);
  const suitePath = (await loadSettings()).valetonSuitePath;
  const suites = [suitePath, process.platform === "darwin" ? MAC_SUITE : null].filter((p): p is string => Boolean(p));
  // This build's copy: electron-builder `extraResources` when packaged, the git-ignored repo fixture in dev.
  const bundled = app.isPackaged ? join(process.resourcesPath, "snaptone", SIGNAL_NAME) : join(app.getAppPath(), "src/renderer/src/snaptone/fixtures", SIGNAL_NAME);
  const candidates = [bundled, ...suites.map(inSuite)].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    const bytes = await readFile(candidate).catch(() => null);
    if (!bytes) continue;
    try {
      return await keep(candidate, new Uint8Array(bytes));
    } catch {
      // Not the file we expect (another Suite version?): the user chooses it instead.
    }
  }
  return null;
}

export function registerSnapToneIpc(getWindow: () => BrowserWindow | null): void {
  handle("snaptone:hasSignal", async () => (await findSignal()) !== null);
  handle("snaptone:signal", () => findSignal());
  handle("snaptone:chooseSignal", async () => {
    const opts: OpenDialogOptions = {
      title: `Choose Valeton's ${SIGNAL_NAME}`,
      properties: ["openFile"],
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    };
    const res = await showOpenDialog(getWindow(), opts);
    const path = res.canceled ? null : res.filePaths[0];
    if (!path) return null;
    return keep(path, new Uint8Array(await readFile(path)));
  });
}
