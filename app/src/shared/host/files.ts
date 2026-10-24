// Library: backups folder, .prst collections, import/export dialogs. Owner: Library.
// Desktop: files under userData (`backups/<device key>-YYYY-MM-DD[-n]/<slot label>-Name.prst`, `library/<dir>/collection.json` + .prst).
// Browser build: the same model in IndexedDB; file pickers and downloads instead of native dialogs.

import type { DeviceKey } from "../devices";

export type CollectionKind = "backup" | "imported" | "replaced" | "collection";

/** Fixed collection ids (created on first use). */
export const IMPORTED_ID = "library/imported";
export const REPLACED_ID = "library/replaced";

export interface CollectionInfo {
  /** `backups/<dir>` or `library/<dir>` */
  id: string;
  kind: CollectionKind;
  /** "GP-5 backup", "GP-50 backup", "Imported files", "Replaced presets" or the user's title */
  title: string;
  /** Model of the pedal a backup was made from; null for library collections and backups of unknown origin */
  device: DeviceKey | null;
  /** ISO timestamp */
  createdAt: string;
  count: number;
  /** Absolute folder on disk (desktop only) */
  path: string | null;
}

export interface LocalPreset {
  /** Unique within its collection (the file name) */
  id: string;
  collectionId: string;
  fileName: string;
  /** Preset name stored in the file */
  name: string;
  /** Pedal slot it came from (backups, copies of pedal slots) */
  slot: number | null;
  /** Where it came from: original file name or "Slot 63 on GP-5" */
  source: string | null;
  /** ISO timestamp */
  addedAt: string;
  /** Absolute file path (desktop only) */
  path: string | null;
  /** Raw .prst bytes as stored (any model, see sniffPrst) */
  prst: Uint8Array;
}

export interface NewPreset {
  name: string;
  prst: Uint8Array;
  slot?: number | null;
  source?: string | null;
  /** Preferred file name; made unique within the collection. Defaults to `NN-Name.prst` / `Name.prst`. */
  fileName?: string;
}

export interface BackupSlot {
  slot: number;
  name: string;
  prst: Uint8Array;
}

/** A file picked or dropped by the user, read but not yet validated (the renderer validates with the toolkit). */
export interface PickedFile {
  fileName: string;
  path: string | null;
  bytes: Uint8Array | null;
  /** Why the file could not be read (wrong extension, too big, unreadable) */
  error: string | null;
}

export interface ExportItem {
  fileName: string;
  prst: Uint8Array;
}

export interface FilesApi {
  /** Backups (newest first), then Imported files, Replaced presets and user collections. */
  listCollections(): Promise<CollectionInfo[]>;
  listPresets(collectionId: string): Promise<LocalPreset[]>;
  /**
   * Save a full (or partial) pedal backup as a new `backups/<model>-YYYY-MM-DD[-n]` folder of
   * `<slot label>-Name.prst` files (`gp5-…`, `gp50-…`, `gp200-…`). The model is read from the presets, which must all belong to one model.
   */
  saveBackup(slots: BackupSlot[], sourceDevice?: DeviceKey): Promise<CollectionInfo>;
  createCollection(title: string): Promise<CollectionInfo>;
  renameCollection(id: string, title: string): Promise<CollectionInfo>;
  /** Deletes a user collection (backups are read-only and cannot be deleted from the app). */
  deleteCollection(id: string): Promise<void>;
  /** Add presets to a library collection; IMPORTED_ID / REPLACED_ID are created on demand. */
  addPresets(collectionId: string, items: NewPreset[]): Promise<LocalPreset[]>;
  removePreset(collectionId: string, presetId: string): Promise<void>;
  /** Open dialog for .prst files (multi-select). Empty when cancelled. */
  pickPrstFiles(): Promise<PickedFile[]>;
  /** Folder picker; returns every .prst in the folder (e.g. a backup made elsewhere). Null when cancelled. */
  pickPrstFolder(): Promise<{ path: string | null; name: string; files: PickedFile[] } | null>;
  /** Read files by absolute path (OS "open with", drag-drop). Desktop only. */
  readPaths(paths: string[]): Promise<PickedFile[]>;
  /** Read File objects dropped on the window. */
  readDropped(files: File[]): Promise<PickedFile[]>;
  /** One item: save dialog. Several: folder dialog (browser: downloads). Returns the target, or null when cancelled. */
  exportPresets(items: ExportItem[]): Promise<string | null>;
  /** Desktop only: the backups folder in the OS file manager. */
  openBackupsFolder(): Promise<void>;
  /** Desktop only: reveal a collection's folder. */
  revealCollection(id: string): Promise<void>;
}
