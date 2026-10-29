import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { HostError, type Result } from "@shared/ipc";
import { ShellPaths } from "./shell-paths";

/** Register an invoke handler that always resolves to a Result (Electron only serializes Error.message). */
export function handle<A extends unknown[], T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<T> | T): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) };
    } catch (e) {
      if (e instanceof HostError) return { ok: false, error: { code: e.code, message: e.message } };
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") return { ok: false, error: { code: "not-found", message: err.message } };
      return { ok: false, error: { code: "internal", message: err?.message ?? String(e) } };
    }
  });
}

/** Paths the user picked in a dialog, plus userData: the only ones the renderer may open (see shell-paths.ts). */
export const shellPaths = new ShellPaths({ userData: () => app.getPath("userData") });

/** Open dialog, modal to the window when there is one. Every chosen path is allowed for openPath / showItemInFolder. */
export async function showOpenDialog(win: BrowserWindow | null, options: OpenDialogOptions) {
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  for (const path of res.filePaths) shellPaths.allow(path);
  return res;
}

/** Save dialog, modal to the window when there is one. The chosen path is allowed for openPath / showItemInFolder. */
export async function showSaveDialog(win: BrowserWindow | null, options: SaveDialogOptions) {
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (res.filePath) shellPaths.allow(res.filePath);
  return res;
}
