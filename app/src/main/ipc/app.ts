import { app, BrowserWindow, shell } from "electron";
import { readFile, rename, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_SETTINGS, readSettingsFile, sanitizeSettingsPatch, type AppSettings, type MemoryReading } from "@shared/host/app";
import { HostError } from "@shared/ipc";
import { handle, shellPaths } from "./handle";
import { serial, writeJsonAtomic } from "./fs-atomic";
import { logMain } from "./log";
import { suiteToLaunch } from "./shell-paths";

const settingsPath = () => join(app.getPath("userData"), "settings.json");
let cache: AppSettings | null = null;

/** Reads settings.json. A missing file gives defaults; one that doesn't parse is moved aside, never overwritten. */
async function readSettings(): Promise<AppSettings> {
  let text: string;
  try {
    text = await readFile(settingsPath(), "utf8");
  } catch {
    // No file yet (a first run) or none readable: defaults. The next save writes a fresh file.
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return { ...DEFAULT_SETTINGS, ...readSettingsFile(JSON.parse(text)) };
  } catch {
    // Keep the damaged file for the user to look at; saving defaults over it would lose every setting.
    const aside = join(app.getPath("userData"), `settings.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await rename(settingsPath(), aside).catch(() => {});
    logMain("Settings", `settings.json could not be read and was moved to ${aside}`);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  const settings = await readSettings();
  cache = settings;
  return settings;
}

/** Saves one patch. Saves run one at a time, so two in a row (say the Suite path and a toggle) both land. */
function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return serial(settingsPath(), async () => {
    const next = { ...(await loadSettings()), ...patch };
    await writeJsonAtomic(settingsPath(), next);
    cache = next;
    return next;
  });
}

/** Store the Valeton Suite path the user chose in the file dialog (device:pickSuitePath). The only writer of it. */
export function chooseSuitePath(path: string): Promise<AppSettings> {
  return saveSettings({ valetonSuitePath: path, suitePathPicked: true });
}

/** A backup or write is running (the renderer reports its progress); window close asks first. */
let jobProgress: number | null = null;
export const isJobRunning = () => jobProgress !== null;

/** A song or playlist is playing (the renderer reports it); quitting and "Restart to update" ask first. */
let showRunning = false;
const watchedSenders = new WeakSet<object>();
export const isShowRunning = () => showRunning;

/** What closing the window should do: ask about a pedal job first, then about a running show, else close. */
export function closeDecision({ job, show }: { job: boolean; show: boolean }): "job-prompt" | "show-prompt" | "close" {
  if (job) return "job-prompt";
  return show ? "show-prompt" : "close";
}

/** Files the OS asked us to open before the renderer was ready to receive them. */
const openedFiles: string[] = [];
export function queueOpenedFiles(paths: string[]): void {
  openedFiles.push(...paths);
}

/** Where an OS-opened file goes: to a window that has loaded, or to the queue the renderer takes on mount (app:takeOpenedFiles). */
export function routeOpenedFile(win: { isDestroyed(): boolean; webContents: { isLoading(): boolean } } | null): "send" | "queue" {
  return win && !win.isDestroyed() && !win.webContents.isLoading() ? "send" : "queue";
}

/** The renderer `pid` in Electron's process metrics, with the machine's memory. Null when the renderer is not listed. */
export function memoryReading(
  metrics: { pid: number; memory: { workingSetSize: number; peakWorkingSetSize: number } }[],
  pid: number,
  system: { total: number; free: number },
): MemoryReading | null {
  const entry = metrics.find((m) => m.pid === pid);
  if (!entry) return null;
  return { workingSetKb: entry.memory.workingSetSize, peakWorkingSetKb: entry.memory.peakWorkingSetSize, totalKb: system.total, freeKb: system.free };
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);

/** Checks a renderer-supplied path against what main handed out; returns the absolute path to pass to shell. */
async function allowedShellPath(path: unknown): Promise<string> {
  if (typeof path !== "string" || !(await shellPaths.isAllowed(path))) throw new HostError("invalid", "Tone Studio only opens its own folders and files you chose");
  return resolve(path);
}

export function registerAppIpc(getWindow: () => BrowserWindow | null): void {
  handle("app:version", () => app.getVersion());
  handle("app:getSettings", () => loadSettings());
  // The sanitiser drops unknown keys, wrong types and the Suite path: only device:pickSuitePath sets that.
  handle("app:setSettings", (_e, patch: unknown) => saveSettings(sanitizeSettingsPatch(patch)));
  handle("app:openExternal", async (_e, url: string) => {
    if (!isHttp(url)) throw new HostError("invalid", "Only http(s) links can be opened");
    await shell.openExternal(url);
  });
  handle("app:showItemInFolder", async (_e, path: string) => {
    shell.showItemInFolder(await allowedShellPath(path));
  });
  handle("app:openPath", async (_e, path: string) => {
    const full = await allowedShellPath(path);
    const info = await stat(full).catch(() => null);
    // openPath is only for folders (logs, the library). Files are never opened, so nothing can be launched through it.
    if (!info?.isDirectory()) throw new HostError("invalid", "Tone Studio only opens folders");
    const err = await shell.openPath(full);
    if (err) throw new HostError("io", err);
  });
  handle("app:launchSuite", async () => {
    const suite = suiteToLaunch(await loadSettings(), process.platform);
    if (!suite) throw new HostError("invalid", "Choose Valeton Suite in Settings first");
    // Launching a program is this channel's job, so it is not limited to folders the way openPath is.
    const err = await shell.openPath(suite);
    if (err) throw new HostError("io", err);
  });
  handle("app:setProgress", (_e, fraction: number | null) => {
    jobProgress = fraction === null ? null : Math.max(0, Math.min(1, fraction));
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.setProgressBar(jobProgress === null ? -1 : jobProgress);
  });
  handle("app:setShowRunning", (e, running: unknown) => {
    showRunning = running === true;
    if (!showRunning || watchedSenders.has(e.sender)) return;
    // A renderer that crashed or closed can never say "stopped", so it must not block quitting for good.
    watchedSenders.add(e.sender);
    const clear = () => {
      showRunning = false;
    };
    // `on`, not `once`: the same sender can crash, reload and report again, and is not added twice.
    e.sender.on("render-process-gone", clear);
    e.sender.once("destroyed", clear);
  });
  // Read-only and cheap; a failure gives null, never an error into the page that is playing.
  handle("app:memory", (e) => {
    try {
      return memoryReading(app.getAppMetrics(), e.sender.getOSProcessId(), process.getSystemMemoryInfo());
    } catch {
      return null;
    }
  });
  handle("app:takeOpenedFiles", () => openedFiles.splice(0));
}
