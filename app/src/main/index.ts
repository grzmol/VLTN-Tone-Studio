import { app, BrowserWindow, dialog, net, protocol, screen, session } from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildMenu } from "./menu";
import { isJobRunning, queueOpenedFiles, registerAppIpc } from "./ipc/app";
import { registerFilesIpc } from "./ipc/files";
import { registerTonesIpc } from "./ipc/tones";
import { registerCaptureIpc } from "./ipc/capture";
import { registerDeviceIpc } from "./ipc/device";
import { registerSnapToneIpc } from "./ipc/snaptone";
import { registerSongIpc } from "./ipc/song";
import { registerUpdateIpc } from "./ipc/update";
import { registerGp200CatalogIpc } from "./ipc/gp200-catalog";
import { registerLogIpc } from "./ipc/log";
import type { AppEvent } from "@shared/ipc";
import { installBluetoothChooser } from './bluetooth';

// One app instance = one MIDI session (the pedal's port is exclusive on Windows).
if (!app.requestSingleInstanceLock()) app.quit();

// The packaged renderer is served from app://bundle/ instead of file://, so fetch() and
// AudioWorklet.addModule() of bundled assets (NAM engine wasm, worklet, audio clips) work and 'self' is a real origin.
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);
const RENDERER_DIR = resolve(import.meta.dirname, "../renderer");
const RENDERER_URL = "app://bundle/index.html";
// CSP: tone service, pinned OpenMIDI data and Hugging Face model downloads; transcription audio stays local.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://*.tone3000.com https://tone3000.com; connect-src 'self' ws://localhost:* https://*.tone3000.com https://tone3000.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com";
// Dev server only: @vitejs/plugin-react injects an inline React Refresh preamble into index.html.
const DEV_CSP = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
// Cross-origin isolation: the stem splitter's CPU path (onnxruntime-web wasm, song/stems/worker.ts) only gets threads
// with SharedArrayBuffer; without it one 7.8 s chunk takes ~20 s on one core. credentialless (not require-corp) so
// TONE3000 images, which send no Cross-Origin-Resource-Policy, still load (without cookies).
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" } as const;

/** app://bundle/<path> → a file inside the renderer build; nothing outside it is reachable. */
async function serveBundle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.host !== "bundle") return new Response(null, { status: 404 });
  const file = resolve(RENDERER_DIR, "." + decodeURIComponent(url.pathname));
  if (!file.startsWith(RENDERER_DIR + sep)) return new Response(null, { status: 403 });
  const res = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(res.headers);
  // On every response: workers (the separation worker and onnxruntime's thread workers) take their own headers.
  for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value);
  if (file.endsWith(".html")) {
    headers.set("Content-Security-Policy", CSP);
    headers.set("Content-Type", "text/html; charset=utf-8");
  }
  return new Response(res.body, { status: res.status, headers });
}

const ENCLOSURE = "#08080a";
const MIN = { width: 1180, height: 760 };
let win: BrowserWindow | null = null;
const getWindow = () => win;
const boundsPath = () => join(app.getPath("userData"), "window.json");
const OPENABLE = /\.(prst|nam|wav)$/i;
queueOpenedFiles(process.argv.slice(1).filter((a) => OPENABLE.test(a)));

interface SavedBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

/** Last window bounds, if they still fit on a connected display (monitors change between launches). */
async function loadBounds(): Promise<SavedBounds> {
  const fallback = { width: 1440, height: 900 };
  try {
    const b = JSON.parse(await readFile(boundsPath(), "utf8")) as SavedBounds;
    const width = Math.max(MIN.width, b.width | 0);
    const height = Math.max(MIN.height, b.height | 0);
    if (b.x === undefined || b.y === undefined) return { width, height, maximized: b.maximized };
    const area = screen.getDisplayMatching({ x: b.x, y: b.y, width, height }).workArea;
    const visible = b.x < area.x + area.width - 100 && b.x + width > area.x + 100 && b.y >= area.y - 10 && b.y < area.y + area.height - 100;
    return visible ? { x: b.x, y: b.y, width, height, maximized: b.maximized } : { width, height, maximized: b.maximized };
  } catch {
    return fallback;
  }
}

function saveBounds(w: BrowserWindow): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    // Sync: the app may quit right after the window closes.
    writeFileSync(boundsPath(), JSON.stringify({ ...w.getNormalBounds(), maximized: w.isMaximized() } satisfies SavedBounds));
  } catch {
    // bounds are a convenience
  }
}

function sendEvent(event: AppEvent) {
  win?.webContents.send("app:event", event);
}

async function createWindow() {
  const { maximized, ...b } = await loadBounds();
  const isMac = process.platform === "darwin";
  win = new BrowserWindow({
    ...b,
    minWidth: MIN.width,
    minHeight: MIN.height,
    show: false,
    backgroundColor: ENCLOSURE,
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 18 }, vibrancy: "sidebar" as const, visualEffectState: "active" as const }
      : { titleBarOverlay: { color: ENCLOSURE, symbolColor: "#c2c2c2", height: 52 } }),
    ...(process.platform === "win32" ? { backgroundMaterial: "acrylic" as const } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false, // ESM preload needs sandbox: false; nodeIntegration stays off and only the typed bridge is exposed
      nodeIntegration: false,
      backgroundThrottling: false, // backups and writes must not be throttled
    },
  });
  installBluetoothChooser(win);
  win.once("ready-to-show", () => {
    if (maximized) win?.maximize();
    win?.show();
  });
  win.on("close", (e) => {
    if (!win) return;
    // overlays.md › Electron notes: don't drop a backup or write by closing the window by accident.
    if (isJobRunning()) {
      const choice = dialog.showMessageBoxSync(win, {
        type: "warning",
        buttons: ["Keep open", "Close anyway"],
        defaultId: 0,
        cancelId: 0,
        message: "Tone Studio is still writing to or backing up the pedal",
        detail: "Close after it finishes? If you close now, an unfinished write is discarded by the pedal and that slot keeps its old preset.",
      });
      if (choice === 0) return e.preventDefault();
    }
    saveBounds(win);
  });
  win.on("focus", () => sendEvent({ type: "window-focus", focused: true }));
  win.on("blur", () => sendEvent({ type: "window-focus", focused: false }));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadURL(RENDERER_URL);
}

app.on("second-instance", (_e, argv) => {
  const files = argv.slice(1).filter((a) => OPENABLE.test(a));
  if (files.length) sendEvent({ type: "open-files", paths: files });
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on("open-file", (e, path) => {
  e.preventDefault();
  // Before the renderer is up, the path waits for `app.takeOpenedFiles()`.
  if (win && !win.webContents.isLoading()) sendEvent({ type: "open-files", paths: [path] });
  else queueOpenedFiles([path]);
});

app.whenReady().then(async () => {
  // WebMIDI with SysEx in the renderer (src/renderer/src/gp5/), plus audio-only capture for the capture editor's
  // NAM audition (audio interface input). Nothing else is granted; video is always denied.
  const allowed = new Set(["midi", "midiSysex"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === "media") {
      const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      return cb(types.length > 0 && types.every((t) => t === "audio"));
    }
    cb(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    permission === "media" ? details.mediaType === "audio" : allowed.has(permission),
  );
  session.defaultSession.setBluetoothPairingHandler((details, callback) => {
    if (!win || details.frame !== win.webContents.mainFrame) return callback({ confirmed: false });
    if (details.pairingKind === 'providePin') {
      void dialog.showMessageBox(win, { type: 'info', message: 'Pair this MIDI device in Windows Bluetooth settings first', detail: 'The device requests a PIN. Complete PIN entry in system settings, then retry Bluetooth MIDI in Tone Studio.' });
      return callback({ confirmed: false });
    }
    void dialog.showMessageBox(win, {
      type: 'question', title: 'Bluetooth pairing', message: `Pair with ${details.deviceId}?`,
      detail: details.pairingKind === 'confirmPin' ? `Confirm that the device shows PIN ${details.pin}.` : 'Allow this device to connect for MIDI control.',
      buttons: ['Cancel', 'Pair'], defaultId: 0, cancelId: 0,
    }).then(({ response }) => callback({ confirmed: response === 1 })).catch(() => callback({ confirmed: false }));
  });
  protocol.handle("app", serveBundle);
  // Dev: the renderer comes from the electron-vite dev server; give it the same CSP and isolation.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!details.url.startsWith("http://localhost")) return cb({ responseHeaders: details.responseHeaders });
    const isolation = Object.fromEntries(Object.entries(ISOLATION).map(([name, value]) => [name, [value]]));
    cb({ responseHeaders: { ...details.responseHeaders, ...isolation, "Content-Security-Policy": [DEV_CSP] } });
  });

  registerLogIpc(getWindow);
  registerAppIpc(getWindow);
  registerFilesIpc(getWindow);
  registerTonesIpc(getWindow);
  registerCaptureIpc(getWindow);
  registerDeviceIpc(getWindow);
  registerSnapToneIpc(getWindow);
  registerSongIpc(getWindow);
  registerUpdateIpc(getWindow);
  registerGp200CatalogIpc(getWindow);
  buildMenu(getWindow);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
