import { useCallback, useSyncExternalStore } from "react";
import { settingsRevision, subscribeSettings } from "./settings";

/** Options such as trims are edited outside the Performance view's local state, but must update its cues and player too. */
export function useSongSettingsRevision(key: string): number {
  return useSyncExternalStore(
    useCallback((listener) => subscribeSettings(key, listener), [key]),
    useCallback(() => settingsRevision(key), [key]),
  );
}
