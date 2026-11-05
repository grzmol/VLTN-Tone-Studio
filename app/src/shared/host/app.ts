import type { AppEvent } from "../ipc";
import { BACKUP_RETENTIONS, type BackupRetention } from "../backup-retention";

export interface AppSettings {
  /** Show knob values printed under the labels on gear art. */
  showValues: boolean;
  /** Path to Valeton Suite (Windows .exe / macOS .app), where the SnapTone test signal is found; null = not configured. */
  valetonSuitePath: string | null;
  /** True once the Suite path was chosen in the file dialog; set only by the main process (device:pickSuitePath). */
  suitePathPicked: boolean;
  /** MIDI port name pattern override (advanced). */
  portPattern: string | null;
  /** Ask for a backup before every write to pedal memory. */
  backupBeforeWrite: boolean;
  /** After each backup, move the older backups of that pedal model to the Trash: "all" keeps every one (pinned backups are always kept). */
  backupRetention: BackupRetention;
  /** Desktop app: look for a new release on GitHub after launch and every few hours. */
  checkForUpdates: boolean;
  /**
   * GP-50 commands known only from reverse engineering (EXP, live tempo, footswitch masks, chain order, delete, copy,
   * move, export read): off = the app uses full preset writes or hides the feature on a real GP-50. The simulator always has them.
   */
  gp50Extras: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  showValues: false,
  valetonSuitePath: null,
  suitePathPicked: false,
  portPattern: null,
  backupBeforeWrite: true,
  backupRetention: "all",
  checkForUpdates: true,
  gp50Extras: false,
};

const KNOWN_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_SETTINGS));

/** Set only by the main process (device:pickSuitePath opens the file dialog), so a renderer patch may not carry them. */
const MAIN_ONLY_KEYS: ReadonlySet<string> = new Set(["valetonSuitePath", "suitePathPicked"]);

/** A value of the type its default has; the nullable settings also take null. */
function hasSettingType(key: keyof AppSettings, value: unknown): boolean {
  if (key === "backupRetention") return (BACKUP_RETENTIONS as readonly unknown[]).includes(value);
  const fallback = DEFAULT_SETTINGS[key];
  return fallback === null ? value === null || typeof value === "string" : typeof value === typeof fallback;
}

function knownSettings(input: unknown, allowMainOnly: boolean): Partial<AppSettings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_KEYS.has(key) || (!allowMainOnly && MAIN_ONLY_KEYS.has(key))) continue;
    if (hasSettingType(key as keyof AppSettings, value)) out[key] = value;
  }
  return out as Partial<AppSettings>;
}

/** A settings patch from the renderer, reduced to the settings this version knows, with the right types. Drops the Suite path. */
export function sanitizeSettingsPatch(patch: unknown): Partial<AppSettings> {
  return knownSettings(patch, false);
}

/** settings.json from any version: the same reduction, but the Suite path a previous save stored is kept. */
export function readSettingsFile(value: unknown): Partial<AppSettings> {
  return knownSettings(value, true);
}

export interface AppApi {
  version(): Promise<string>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  /** Starts Valeton Suite from the path chosen in Settings (or the macOS default). Takes no path from the renderer. */
  launchSuite(): Promise<void>;
  /** Taskbar/dock progress for long jobs (0..1), null clears it. */
  setProgress(fraction: number | null): Promise<void>;
  /** Files passed on launch ("Open with", command line) that arrived before the renderer listened; empties the queue. */
  takeOpenedFiles(): Promise<string[]>;
  /** Absolute path of a dropped File (Electron `webUtils.getPathForFile`); null in the web build. */
  pathForFile(file: File): string | null;
  /** Subscribe to menu commands and OS events. Returns an unsubscribe function. */
  onEvent(cb: (event: AppEvent) => void): () => void;
}
