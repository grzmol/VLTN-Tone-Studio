// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The IPC handlers run for real; only Electron is replaced. vi.mock is hoisted, so the shared state lives in vi.hoisted.
const electron = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  shell: { openPath: vi.fn(async () => ""), showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) },
}));

vi.mock("electron", () => ({
  app: { getPath: () => electron.userData, getVersion: () => "0.0.0-test" },
  BrowserWindow: class {},
  dialog: {},
  shell: electron.shell,
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => electron.handlers.set(channel, fn) },
}));

/** Invoke a registered channel the way the preload does and return its Result. */
async function call(channel: string, ...args: unknown[]) {
  return electron.handlers.get(channel)!({}, ...args) as Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>;
}

let base: string;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  electron.handlers.clear();
  base = await mkdtemp(join(tmpdir(), "app-ipc-"));
  electron.userData = join(base, "userData");
  await mkdir(join(electron.userData, "logs"), { recursive: true });
  const { registerAppIpc } = await import("./app");
  registerAppIpc(() => null);
});

describe("app:openPath", () => {
  it("opens a folder inside userData", async () => {
    const res = await call("app:openPath", join(electron.userData, "logs"));
    expect(res.ok).toBe(true);
    expect(electron.shell.openPath).toHaveBeenCalledWith(join(electron.userData, "logs"));
  });

  it("refuses a program inside userData, a .app folder or a .sh script", async () => {
    await mkdir(join(electron.userData, "Helper.app"));
    await writeFile(join(electron.userData, "run.sh"), "echo hi");
    for (const name of ["Helper.app", "run.sh"]) {
      const res = await call("app:openPath", join(electron.userData, name));
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("invalid");
    }
    expect(electron.shell.openPath).not.toHaveBeenCalled();
  });

  it("refuses an app outside userData that was never handed out", async () => {
    const res = await call("app:openPath", "/Applications/Calculator.app");
    expect(res.error?.code).toBe("invalid");
    expect(electron.shell.openPath).not.toHaveBeenCalled();
  });

  it("refuses a non-string path", async () => {
    const res = await call("app:openPath", 42);
    expect(res.error?.code).toBe("invalid");
  });
});

describe("app:showItemInFolder", () => {
  it("refuses a path outside userData", async () => {
    const outside = join(base, "elsewhere");
    await mkdir(outside);
    const res = await call("app:showItemInFolder", outside);
    expect(res.error?.code).toBe("invalid");
    expect(electron.shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it("shows a path inside userData", async () => {
    const res = await call("app:showItemInFolder", join(electron.userData, "logs"));
    expect(res.ok).toBe(true);
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(join(electron.userData, "logs"));
  });
});

describe("app:setSettings and the Suite path", () => {
  it("leaves valetonSuitePath unchanged when the renderer sends one", async () => {
    await call("app:setSettings", { valetonSuitePath: "/Applications/Calculator.app", showValues: true });
    const res = await call("app:getSettings");
    expect(res.data).toMatchObject({ valetonSuitePath: null, suitePathPicked: false, showValues: true });
  });

  it("launches the Suite path stored by chooseSuitePath", async () => {
    const { chooseSuitePath } = await import("./app");
    await chooseSuitePath("/opt/Valeton Suite.app");
    const res = await call("app:launchSuite");
    expect(res.ok).toBe(true);
    expect(electron.shell.openPath).toHaveBeenCalledWith("/opt/Valeton Suite.app");
  });
});

describe("settings file", () => {
  it("moves a damaged settings.json aside instead of overwriting it with defaults", async () => {
    await writeFile(join(electron.userData, "settings.json"), '{ "showValues": tru');
    const res = await call("app:getSettings");
    expect(res.data).toMatchObject({ showValues: false });
    const files = await readdir(electron.userData);
    expect(files).not.toContain("settings.json");
    expect(files.some((f) => /^settings\.corrupt-.+\.json$/.test(f))).toBe(true);
  });

  it("keeps the damaged file when the next setting is saved", async () => {
    await writeFile(join(electron.userData, "settings.json"), "not json");
    await call("app:setSettings", { showValues: true });
    const files = await readdir(electron.userData);
    expect(files.some((f) => /^settings\.corrupt-.+\.json$/.test(f))).toBe(true);
    const saved = JSON.parse(await readFile(join(electron.userData, "settings.json"), "utf8"));
    expect(saved).toMatchObject({ showValues: true });
  });

  it("lands two saves made at the same time", async () => {
    await Promise.all([call("app:setSettings", { showValues: true }), call("app:setSettings", { checkForUpdates: false })]);
    const res = await call("app:getSettings");
    expect(res.data).toMatchObject({ showValues: true, checkForUpdates: false });
  });
});
