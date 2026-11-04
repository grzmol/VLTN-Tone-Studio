// Setlist state, kept in localStorage (like the library's tags): setlists are small and per computer.
// ponytail: export/import (setlist.ts) is the backup; move to a file in userData if losing browser storage ever bites.
import { create } from "zustand";
import type { DeviceKey } from "@shared/devices";
import { move, newId, NAME_MAX, NOTE_MAX, type Setlist, type SetlistItem } from "./setlist";

const KEY = "vltn.setlists.v1";

interface Saved {
  setlists: Setlist[];
  currentId: string | null;
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v?.v === 1 && Array.isArray(v.setlists)) return { setlists: v.setlists, currentId: v.currentId ?? null };
  } catch {
    /* unreadable or blocked: start empty */
  }
  return { setlists: [], currentId: null };
}

interface SetlistState extends Saved {
  /** Stage mode is showing */
  stage: boolean;
  setStage(on: boolean): void;
  create(name: string, device: DeviceKey): void;
  select(id: string | null): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  addItem(id: string, slot: number, name: string): void;
  removeItem(id: string, itemId: string): void;
  moveItem(id: string, from: number, to: number): void;
  setNote(id: string, itemId: string, note: string): void;
  /** Point an item at another slot and/or name (after the slot list changed) */
  relink(id: string, itemId: string, to: { slot: number; name: string }): void;
  importAll(lists: Setlist[]): void;
}

export const useSetlists = create<SetlistState>((set, get) => {
  const commit = (patch: Partial<Saved>) => {
    set(patch);
    const { setlists, currentId } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, setlists, currentId }));
    } catch {
      /* storage full or blocked: setlists last for this session */
    }
  };
  const edit = (id: string, f: (l: Setlist) => Setlist) => commit({ setlists: get().setlists.map((l) => (l.id === id ? f(l) : l)) });
  const editItem = (id: string, itemId: string, f: (i: SetlistItem) => SetlistItem) => edit(id, (l) => ({ ...l, items: l.items.map((i) => (i.id === itemId ? f(i) : i)) }));

  return {
    ...load(),
    stage: false,
    setStage: (stage) => set({ stage }),
    create(name, device) {
      const list: Setlist = { id: newId(), name: name.trim().slice(0, NAME_MAX) || "New setlist", device, items: [] };
      commit({ setlists: [...get().setlists, list], currentId: list.id });
    },
    select: (currentId) => commit({ currentId }),
    rename: (id, name) => edit(id, (l) => ({ ...l, name: name.trim().slice(0, NAME_MAX) || l.name })),
    remove(id) {
      const rest = get().setlists.filter((l) => l.id !== id);
      commit({ setlists: rest, currentId: get().currentId === id ? (rest[0]?.id ?? null) : get().currentId });
    },
    addItem: (id, slot, name) => edit(id, (l) => ({ ...l, items: [...l.items, { id: newId(), slot, name, note: "" }] })),
    removeItem: (id, itemId) => edit(id, (l) => ({ ...l, items: l.items.filter((i) => i.id !== itemId) })),
    moveItem: (id, from, to) => edit(id, (l) => ({ ...l, items: move(l.items, from, to) })),
    setNote: (id, itemId, note) => editItem(id, itemId, (i) => ({ ...i, note: note.slice(0, NOTE_MAX) })),
    relink: (id, itemId, to) => editItem(id, itemId, (i) => ({ ...i, ...to })),
    importAll(lists) {
      commit({ setlists: [...get().setlists, ...lists], currentId: lists[0]?.id ?? get().currentId });
    },
  };
});
