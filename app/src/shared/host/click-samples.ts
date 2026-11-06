// Your own metronome sounds (spec 103): one audio file for the downbeat and one for the other beats. The desktop app copies them into
// userData/click-sounds (main/ipc/click-samples.ts); the browser build keeps them in IndexedDB. Owner: Song screen.

/** The two slots of the "My samples" click sound. */
export const CLICK_SAMPLE_SLOTS = ["down", "other"] as const;
export type ClickSampleSlot = (typeof CLICK_SAMPLE_SLOTS)[number];

export const isClickSampleSlot = (value: unknown): value is ClickSampleSlot => CLICK_SAMPLE_SLOTS.includes(value as ClickSampleSlot);

/** The largest file a slot keeps. A hit of at most two seconds is far smaller; this only stops a whole song being copied in. */
export const CLICK_SAMPLE_MAX_BYTES = 8 * 1024 * 1024;

/** A stored sample: the file as it was loaded, and the name it had. */
export interface StoredClickSample {
  name: string;
  bytes: ArrayBuffer;
}

export interface ClickSamplesApi {
  /** The file kept for a slot, or null when the slot is empty. */
  get(slot: ClickSampleSlot): Promise<StoredClickSample | null>;
  /** Keeps a copy of the file in a slot, replacing what was there. */
  put(slot: ClickSampleSlot, sample: StoredClickSample): Promise<void>;
  /** Empties a slot, so its beats use the click. */
  clear(slot: ClickSampleSlot): Promise<void>;
}
