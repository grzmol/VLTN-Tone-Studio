// The library on disk (no Electron imports, so it is testable against a temp dir).
//   <root>/backups/<device key>-YYYY-MM-DD[-n]/<slot label>-Name.prst (+ backup.json)   read-only snapshots of the pedal
//   <root>/library/<dir>/collection.json + *.prst                                       Imported files, Replaced presets, user collections
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HostError } from "@shared/ipc";
import type { BackupSlot, CollectionInfo, CollectionKind, LocalPreset, NewPreset, PickedFile } from "@shared/host/files";
import { MAX_PRST_BYTES, PRST_MODELS, isDeviceKey, profileFor, prstName, sniffPrst, type DeviceKey } from "@shared/devices";
import {
  backupDirName,
  collectionDirName,
  commonModel,
  isSafePresetFileName,
  parseBackupDirName,
  parseCollectionId,
  parseSlotFileName,
  presetFileName,
  uniqueFileName,
} from "@shared/files-naming";

interface ItemMeta {
  name: string;
  slot: number | null;
  source: string | null;
  addedAt: string;
}

interface CollectionMeta {
  title: string;
  kind: Exclude<CollectionKind, "backup">;
  createdAt: string;
  /** File names in display order (setlists keep their order) */
  order: string[];
  items: Record<string, ItemMeta>;
}

const FIXED: Record<string, { title: string; kind: "imported" | "replaced" }> = {
  imported: { title: "Imported files", kind: "imported" },
  replaced: { title: "Replaced presets", kind: "replaced" },
};

const isPrst = (f: string) => /\.prst$/i.test(f);
const NOT_A_PRESET = `Not a ${PRST_MODELS} preset.`;

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Read user-chosen files for import: .prst only, small, readable. */
export async function readPrstPaths(paths: string[]): Promise<PickedFile[]> {
  return Promise.all(
    paths.map(async (path): Promise<PickedFile> => {
      const fileName = path.split(/[\\/]/).pop() ?? path;
      if (!isPrst(fileName)) return { fileName, path, bytes: null, error: "Not a .prst preset file." };
      try {
        const s = await stat(path);
        if (!s.isFile() || s.size > MAX_PRST_BYTES) return { fileName, path, bytes: null, error: NOT_A_PRESET };
        return { fileName, path, bytes: new Uint8Array(await readFile(path)), error: null };
      } catch (e) {
        return { fileName, path, bytes: null, error: `Couldn't read the file: ${(e as Error).message}` };
      }
    }),
  );
}

export class LibraryStore {
  constructor(private readonly root: string) {}

  get backupsDir(): string {
    return join(this.root, "backups");
  }
  get libraryDir(): string {
    return join(this.root, "library");
  }

  /** Absolute folder of a collection id; throws for ids that are malformed or point outside the root. */
  collectionPath(id: string): { root: "backups" | "library"; dir: string; path: string } {
    const parsed = parseCollectionId(id);
    if (!parsed) throw new HostError("invalid", `Unknown collection ${id}`);
    return { ...parsed, path: join(parsed.root === "backups" ? this.backupsDir : this.libraryDir, parsed.dir) };
  }

  private async readMeta(dir: string): Promise<CollectionMeta> {
    const path = join(this.libraryDir, dir, "collection.json");
    try {
      const meta = JSON.parse(await readFile(path, "utf8")) as CollectionMeta;
      return { ...meta, order: meta.order ?? [], items: meta.items ?? {} };
    } catch {
      const fixed = FIXED[dir];
      const createdAt = await stat(join(this.libraryDir, dir)).then(
        (s) => s.birthtime.toISOString(),
        () => new Date().toISOString(),
      );
      return { title: fixed?.title ?? dir, kind: fixed?.kind ?? "collection", createdAt, order: [], items: {} };
    }
  }

  private async writeMeta(dir: string, meta: CollectionMeta): Promise<void> {
    const path = join(this.libraryDir, dir, "collection.json");
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(meta, null, 2));
    await rename(tmp, path);
  }

  private async prstFiles(path: string): Promise<string[]> {
    return (await readdir(path).catch(() => [] as string[])).filter(isPrst).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }

  private async backupInfo(dir: string): Promise<CollectionInfo> {
    const path = join(this.backupsDir, dir);
    const files = await this.prstFiles(path);
    let createdAt: string | null = null;
    let device: DeviceKey | null = null;
    try {
      const raw: unknown = JSON.parse(await readFile(join(path, "backup.json"), "utf8"));
      if (raw && typeof raw === "object" && "createdAt" in raw && typeof raw.createdAt === "string") createdAt = raw.createdAt;
      if (raw && typeof raw === "object" && "device" in raw && isDeviceKey(raw.device)) device = raw.device;
    } catch {
      // Folders copied in by hand have no backup.json.
    }
    const named = parseBackupDirName(dir);
    createdAt ??= named?.date.toISOString() ?? (await stat(path)).mtime.toISOString();
    // backup.json before GP-50 support has no device: the folder name says it, else the first preset's header.
    device ??= named?.device ?? (files.length ? sniffPrst(new Uint8Array(await readFile(join(path, files[0])))) : null);
    const title = device ? `${profileFor(device).name} backup` : "Backup";
    return { id: `backups/${dir}`, kind: "backup", title, device, createdAt, count: files.length, path };
  }

  private async libraryInfo(dir: string): Promise<CollectionInfo> {
    const path = join(this.libraryDir, dir);
    const meta = await this.readMeta(dir);
    const files = await this.prstFiles(path);
    return { id: `library/${dir}`, kind: meta.kind, title: meta.title, device: null, createdAt: meta.createdAt, count: files.length, path };
  }

  async listCollections(): Promise<CollectionInfo[]> {
    const backups = await Promise.all((await listDirs(this.backupsDir)).filter((d) => parseCollectionId(`backups/${d}`)).map((d) => this.backupInfo(d)));
    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const lib = await Promise.all((await listDirs(this.libraryDir)).filter((d) => parseCollectionId(`library/${d}`)).map((d) => this.libraryInfo(d)));
    const rank: Record<CollectionKind, number> = { backup: 0, imported: 1, replaced: 2, collection: 3 };
    lib.sort((a, b) => rank[a.kind] - rank[b.kind] || a.title.localeCompare(b.title));
    return [...backups, ...lib];
  }

  async listPresets(id: string): Promise<LocalPreset[]> {
    const { root, dir, path } = this.collectionPath(id);
    if (!(await exists(path))) return [];
    const files = await this.prstFiles(path);
    const meta = root === "library" ? await this.readMeta(dir) : null;
    const ordered = meta ? [...meta.order.filter((f) => files.includes(f)), ...files.filter((f) => !meta.order.includes(f))] : files;
    const fallbackDate = (await stat(path)).mtime.toISOString();
    return Promise.all(
      ordered.map(async (fileName): Promise<LocalPreset> => {
        const filePath = join(path, fileName);
        const prst = new Uint8Array(await readFile(filePath));
        const m = meta?.items[fileName];
        const device = sniffPrst(prst);
        const fromName = device ? parseSlotFileName(fileName, device) : null;
        return {
          id: fileName,
          collectionId: id,
          fileName,
          name: (device ? prstName(prst, device) : "") || m?.name || fromName?.name || fileName.replace(/\.prst$/i, ""),
          slot: m ? m.slot : root === "backups" ? (fromName?.slot ?? null) : null,
          source: m?.source ?? null,
          addedAt: m?.addedAt ?? fallbackDate,
          path: filePath,
          prst,
        };
      }),
    );
  }

  async saveBackup(slots: BackupSlot[], now = new Date(), sourceDevice?: DeviceKey): Promise<CollectionInfo> {
    if (!slots.length) throw new HostError("invalid", "Nothing to back up");
    const device = commonModel(slots.map((s) => s.prst), sourceDevice);
    if (!device) throw new HostError("invalid", "A backup holds the presets of one pedal model");
    await mkdir(this.backupsDir, { recursive: true });
    const dir = backupDirName(now, await listDirs(this.backupsDir), device);
    const path = join(this.backupsDir, dir);
    await mkdir(path);
    const taken: string[] = [];
    for (const s of slots) {
      const fileName = uniqueFileName(presetFileName(s.name, s.slot, device), taken);
      taken.push(fileName);
      await writeFile(join(path, fileName), s.prst);
    }
    await writeFile(join(path, "backup.json"), JSON.stringify({ createdAt: now.toISOString(), device, slots: slots.length }, null, 2));
    return this.backupInfo(dir);
  }

  /** Make sure a library collection folder exists (Imported files / Replaced presets are created on demand). */
  private async ensureLibrary(id: string): Promise<{ dir: string; path: string }> {
    const { root, dir, path } = this.collectionPath(id);
    if (root !== "library") throw new HostError("invalid", "Backups are read-only");
    if (!(await exists(path))) {
      if (!FIXED[dir]) throw new HostError("not-found", "This collection no longer exists");
      await mkdir(path, { recursive: true });
      await this.writeMeta(dir, { ...FIXED[dir], createdAt: new Date().toISOString(), order: [], items: {} });
    }
    return { dir, path };
  }

  async createCollection(title: string): Promise<CollectionInfo> {
    const clean = title.trim();
    if (!clean) throw new HostError("invalid", "A collection needs a name");
    await mkdir(this.libraryDir, { recursive: true });
    const dir = collectionDirName(clean, await listDirs(this.libraryDir));
    await mkdir(join(this.libraryDir, dir));
    await this.writeMeta(dir, { title: clean, kind: "collection", createdAt: new Date().toISOString(), order: [], items: {} });
    return this.libraryInfo(dir);
  }

  async renameCollection(id: string, title: string): Promise<CollectionInfo> {
    const clean = title.trim();
    if (!clean) throw new HostError("invalid", "A collection needs a name");
    const { dir } = await this.ensureLibrary(id);
    const meta = await this.readMeta(dir);
    if (meta.kind !== "collection") throw new HostError("invalid", `${meta.title} can't be renamed`);
    await this.writeMeta(dir, { ...meta, title: clean });
    return this.libraryInfo(dir);
  }

  async deleteCollection(id: string): Promise<void> {
    const { root, dir, path } = this.collectionPath(id);
    if (root !== "library") throw new HostError("invalid", "Backups are read-only");
    if ((await this.readMeta(dir)).kind !== "collection") throw new HostError("invalid", "Only your own collections can be deleted");
    await rm(path, { recursive: true, force: true });
  }

  async addPresets(id: string, items: NewPreset[]): Promise<LocalPreset[]> {
    const { dir, path } = await this.ensureLibrary(id);
    const meta = await this.readMeta(dir);
    const taken = await this.prstFiles(path);
    const added: string[] = [];
    for (const item of items) {
      const preferred = item.fileName && isSafePresetFileName(item.fileName) ? item.fileName : presetFileName(item.name, item.slot, sniffPrst(item.prst));
      const fileName = uniqueFileName(preferred, taken);
      taken.push(fileName);
      await writeFile(join(path, fileName), item.prst);
      meta.items[fileName] = { name: item.name, slot: item.slot ?? null, source: item.source ?? null, addedAt: new Date().toISOString() };
      meta.order.push(fileName);
      added.push(fileName);
    }
    await this.writeMeta(dir, meta);
    return (await this.listPresets(id)).filter((p) => added.includes(p.fileName));
  }

  async removePreset(id: string, presetId: string): Promise<void> {
    const { dir, path } = await this.ensureLibrary(id);
    if (!isSafePresetFileName(presetId)) throw new HostError("invalid", "Unknown preset");
    await rm(join(path, presetId), { force: true });
    const meta = await this.readMeta(dir);
    delete meta.items[presetId];
    meta.order = meta.order.filter((f) => f !== presetId);
    await this.writeMeta(dir, meta);
  }
}
