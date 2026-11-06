// The audience display (spec 43): a second window for lyrics, chords or the PDF page, on an external display in the desktop app and in a
// pop-up window in the browser build. The audience window only reads state; playback never waits for it.
import type { AudienceUpdate } from "../audience";

/** A display the desktop app can put the audience window on. `label` is what the settings list shows. */
export interface AudienceDisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
}

/**
 * `windowing` says how the window is placed: "display" fills a chosen display (desktop), "popup" is a browser pop-up that the performer
 * moves and makes full screen (browser build).
 */
export interface AudienceStatus {
  windowing: "display" | "popup";
  open: boolean;
  /** Where the window is now, when it is open. */
  mode: "display" | "window" | null;
  /** The display the performer chose and the app remembers, even while it is unplugged. */
  displayId: number | null;
  displays: AudienceDisplayInfo[];
  /** One line for the settings: what is showing, or why it is not. */
  message: string;
}

export interface AudienceHostApi {
  /** Current status. Also pushed through `onStatus` whenever it changes. */
  status(): Promise<AudienceStatus>;
  onStatus(callback: (status: AudienceStatus) => void): () => void;
  open(): Promise<AudienceStatus>;
  close(): Promise<AudienceStatus>;
  /** Remember a display (null for "a window"). An open audience window moves to it. */
  chooseDisplay(displayId: number | null): Promise<AudienceStatus>;
  /** Sends what the audience window should show. Null parts of the update are unchanged. */
  publish(update: AudienceUpdate): Promise<void>;
}
