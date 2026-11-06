// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  updater: { on: vi.fn(), off: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn() },
}));

vi.mock("electron", () => ({ app: { isPackaged: true, getVersion: () => "1.0.0" }, net: { fetch: vi.fn() } }));
vi.mock("./handle", () => ({ handle: (channel: string, fn: (...args: unknown[]) => unknown) => hoisted.handlers.set(channel, fn), sendTo: vi.fn() }));
vi.mock("./app", () => ({ isJobRunning: () => false, loadSettings: async () => ({ checkForUpdates: false }) }));
vi.mock("./log", () => ({ logMain: vi.fn() }));
vi.mock("electron-updater", () => {
  const { updater } = hoisted;
  class NsisUpdater {
    autoDownload = false;
    autoInstallOnAppQuit = false;
    allowDowngrade = false;
    allowPrerelease = false;
    disableWebInstaller = false;
    on = updater.on;
    off = updater.off;
    checkForUpdates = updater.checkForUpdates;
    downloadUpdate = updater.downloadUpdate;
  }
  return { NsisUpdater, AppImageUpdater: NsisUpdater };
});

const originalPlatform = process.platform;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  hoisted.handlers.clear();
  vi.clearAllMocks();
  // Windows builds are the ones electron-updater replaces in place, so download is allowed.
  Object.defineProperty(process, "platform", { value: "win32" });
  const { registerUpdateIpc } = await import("./update");
  registerUpdateIpc(() => null);
  hoisted.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("update download", () => {
  it("starts the installer download once when it is asked twice in the same tick", async () => {
    let finish!: () => void;
    hoisted.updater.downloadUpdate.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const check = hoisted.handlers.get("update:check")!;
    const download = hoisted.handlers.get("update:download")!;
    await check();

    const first = download();
    const second = download();
    finish();
    await Promise.all([first, second]);

    expect(hoisted.updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("can download again after a failed attempt, once the check finds the update again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    hoisted.updater.downloadUpdate.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"));
    hoisted.updater.downloadUpdate.mockResolvedValueOnce(undefined);
    const check = hoisted.handlers.get("update:check")!;
    const download = hoisted.handlers.get("update:download")!;
    await check();
    await download();
    await check();
    await download();
    expect(hoisted.updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });
});
