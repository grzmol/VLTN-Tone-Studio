import { create } from "zustand";
import { loadOutputSettings, saveOutputSettings, type OutputConfig } from "./outputs";

// The outputs every Performance player uses. Saved in localStorage, so the choice survives a restart. A change is applied to the
// players that are already open, so the user can change an output mid-song without stopping playback.

interface OutputSettings {
  config: OutputConfig;
  update: (config: OutputConfig) => void;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const useOutputSettings = create<OutputSettings>()((set) => ({
  config: loadOutputSettings(storage()),
  update: (config) => {
    saveOutputSettings(storage(), config);
    set({ config });
  },
}));
