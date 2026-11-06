import { app, BrowserWindow, screen, type IpcMainInvokeEvent } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeAudienceState, parseAudienceUpdate, type AudienceState, type AudienceUpdate } from "@shared/audience";
import type { AudienceDisplayInfo, AudienceStatus } from "@shared/host/audience";
import { HostError } from "@shared/ipc";
import { handle, sendTo } from "./handle";
import { writeJsonAtomicSync } from "./fs-atomic";

// The audience display (spec 43). A second window loads the same renderer bundle with `?view=audience`. It has no Node access, a
// sandboxed preload that only reads the state it is sent, and the same Content-Security-Policy as the main window (main/index.ts serves
// it). Playback never depends on it: closing it, or unplugging its display, changes only the audience window.

/** The window's size when it is shown as a window rather than on a display. */
const WINDOW_SIZE = { width: 1280, height: 720 };
const AUDIENCE_FILE = "audience.json";

export type AudienceMode = "display" | "window";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The part of an Electron display that the audience window needs. */
export interface DisplayLike {
  id: number;
  bounds: Rect;
  workArea: Rect;
}

/** What the controller can ask of the window it has open. Kept small so the controller can be tested without Electron. */
export interface AudienceWindowHandle {
  send(state: AudienceState): void;
  setBounds(bounds: Rect): void;
  destroy(): void;
}
export interface AudienceWindowHooks {
  /** The page has loaded: it needs the latest state. */
  onLoaded(): void;
  /** The window was closed by the performer or the system. */
  onClosed(): void;
  onError(message: string): void;
}

export interface AudienceDeps {
  displays(): DisplayLike[];
  primary(): DisplayLike;
  createWindow(mode: AudienceMode, bounds: Rect, hooks: AudienceWindowHooks): AudienceWindowHandle;
  loadDisplayId(): number | null;
  saveDisplayId(displayId: number | null): void;
  onStatus(status: AudienceStatus): void;
}

interface OpenWindow {
  mode: AudienceMode;
  displayId: number | null;
  handle: AudienceWindowHandle;
}

/**
 * Places the audience window on the display the performer chose, and remembers that choice. When that display is not connected, the
 * window is shown on the main screen instead and moves back to the display when it returns. A display that is unplugged mid-show
 * never takes the performance window with it.
 */
export class AudienceController {
  private displayId: number | null;
  private win: OpenWindow | null = null;
  private state: AudienceState = { model: null, clock: null };
  private error = "";

  constructor(private deps: AudienceDeps) {
    this.displayId = deps.loadDisplayId();
  }

  status(): AudienceStatus {
    const primaryId = this.deps.primary().id;
    const displays: AudienceDisplayInfo[] = this.deps.displays().map((display, index) => ({
      id: display.id,
      label: `Display ${index + 1}`,
      primary: display.id === primaryId,
      width: display.bounds.width,
      height: display.bounds.height,
    }));
    const chosen = displays.find((display) => display.id === this.displayId);
    const shownOn = displays.find((display) => display.id === this.win?.displayId);
    let message: string;
    if (this.error) message = this.error;
    else if (this.win?.mode === "display") message = `Showing on ${shownOn?.label ?? "a display"}.`;
    else if (this.win) message = this.displayId !== null && !chosen ? "The chosen display is not connected. Showing in a window." : "Showing in a window.";
    else if (this.displayId === null) message = "Audience display is off.";
    else if (chosen) message = `Audience display is off. ${chosen.label} is ready.`;
    else message = "Audience display is off. The chosen display is not connected.";
    return {
      windowing: "display",
      open: !!this.win,
      mode: this.win?.mode ?? null,
      displayId: this.displayId,
      displays,
      message,
    };
  }

  /** Opens the window, or moves it to where it belongs now. Opening a window that is open does nothing else. */
  open(): AudienceStatus {
    this.error = "";
    this.place();
    return this.emit();
  }

  close(): AudienceStatus {
    this.destroyWindow();
    return this.emit();
  }

  /** Remembers a display (null for a window). An open audience window moves to it. */
  choose(displayId: number | null): AudienceStatus {
    this.displayId = displayId;
    this.deps.saveDisplayId(displayId);
    if (this.win) this.place();
    return this.emit();
  }

  /** Keeps the latest state, and sends the update on to the window when it is open. */
  publish(update: AudienceUpdate): void {
    this.state = mergeAudienceState(this.state, update);
    this.win?.handle.send(update);
  }

  /** A display was plugged, unplugged or changed its size or arrangement. */
  displaysChanged(): AudienceStatus | null {
    if (!this.win) return null;
    const target = this.targetDisplay();
    if (!target) {
      if (this.win.mode === "display") this.replace("window", this.windowBounds(), null);
    } else if (this.win.mode === "display") {
      this.win.handle.setBounds(target.bounds);
    } else {
      this.replace("display", target.bounds, target.id);
    }
    return this.emit();
  }

  dispose(): void {
    this.destroyWindow();
  }

  private targetDisplay(): DisplayLike | undefined {
    if (this.displayId === null) return undefined;
    return this.deps.displays().find((display) => display.id === this.displayId);
  }

  private windowBounds(): Rect {
    const area = this.deps.primary().workArea;
    const width = Math.min(WINDOW_SIZE.width, area.width);
    const height = Math.min(WINDOW_SIZE.height, area.height);
    return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
  }

  private place(): void {
    const target = this.targetDisplay();
    if (target) {
      if (this.win?.mode === "display" && this.win.displayId === target.id) this.win.handle.setBounds(target.bounds);
      else this.replace("display", target.bounds, target.id);
    } else if (this.win?.mode !== "window") {
      this.replace("window", this.windowBounds(), null);
    }
  }

  /** Closes the window (if any) and opens a new one: a window's frame cannot change once it exists. */
  private replace(mode: AudienceMode, bounds: Rect, displayId: number | null): void {
    this.destroyWindow();
    const entry: OpenWindow = { mode, displayId, handle: undefined as unknown as AudienceWindowHandle };
    // The hooks look the entry up by identity, so a window that was replaced cannot change the state of the one that replaced it.
    entry.handle = this.deps.createWindow(mode, bounds, {
      onLoaded: () => {
        if (this.win === entry && (this.state.model || this.state.clock)) entry.handle.send(this.state);
      },
      onClosed: () => {
        if (this.win !== entry) return;
        this.win = null;
        this.emit();
      },
      onError: (message) => {
        if (this.win !== entry) return;
        this.error = message;
        this.destroyWindow();
        this.emit();
      },
    });
    this.win = entry;
  }

  private destroyWindow(): void {
    const entry = this.win;
    this.win = null;
    try {
      entry?.handle.destroy();
    } catch {
      // The window is already gone, which is what was wanted.
    }
  }

  private emit(): AudienceStatus {
    const status = this.status();
    this.deps.onStatus(status);
    return status;
  }
}

/** A display id from the renderer: null for a window, or a non-negative whole number. Anything else is refused. */
export function parseDisplayId(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new HostError("invalid", "Choose a display from the list.");
  return value;
}

/** The display remembered in userData. A file that is missing or damaged means no display is remembered. */
export function readDisplayId(path: string): number | null {
  try {
    const value = (JSON.parse(readFileSync(path, "utf8")) as { displayId?: unknown }).displayId;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeDisplayId(path: string, displayId: number | null): void {
  try {
    writeJsonAtomicSync(path, { displayId });
  } catch {
    // The choice still holds for this run; only remembering it across runs failed.
  }
}

const publishListeners = new Set<(update: AudienceUpdate) => void>();

/**
 * Calls `listener` with every checked audience update, whether or not the audience window is open. Band sync (spec 44) uses this to
 * send the same model and clock to its followers. Returns the function that stops the listening.
 */
export function onAudiencePublish(listener: (update: AudienceUpdate) => void): () => void {
  publishListeners.add(listener);
  return () => {
    publishListeners.delete(listener);
  };
}

/** The id of the audience window's page, so the app can refuse it permissions and never treat it as the performance window. */
let audienceContents: number | null = null;

/** True for the audience window's web contents. The app's permission handlers refuse everything to it. */
export function isAudienceContents(contents: { id: number } | null | undefined): boolean {
  return !!contents && contents.id === audienceContents;
}

/** The address the audience window loads: the dev server in development, the packaged bundle otherwise. */
function audienceUrl(): string {
  const url = new URL(process.env.ELECTRON_RENDERER_URL ?? "app://bundle/index.html");
  url.searchParams.set("view", "audience");
  return url.toString();
}

function createAudienceWindow(mode: AudienceMode, bounds: Rect, hooks: AudienceWindowHooks): AudienceWindowHandle {
  const window = new BrowserWindow({
    ...bounds,
    // On a display the window has no frame, so it fills the display. As a window it keeps the title bar and can be moved.
    frame: mode === "window",
    resizable: mode === "window",
    minimizable: mode === "window",
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Audience display",
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/audience-window.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const contents = window.webContents;
  const id = contents.id;
  audienceContents = id;
  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
  // The audience window never opens a window or leaves its page.
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("did-finish-load", () => hooks.onLoaded());
  window.on("closed", () => {
    if (audienceContents === id) audienceContents = null;
    hooks.onClosed();
  });
  window.loadURL(audienceUrl()).catch(() => hooks.onError("The audience view could not load."));
  return {
    send: (state) => {
      if (!window.isDestroyed() && !contents.isDestroyed()) contents.send("audience:update", state);
    },
    setBounds: (rect) => {
      if (!window.isDestroyed()) window.setBounds(rect);
    },
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

/** Sends the audience status to the performance window. The controller closes during quit, after that window may already be destroyed. */
export function sendAudienceStatus(getWindow: () => BrowserWindow | null, status: AudienceStatus): void {
  sendTo(getWindow, "audience:status", status);
}

/** Registers the audience IPC and the display events. Only the performance window may call it; the audience window has no access. */
export function registerDisplayIpc(getWindow: () => BrowserWindow | null): { close(): void; dispose(): void } {
  const file = () => join(app.getPath("userData"), AUDIENCE_FILE);
  const controller = new AudienceController({
    displays: () => screen.getAllDisplays(),
    primary: () => screen.getPrimaryDisplay(),
    createWindow: createAudienceWindow,
    loadDisplayId: () => readDisplayId(file()),
    saveDisplayId: (displayId) => writeDisplayId(file(), displayId),
    onStatus: (status) => sendAudienceStatus(getWindow, status),
  });
  const mainOnly = (event: IpcMainInvokeEvent) => {
    if (event.sender.id !== getWindow()?.webContents.id) throw new HostError("unauthorized", "Only the performance screen controls the audience display.");
  };
  handle("audience:status", (event) => {
    mainOnly(event);
    return controller.status();
  });
  handle("audience:open", (event) => {
    mainOnly(event);
    return controller.open();
  });
  handle("audience:close", (event) => {
    mainOnly(event);
    return controller.close();
  });
  handle("audience:chooseDisplay", (event, displayId: unknown) => {
    mainOnly(event);
    return controller.choose(parseDisplayId(displayId));
  });
  handle("audience:publish", (event, update: unknown) => {
    mainOnly(event);
    const checked = parseAudienceUpdate(update);
    controller.publish(checked);
    for (const listener of publishListeners) listener(checked);
  });
  const changed = () => {
    controller.displaysChanged();
  };
  screen.on("display-added", changed);
  screen.on("display-removed", changed);
  screen.on("display-metrics-changed", changed);
  return {
    // The performance window closed: the audience window goes with it, and nothing else is touched.
    close: () => {
      controller.close();
    },
    dispose: () => {
      screen.removeListener("display-added", changed);
      screen.removeListener("display-removed", changed);
      screen.removeListener("display-metrics-changed", changed);
      controller.dispose();
    },
  };
}
