// The old global "Use pedal drums in every song" switch, kept only to move its effect into the songs. The choice now belongs to each
// song (see song/band/part-choice.ts); this runs once and removes the switch's key.

import { host } from "@/host";
import type { Mix } from "../stems/mix";
import { effectiveMute, type PracticeTracks } from "./practice-mute";
import { hasSavedPedalRhythm } from "./rhythm-runtime";

export const PEDAL_DRUMS_KEY = "vltn.performance.pedal-drums.v1";

/**
 * The song's saved options with drums set to the pedal, or null when the song stays as it is: it has no automatic RC-10R cues, or it
 * already saved a drums choice.
 */
export function withPedalDrums(settings: Record<string, string>): string | null {
  if (!hasSavedPedalRhythm(settings)) return null;
  let options: Record<string, unknown>;
  try {
    options = JSON.parse(settings[":options"] || "{}");
  } catch {
    return null;
  }
  const saved = options.partChoice;
  const record = saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  if (record.drums !== undefined) return null;
  return JSON.stringify({ ...options, partChoice: { ...record, drums: "pedal" } });
}

/**
 * Moves the old global switch into the songs, once. When it was on, every song with automatic RC-10R cues and no saved drums choice
 * chooses the pedal (with the default fallback). The key is removed afterwards, so this never runs twice; a failed save leaves it for
 * the next start.
 */
export async function migratePedalDrums(songs: { id: string; settings: Record<string, string> }[]): Promise<void> {
  let on = false;
  try {
    on = localStorage.getItem(PEDAL_DRUMS_KEY) === "on";
  } catch {
    return;
  }
  if (on && host.song.library) {
    for (const song of songs) {
      const options = withPedalDrums(song.settings);
      if (options === null) continue;
      await host.song.library.updateSettings(song.id, { ":options": options });
      song.settings = { ...song.settings, ":options": options };
    }
  }
  try {
    localStorage.removeItem(PEDAL_DRUMS_KEY);
  } catch {
    /* The key is only read once; a failed removal runs the same moves again, which change nothing. */
  }
}

/** Silences drum tracks above the saved mixer, including generated parts and an incoming playlist song. Used while the pedal plays the drums. */
export function pedalDrumMix(mix: Mix, tracks: PracticeTracks, enabled: boolean): Mix {
  return enabled ? effectiveMute(mix, new Set(["drums"]), tracks) : mix;
}
