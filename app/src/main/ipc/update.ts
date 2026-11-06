import { app, net, type BrowserWindow } from "electron";
import type { AppUpdater } from "electron-updater";
import { HostError } from "@shared/ipc";
import { isNewer, latestReleaseVersion, RELEASE_REPO, type UpdateMode, type UpdateSnapshot, type UpdateState } from "@shared/host/update";
import { handle, sendTo } from "./handle";
import { isJobRunning, loadSettings } from "./app";
import { logMain } from "./log";

// App updates (src/shared/host/update.ts). Nothing is downloaded or installed without the user asking:
// checks only report (the renderer then asks "Download and install?"), download fetches the installer
// (electron-updater verifies its SHA-512 against the release's latest*.yml over HTTPS), and install quits and
// installs only on request, never during a pedal job; a downloaded update also installs when the user quits.

// The launch check: the window is up by then, and the renderer also asks for the state when it mounts.
const FIRST_CHECK_DELAY_MS = 3_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/releases/latest`;

const OFFLINE = "Couldn't reach GitHub. Check the internet connection and try again.";
const RATE_LIMITED = "GitHub is limiting update checks from this network. Try again in an hour.";

let mode: UpdateMode = "notify";
let state: UpdateState = { status: "idle" };
let getWindow: () => BrowserWindow | null = () => null;
let updaterLoad: Promise<AppUpdater> | null = null;

const snapshot = (): UpdateSnapshot => ({ mode, current: app.getVersion(), state });

function setState(next: UpdateState): void {
  state = next;
  sendTo(getWindow, "update:state", snapshot());
}

/** Builds electron-updater can replace in place. macOS needs a signed app (Squirrel.Mac) and the .deb a package manager. */
function detectMode(): UpdateMode {
  if (!app.isPackaged) return "notify";
  if (process.platform === "win32") return "install";
  if (process.platform === "linux" && process.env.APPIMAGE) return "install";
  return "notify";
}

/** electron-updater, loaded only in "install" mode. Feed and checksums come from app-update.yml (electron-builder `publish`). */
function updater(): Promise<AppUpdater> {
  updaterLoad ??= import("electron-updater").then(({ NsisUpdater, AppImageUpdater }) => {
    const u: AppUpdater = process.platform === "win32" ? new NsisUpdater() : new AppImageUpdater();
    u.autoDownload = false;
    u.autoInstallOnAppQuit = true;
    u.allowDowngrade = false;
    u.allowPrerelease = false;
    u.disableWebInstaller = true;
    // Failures are also returned from the awaited calls; without a listener the emitter would throw instead.
    u.on("error", (e) => console.error("[update]", e));
    return u;
  });
  return updaterLoad;
}

function describeFailure(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/net::|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timed? ?out|aborted/i.test(text)) return OFFLINE;
  if (/sha512|checksum/i.test(text)) return "The downloaded update didn't match its checksum, so it was deleted. Try again later.";
  if (/\b(403|429)\b/.test(text)) return RATE_LIMITED;
  return "Couldn't check for updates. Try again later.";
}

/** The newest plain release on GitHub, if it is newer than this build. */
async function latestFromApi(): Promise<string | null> {
  const res = await net.fetch(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `VLTN-Tone-Studio/${app.getVersion()}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404) return null; // no release published yet
  if (res.status === 403 || res.status === 429) throw new HostError("network", RATE_LIMITED);
  if (!res.ok) throw new HostError("network", `GitHub answered ${res.status}`);
  const version = latestReleaseVersion(await res.json());
  return version && isNewer(version, app.getVersion()) ? version : null;
}

async function latestFromUpdater(): Promise<string | null> {
  const result = await (await updater()).checkForUpdates();
  if (!result) throw new HostError("unsupported", "This build can't update itself");
  const { version } = result.updateInfo;
  return result.isUpdateAvailable && isNewer(version, app.getVersion()) ? version : null;
}

async function check(): Promise<UpdateSnapshot> {
  // A running check, a download or a downloaded update already answers the question.
  if (state.status === "checking" || state.status === "downloading" || state.status === "ready") return snapshot();
  setState({ status: "checking" });
  try {
    const version = mode === "install" ? await latestFromUpdater() : await latestFromApi();
    setState(version ? { status: "available", version } : { status: "current", checkedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[update] check failed", e);
    logMain("Error", `Update check failed: ${describeFailure(e)}`);
    setState({ status: "error", message: e instanceof HostError ? e.message : describeFailure(e) });
  }
  return snapshot();
}

async function download(): Promise<void> {
  if (mode !== "install") throw new HostError("unsupported", "Download this version from its release page");
  // A second click while the first download runs does nothing: the state says so before any await below.
  if (state.status === "downloading") return;
  if (state.status !== "available") throw new HostError("invalid", "There is no update to download");
  const { version } = state;
  setState({ status: "downloading", version, percent: 0 });
  let shown = -1;
  const onProgress = ({ percent }: { percent: number }) => {
    const p = Math.floor(percent);
    if (p === shown) return;
    shown = p;
    setState({ status: "downloading", version, percent: p });
  };
  let u: AppUpdater | null = null;
  try {
    u = await updater();
    u.on("download-progress", onProgress);
    await u.downloadUpdate();
    setState({ status: "ready", version });
  } catch (e) {
    // Reported through the state, like a failed check.
    console.error("[update] download failed", e);
    logMain("Error", `Update download failed: ${describeFailure(e)}`);
    setState({ status: "error", message: describeFailure(e) });
  } finally {
    u?.off("download-progress", onProgress);
  }
}

async function install(): Promise<void> {
  if (mode !== "install" || state.status !== "ready") throw new HostError("invalid", "No update is ready to install");
  // Same rule as closing the window: an interrupted write is discarded by the pedal.
  if (isJobRunning()) throw new HostError("invalid", "Tone Studio is still writing to or backing up the pedal. Restart when it finishes.");
  const u = await updater();
  // Silent on Windows (the install folder is already chosen), then start the new version.
  setImmediate(() => u.quitAndInstall(true, true));
}

async function scheduledCheck(): Promise<void> {
  if (!(await loadSettings()).checkForUpdates) return;
  await check();
}

export function registerUpdateIpc(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  mode = detectMode();
  handle("update:state", () => snapshot());
  handle("update:check", () => check());
  handle("update:download", () => download());
  handle("update:install", () => install());
  // Development runs only check when asked (Settings, Help menu).
  if (!app.isPackaged) return;
  setTimeout(() => void scheduledCheck(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void scheduledCheck(), CHECK_EVERY_MS);
}
