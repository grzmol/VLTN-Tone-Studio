// Whether the Band panel is open. A small store, so the Band button and the missing-part notice can open it without the Performance
// screen re-rendering its transport.

import { create } from "zustand";

interface BandPanelState {
  open: boolean;
  show(open: boolean): void;
}

export const useBandPanel = create<BandPanelState>()((set) => ({
  open: false,
  show: (open) => set({ open }),
}));
