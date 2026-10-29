import type { AppEvent } from "../ipc";

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
  checkForUpdates: true,
  gp50Extras: false,
};

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
