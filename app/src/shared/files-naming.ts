// Pure naming rules for the library on disk (main) and in IndexedDB (browser build). Owner: Library.
import { DEVICE_KEYS, isDeviceKey, profileFor, sniffPrst, type DeviceKey } from "./devices";

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A file/folder name that is safe on Windows, macOS and Linux. Keeps spaces and case. */
export function sanitizeFileName(name: string, fallback = "Preset"): string {
  let s = name.normalize("NFC").replace(ILLEGAL, "_").replace(/\s+/g, " ").trim();
  // Windows drops trailing dots and spaces; leading dots hide files on macOS/Linux.
  s = s.replace(/[. ]+$/, "").replace(/^\.+/, "");
  if (s.length > 64) s = s.slice(0, 64).trimEnd();
  if (!s) return fallback;
  if (RESERVED.test(s.split(".")[0])) s = `_${s}`;
  return s;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * `<slot label>-Name.prst` (`07-Blues Man.prst`, GP-200 `12-C-Lead.prst`), the naming of `backupAll` and Valeton's own
 * backup folders. A blank name becomes the model's empty-slot name.
 */
export function slotFileName(slot: number, name: string, device: DeviceKey): string {
  const p = profileFor(device);
  return `${p.slotLabel(slot)}-${sanitizeFileName(name, p.emptyName ?? p.name)}.prst`;
}

/** Inverse of slotFileName for `device`'s slot labels: `07-Blues Man.prst` → { slot: 7, name: "Blues Man" }. */
export function parseSlotFileName(fileName: string, device: DeviceKey): { slot: number; name: string } | null {
  const m = /^(.*)\.prst$/i.exec(fileName);
  if (!m) return null;
  const p = profileFor(device);
  // The label may contain dashes itself ("12-C"): try every dash as the end of the label.
  for (let i = m[1].indexOf("-"); i > 0; i = m[1].indexOf("-", i + 1)) {
    const slot = p.parseSlotLabel(m[1].slice(0, i));
    if (slot !== null) return { slot, name: m[1].slice(i + 1) };
  }
  return null;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `gp5-YYYY-MM-DD` (GP-50: `gp50-…`, GP-200: `gp200-…`), then `…-2`, `…-3` … when a backup of that model and day exists. */
export function backupDirName(date: Date, existing: Iterable<string>, device: DeviceKey): string {
  const taken = new Set(Array.from(existing, (x) => x.toLowerCase()));
  const base = `${device}-${isoDay(date)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const BACKUP_DIR_RE = new RegExp(`^(${DEVICE_KEYS.join("|")})-(\\d{4})-(\\d{2})-(\\d{2})(?:-\\d+)?$`);

/** Date (local midnight) and model of a backup folder, or null for folders the app did not name. */
export function parseBackupDirName(dir: string): { date: Date; device: DeviceKey } | null {
  const m = BACKUP_DIR_RE.exec(dir);
  if (!m) return null;
  const d = new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[3]) - 1 ? null : { date: d, device: m[1] as DeviceKey };
}

/** The one model all `presets` belong to (see sniffPrst); null when there are none, one is not a preset, or they mix models. */
export function commonModel(presets: Iterable<Uint8Array>, sourceDevice?: DeviceKey): DeviceKey | null {
  let model: DeviceKey | null = null;
  for (const p of presets) {
    const m = sniffPrst(p);
    if (!m || (model && m !== model)) return null;
    model = m;
  }
  // GP-150/180 (and GP-200 variants) share a file format. Preserve the connected model,
  // but only when every file is compatible; an arbitrary label must not bypass validation.
  if (sourceDevice !== undefined) {
    if (!model || !isDeviceKey(sourceDevice) || profileFor(sourceDevice).prst !== profileFor(model).prst) return null;
    return sourceDevice;
  }
  return model;
}

/** `name.ext`, then `name (2).ext` … so imports never overwrite each other. Case-insensitive like Windows/macOS. */
export function uniqueFileName(fileName: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (x) => x.toLowerCase()));
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Fixed library folders; user collections never take these names. */
export const RESERVED_COLLECTION_DIRS = ["imported", "replaced"] as const;

/** Folder for a new user collection: sanitized title, unique, never a reserved folder. */
export function collectionDirName(title: string, existing: Iterable<string>): string {
  const base = sanitizeFileName(title, "Collection");
  const taken = [...existing, ...RESERVED_COLLECTION_DIRS];
  return uniqueFileName(base, taken);
}

export type CollectionRoot = "backups" | "library";

/** Validate a collection id (`backups/<dir>` or `library/<dir>`); rejects anything that could leave the root. */
export function parseCollectionId(id: string): { root: CollectionRoot; dir: string } | null {
  const m = /^(backups|library)\/([^/\\]+)$/.exec(id);
  if (!m) return null;
  const dir = m[2];
  if (dir === "." || dir === ".." || dir !== sanitizeFileName(dir, "")) return null;
  return { root: m[1] as CollectionRoot, dir };
}

/** A preset file name inside a collection: one path segment, .prst. */
export function isSafePresetFileName(fileName: string): boolean {
  return /\.prst$/i.test(fileName) && fileName === sanitizeFileName(fileName, "") && !fileName.includes("/");
}

/**
 * Default file name for a preset added to a collection: slot-numbered when it came from a slot of a known model
 * (`device`: the preset's model, also for blank names), else the sanitized name.
 */
export function presetFileName(name: string, slot: number | null | undefined, device: DeviceKey | null): string {
  return slot === null || slot === undefined || !device ? `${sanitizeFileName(name)}.prst` : slotFileName(slot, name, device);
}
