import { create } from "zustand";
import { effectiveMute, type PracticeTracks } from "./practice-mute";
import type { Mix } from "../stems/mix";
const KEY = "vltn.performance.pedal-drums.v1";
function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}
export const usePedalDrums = create<{ enabled: boolean; set(enabled: boolean): void }>((set) => ({
  enabled: stored(),
  set(enabled) {
    try {
      localStorage.setItem(KEY, enabled ? "on" : "off");
    } catch {
      /* The session still follows the choice. */
    }
    set({ enabled });
  },
}));
/** Silences drum tracks above the saved mixer, including generated parts and an incoming playlist song. */
export function pedalDrumMix(mix: Mix, tracks: PracticeTracks, enabled: boolean): Mix {
  return enabled ? effectiveMute(mix, new Set(["drums"]), tracks) : mix;
}
