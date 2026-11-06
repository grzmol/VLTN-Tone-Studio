import { clampCrossfade } from "./transition";

// The crossfade between playlist songs is one setting for the whole app. It is a per-device convenience, so it lives in localStorage,
// and a store that cannot be read or written leaves the crossfade off rather than failing.

const KEY = "vltn.performance.crossfade.v1";

/** The crossfade length in seconds, from 0 (none) to 10 */
export function readCrossfade(): number {
  try {
    return clampCrossfade(Number(localStorage.getItem(KEY) ?? 0));
  } catch {
    return 0;
  }
}

export function writeCrossfade(seconds: number): void {
  try {
    localStorage.setItem(KEY, String(clampCrossfade(seconds)));
  } catch {
    // Keeping the setting for this session is enough when storage is blocked.
  }
}
