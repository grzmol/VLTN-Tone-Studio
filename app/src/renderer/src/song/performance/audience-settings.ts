// The audience display's settings (spec 43). They are a per-computer preference, like the autoscroll style, so they are kept in
// localStorage. Blackout is not kept: a blacked-out screen should not come back on the next launch.
import { create } from "zustand";
import { AUDIENCE_LIMITS, AUDIENCE_ROTATIONS, type AudienceRotation } from "@shared/audience";

export const AUDIENCE_SETTINGS_KEY = "vltn.performance.audience.v1";

export interface AudienceSettings {
  /** Chord names on their own row above the lyric line. */
  showChords: boolean;
  /** A multiple of the base size, from AUDIENCE_LIMITS.fontMin to fontMax. */
  fontScale: number;
  rotation: AudienceRotation;
  /** Black while the song is stopped at its start, which is between the songs of a set. Off by default. */
  blackBetweenSongs: boolean;
  blackout: boolean;
}

export const DEFAULT_AUDIENCE_SETTINGS: AudienceSettings = { showChords: true, fontScale: 1, rotation: 0, blackBetweenSongs: false, blackout: false };

/** The stored settings, with anything unreadable or out of range replaced by its default. */
export function parseAudienceSettings(raw: string | null): AudienceSettings {
  if (!raw) return DEFAULT_AUDIENCE_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<AudienceSettings>;
    const fontScale = typeof value.fontScale === "number" && Number.isFinite(value.fontScale) ? value.fontScale : DEFAULT_AUDIENCE_SETTINGS.fontScale;
    return {
      showChords: typeof value.showChords === "boolean" ? value.showChords : DEFAULT_AUDIENCE_SETTINGS.showChords,
      fontScale: Math.min(AUDIENCE_LIMITS.fontMax, Math.max(AUDIENCE_LIMITS.fontMin, fontScale)),
      rotation: AUDIENCE_ROTATIONS.includes(value.rotation as AudienceRotation) ? (value.rotation as AudienceRotation) : DEFAULT_AUDIENCE_SETTINGS.rotation,
      blackBetweenSongs: typeof value.blackBetweenSongs === "boolean" ? value.blackBetweenSongs : DEFAULT_AUDIENCE_SETTINGS.blackBetweenSongs,
      blackout: false,
    };
  } catch {
    return DEFAULT_AUDIENCE_SETTINGS;
  }
}

function readStored(): AudienceSettings {
  try {
    return parseAudienceSettings(localStorage.getItem(AUDIENCE_SETTINGS_KEY));
  } catch {
    return DEFAULT_AUDIENCE_SETTINGS;
  }
}

function persist(settings: AudienceSettings): void {
  try {
    localStorage.setItem(
      AUDIENCE_SETTINGS_KEY,
      JSON.stringify({
        showChords: settings.showChords,
        fontScale: settings.fontScale,
        rotation: settings.rotation,
        blackBetweenSongs: settings.blackBetweenSongs,
      }),
    );
  } catch {
    // Storage can be full or blocked; the settings still hold for this session.
  }
}

export const useAudienceSettings = create<AudienceSettings & { update(patch: Partial<AudienceSettings>): void }>()((set, get) => ({
  ...readStored(),
  update(patch) {
    const next = { ...get(), ...patch };
    const clean = { ...next, fontScale: Math.min(AUDIENCE_LIMITS.fontMax, Math.max(AUDIENCE_LIMITS.fontMin, next.fontScale)) };
    persist(clean);
    set(clean);
  },
}));
