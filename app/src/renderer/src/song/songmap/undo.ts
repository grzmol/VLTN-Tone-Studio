// The undo record of the last song map import (spec 94). It lives outside the import card, because Apply reloads the song and that
// remounts the Performance panel: component state would be lost before the performer can press Undo.

import { create } from "zustand";

/** What Undo puts back: the settings Apply replaced, as they were, and the text of the status line that Apply showed. */
export interface SongMapUndo {
  songKey: string;
  before: [string, string][];
  applied: string;
}

interface SongMapUndoState {
  record: SongMapUndo | null;
  set(record: SongMapUndo): void;
  clear(): void;
}

export const useSongMapUndo = create<SongMapUndoState>((set) => ({
  record: null,
  set: (record) => set({ record }),
  clear: () => set({ record: null }),
}));
