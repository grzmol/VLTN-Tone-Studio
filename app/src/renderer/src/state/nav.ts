import { create } from "zustand";

export type Screen = "rig" | "library" | "tones" | "device" | "capture" | "song" | "setlist";

export interface NavState {
  screen: Screen;
  /** Screen-specific parameter, e.g. the tone id for the capture editor */
  param: string | null;
  go(screen: Screen, param?: string | null): void;
}

export const useNav = create<NavState>((set) => ({
  screen: "rig",
  param: null,
  go: (screen, param = null) => set({ screen, param }),
}));
