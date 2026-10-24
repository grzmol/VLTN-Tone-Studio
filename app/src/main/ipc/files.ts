import { app, shell, type BrowserWindow } from "electron";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { HostError } from "@shared/ipc";
import type { BackupSlot, ExportItem, NewPreset } from "@shared/host/files";
import { isSafePresetFileName, sanitizeFileName, uniqueFileName } from "@shared/files-naming";
import { handle, showOpenDialog, showSaveDialog } from "./handle";
import { LibraryStore, readPrstPaths } from "./files-store";
import type { DeviceKey } from '@shared/devices';

const PRST_FILTER = [{ name: "Valeton presets", extensions: ["prst"] }];

/** Desktop implementation of FilesApi (src/shared/host/files.ts) over userData. */
export function registerFilesIpc(getWindow: () => BrowserWindow | null): void {
  const store = new LibraryStore(app.getPath("userData"));

  const openFolder = async (path: string) => {
    await mkdir(path, { recursive: true });
    const err = await shell.openPath(path);
    if (err) throw new HostError("io", err);
  };

  handle("files:listCollections", () => store.listCollections());
  handle("files:listPresets", (_e, id: string) => store.listPresets(id));
  handle("files:saveBackup", (_e, slots: BackupSlot[], sourceDevice?: DeviceKey) => store.saveBackup(slots, new Date(), sourceDevice));
  handle("files:createCollection", (_e, title: string) => store.createCollection(title));
  handle("files:renameCollection", (_e, id: string, title: string) => store.renameCollection(id, title));
  handle("files:deleteCollection", (_e, id: string) => store.deleteCollection(id));
  handle("files:addPresets", (_e, id: string, items: NewPreset[]) => store.addPresets(id, items));
  handle("files:removePreset", (_e, id: string, presetId: string) => store.removePreset(id, presetId));

  handle("files:pickPrstFiles", async () => {
    const res = await showOpenDialog(getWindow(), { title: "Import presets", properties: ["openFile", "multiSelections"], filters: PRST_FILTER });
    return res.canceled ? [] : readPrstPaths(res.filePaths);
  });

  handle("files:pickPrstFolder", async () => {
    const res = await showOpenDialog(getWindow(), { title: "Choose a folder of .prst files", properties: ["openDirectory"] });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    const names = (await readdir(dir)).filter((f) => /\.prst$/i.test(f)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    return { path: dir, name: basename(dir), files: await readPrstPaths(names.map((f) => join(dir, f))) };
  });

  handle("files:readPaths", (_e, paths: string[]) => readPrstPaths(paths));

  handle("files:exportPresets", async (_e, items: ExportItem[]) => {
    if (!items.length) throw new HostError("invalid", "Nothing to export");
    const win = getWindow();
    if (items.length === 1) {
      const [item] = items;
      const options = {
        title: "Export preset",
        defaultPath: join(app.getPath("documents"), sanitizeFileName(item.fileName)),
        filters: PRST_FILTER,
      };
      const res = await showSaveDialog(win, options);
      if (res.canceled || !res.filePath) return null;
      await writeFile(res.filePath, item.prst);
      return res.filePath;
    }
    const res = await showOpenDialog(win, { title: `Export ${items.length} presets to a folder`, properties: ["openDirectory", "createDirectory"] });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    const taken = await readdir(dir);
    for (const item of items) {
      const name = uniqueFileName(isSafePresetFileName(item.fileName) ? item.fileName : `${sanitizeFileName(item.fileName)}.prst`, taken);
      taken.push(name);
      await writeFile(join(dir, name), item.prst);
    }
    return dir;
  });

  handle("files:openBackupsFolder", () => openFolder(store.backupsDir));
  handle("files:revealCollection", (_e, id: string) => openFolder(store.collectionPath(id).path));
}
