// Browser-build FilesApi: the same backups/collections model as the desktop app, kept in IndexedDB.
// Import uses <input type=file>, export downloads Blobs. Folders on disk need the desktop app.
import { HostError } from "@shared/ipc";
import {
  IMPORTED_ID,
  REPLACED_ID,
  type CollectionInfo,
  type CollectionKind,
  type FilesApi,
  type LocalPreset,
  type NewPreset,
  type PickedFile,
} from "@shared/host/files";
import { MAX_PRST_BYTES, PRST_MODELS, profileFor, sniffPrst, type DeviceKey } from "@shared/devices";
import {
  backupDirName,
  collectionDirName,
  commonModel,
  isSafePresetFileName,
  parseBackupDirName,
  parseCollectionId,
  presetFileName,
  uniqueFileName,
} from "@shared/files-naming";
import { pickFiles } from "./pick-files";

interface CollectionRow {
  id: string;
  kind: CollectionKind;
  title: string;
  createdAt: string;
  /** Backups only; rows saved before GP-50 support have none (their id names the model, see info) */
  device?: DeviceKey;
}

interface PresetRow {
  key: string;
  collectionId: string;
  fileName: string;
  name: string;
  slot: number | null;
  source: string | null;
  addedAt: string;
  seq: number;
  prst: Uint8Array;
}

const DB_NAME = "gp5-library";
const FIXED: Record<string, { title: string; kind: "imported" | "replaced" }> = {
  [IMPORTED_ID]: { title: "Imported files", kind: "imported" },
  [REPLACED_ID]: { title: "Replaced presets", kind: "replaced" },
};

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new HostError("unsupported", "This browser has no IndexedDB storage"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("collections", { keyPath: "id" });
      d.createObjectStore("presets", { keyPath: "key" }).createIndex("collection", "collectionId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new HostError("io", req.error?.message ?? "Couldn't open the browser library"));
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new HostError("io", req.error?.message ?? "Browser storage failed"));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new HostError("io", tx.error?.message ?? "Browser storage failed"));
  });
}

async function allCollections(): Promise<CollectionRow[]> {
  return done((await db()).transaction("collections").objectStore("collections").getAll() as IDBRequest<CollectionRow[]>);
}

async function presetRows(collectionId: string): Promise<PresetRow[]> {
  const index = (await db()).transaction("presets").objectStore("presets").index("collection");
  const rows = await done(index.getAll(collectionId) as IDBRequest<PresetRow[]>);
  return rows.sort((a, b) => a.seq - b.seq);
}

async function getCollection(id: string): Promise<CollectionRow | undefined> {
  return done((await db()).transaction("collections").objectStore("collections").get(id) as IDBRequest<CollectionRow | undefined>);
}

const toPreset = (r: PresetRow): LocalPreset => ({
  id: r.fileName,
  collectionId: r.collectionId,
  fileName: r.fileName,
  name: r.name,
  slot: r.slot,
  source: r.source,
  addedAt: r.addedAt,
  path: null,
  prst: r.prst,
});

async function info(row: CollectionRow): Promise<CollectionInfo> {
  const count = await done((await db()).transaction("presets").objectStore("presets").index("collection").count(row.id));
  const device = row.kind === "backup" ? (row.device ?? parseBackupDirName(parseCollectionId(row.id)?.dir ?? "")?.device ?? null) : null;
  return { ...row, device, count, path: null };
}

async function requireLibrary(id: string): Promise<CollectionRow> {
  const parsed = parseCollectionId(id);
  if (!parsed) throw new HostError("invalid", `Unknown collection ${id}`);
  if (parsed.root !== "library") throw new HostError("invalid", "Backups are read-only");
  const row = await getCollection(id);
  if (row) return row;
  const fixed = FIXED[id];
  if (!fixed) throw new HostError("not-found", "This collection no longer exists");
  const created: CollectionRow = { id, ...fixed, createdAt: new Date().toISOString() };
  const tx = (await db()).transaction("collections", "readwrite");
  tx.objectStore("collections").put(created);
  await finished(tx);
  return created;
}

async function putPresets(collectionId: string, items: NewPreset[]): Promise<LocalPreset[]> {
  const existing = await presetRows(collectionId);
  const taken = existing.map((r) => r.fileName);
  let seq = existing.reduce((m, r) => Math.max(m, r.seq), 0);
  const rows: PresetRow[] = items.map((item) => {
    const preferred = item.fileName && isSafePresetFileName(item.fileName) ? item.fileName : presetFileName(item.name, item.slot, sniffPrst(item.prst));
    const fileName = uniqueFileName(preferred, taken);
    taken.push(fileName);
    return {
      key: `${collectionId}\n${fileName}`,
      collectionId,
      fileName,
      name: item.name,
      slot: item.slot ?? null,
      source: item.source ?? null,
      addedAt: new Date().toISOString(),
      seq: ++seq,
      prst: item.prst,
    };
  });
  const tx = (await db()).transaction("presets", "readwrite");
  for (const r of rows) tx.objectStore("presets").put(r);
  await finished(tx);
  return rows.map(toPreset);
}

async function readFiles(files: File[]): Promise<PickedFile[]> {
  return Promise.all(
    files.map(async (f): Promise<PickedFile> => {
      if (!/\.prst$/i.test(f.name)) return { fileName: f.name, path: null, bytes: null, error: "Not a .prst preset file." };
      if (f.size > MAX_PRST_BYTES) return { fileName: f.name, path: null, bytes: null, error: `Not a ${PRST_MODELS} preset.` };
      return { fileName: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()), error: null };
    }),
  );
}

function download(fileName: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const desktopOnly = (what: string) => Promise.reject(new HostError("unsupported", `${what} needs the desktop app. In the browser, presets live in this browser's storage.`));

export const webFiles: FilesApi = {
  async listCollections() {
    const rows = await allCollections();
    const rank: Record<CollectionKind, number> = { backup: 0, imported: 1, replaced: 2, collection: 3 };
    rows.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.kind === "backup" ? b.createdAt.localeCompare(a.createdAt) : a.title.localeCompare(b.title)));
    return Promise.all(rows.map(info));
  },

  async listPresets(id) {
    if (!parseCollectionId(id)) throw new HostError("invalid", `Unknown collection ${id}`);
    return (await presetRows(id)).map(toPreset);
  },

  async saveBackup(slots, sourceDevice) {
    if (!slots.length) throw new HostError("invalid", "Nothing to back up");
    const device = commonModel(slots.map((s) => s.prst), sourceDevice);
    if (!device) throw new HostError("invalid", "A backup holds the presets of one pedal model");
    const now = new Date();
    const dirs = (await allCollections()).filter((c) => c.kind === "backup").map((c) => parseCollectionId(c.id)!.dir);
    const row: CollectionRow = {
      id: `backups/${backupDirName(now, dirs, device)}`,
      kind: "backup",
      title: `${profileFor(device).name} backup`,
      createdAt: now.toISOString(),
      device,
    };
    const tx = (await db()).transaction("collections", "readwrite");
    tx.objectStore("collections").put(row);
    await finished(tx);
    await putPresets(
      row.id,
      slots.map((s) => ({ name: s.name, prst: s.prst, slot: s.slot })),
    );
    return info(row);
  },

  async createCollection(title) {
    const clean = title.trim();
    if (!clean) throw new HostError("invalid", "A collection needs a name");
    const dirs = (await allCollections()).filter((c) => c.id.startsWith("library/")).map((c) => parseCollectionId(c.id)!.dir);
    const row: CollectionRow = { id: `library/${collectionDirName(clean, dirs)}`, kind: "collection", title: clean, createdAt: new Date().toISOString() };
    const tx = (await db()).transaction("collections", "readwrite");
    tx.objectStore("collections").put(row);
    await finished(tx);
    return info(row);
  },

  async renameCollection(id, title) {
    const clean = title.trim();
    if (!clean) throw new HostError("invalid", "A collection needs a name");
    const row = await requireLibrary(id);
    if (row.kind !== "collection") throw new HostError("invalid", `${row.title} can't be renamed`);
    const next = { ...row, title: clean };
    const tx = (await db()).transaction("collections", "readwrite");
    tx.objectStore("collections").put(next);
    await finished(tx);
    return info(next);
  },

  async deleteCollection(id) {
    const row = await requireLibrary(id);
    if (row.kind !== "collection") throw new HostError("invalid", "Only your own collections can be deleted");
    const keys = (await presetRows(id)).map((r) => r.key);
    const tx = (await db()).transaction(["collections", "presets"], "readwrite");
    tx.objectStore("collections").delete(id);
    for (const k of keys) tx.objectStore("presets").delete(k);
    await finished(tx);
  },

  async addPresets(id, items) {
    await requireLibrary(id);
    return putPresets(id, items);
  },

  async removePreset(id, presetId) {
    await requireLibrary(id);
    const tx = (await db()).transaction("presets", "readwrite");
    tx.objectStore("presets").delete(`${id}\n${presetId}`);
    await finished(tx);
  },

  async pickPrstFiles() {
    return readFiles(await pickFiles(".prst", { multiple: true }));
  },

  async pickPrstFolder() {
    const files = (await pickFiles(".prst", { multiple: true, directory: true })).filter((f) => /\.prst$/i.test(f.name));
    if (!files.length) return null;
    files.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    const folder = files[0].webkitRelativePath.split("/")[0] || "Folder";
    return { path: null, name: folder, files: await readFiles(files) };
  },

  readPaths: () => desktopOnly("Opening files by path"),

  readDropped: (files) => readFiles(files),

  async exportPresets(items) {
    if (!items.length) throw new HostError("invalid", "Nothing to export");
    for (const item of items) download(item.fileName, item.prst);
    return "Downloads";
  },

  openBackupsFolder: () => desktopOnly("Opening the backups folder"),
  revealCollection: () => desktopOnly("Showing folders"),
};
