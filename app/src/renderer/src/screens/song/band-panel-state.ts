// Whether the Band panel is open, and which of its tabs is showing. A small store, so the Band button and the missing-part notice can
// open it without the Performance screen re-rendering its transport. The tab is kept for the session, so the dialog opens where it was.

import { create } from "zustand";

export const BAND_TABS = ["parts", "feel", "sound", "notes", "timing"] as const;
export type BandTab = (typeof BAND_TABS)[number];

export const BAND_TAB_LABELS: Record<BandTab, string> = { parts: "Parts", feel: "Feel", sound: "Sound", notes: "Notes", timing: "Timing" };

/** True for a string that names a tab, so the tabs' change handler needs no cast. */
export function isBandTab(value: string): value is BandTab {
  return (BAND_TABS as readonly string[]).includes(value);
}

interface BandPanelState {
  open: boolean;
  show(open: boolean): void;
  tab: BandTab;
  setTab(tab: BandTab): void;
}

export const useBandPanel = create<BandPanelState>()((set) => ({
  open: false,
  show: (open) => set({ open }),
  tab: "parts",
  setTab: (tab) => set({ tab }),
}));
