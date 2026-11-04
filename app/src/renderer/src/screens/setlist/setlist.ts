// Setlists: ordered pedal presets for a gig. An item points at a pedal slot and remembers the preset's name, because
// slots get overwritten: if the name in the slot changes, the setlist says so instead of silently playing another sound.
import { isDeviceKey, type DeviceKey } from "@shared/devices";
import type { SlotName } from "@/state/device-types";

export interface SetlistItem {
  id: string;
  slot: number;
  /** The preset's name when it was added (or last relinked) */
  name: string;
  note: string;
}

export interface Setlist {
  id: string;
  name: string;
  /** Slots differ between models, so a setlist belongs to one */
  device: DeviceKey;
  items: SetlistItem[];
}

export const NAME_MAX = 60;
export const NOTE_MAX = 200;
const ITEMS_MAX = 500;

export const newId = () => crypto.randomUUID();

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const out = [...list];
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}

/** Position of the first item on `slot`, or -1. */
export const indexOfSlot = (items: readonly SetlistItem[], slot: number | null) => (slot === null ? -1 : items.findIndex((i) => i.slot === slot));

/** The item to play after stepping `dir` from the current one; from outside the list, forward starts at the top and back at the end. Wraps around. */
export function stepIndex(current: number, dir: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return dir === 1 ? 0 : length - 1;
  return (current + dir + length) % length;
}

export type Drift = { kind: "ok" } | { kind: "renamed"; now: string } | { kind: "moved"; slot: number };

/**
 * Does the slot still hold the preset the item was made for? `names` is the pedal's slot list. Not loaded yet counts as
 * fine; a different name is "moved" when exactly one other slot has the remembered name, else "renamed".
 */
export function drift(item: SetlistItem, names: readonly SlotName[]): Drift {
  const same = (a: string, b: string) => a.trim() === b.trim();
  const here = names.find((n) => n.slot === item.slot);
  if (!here || same(here.name, item.name)) return { kind: "ok" };
  const elsewhere = names.filter((n) => same(n.name, item.name));
  return elsewhere.length === 1 ? { kind: "moved", slot: elsewhere[0].slot } : { kind: "renamed", now: here.name.trim() };
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Setlists from an exported file (fresh ids, so importing twice never collides); throws a message the UI can show. */
export function parseImport(text: string): Setlist[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This isn't a setlist file (not valid JSON).");
  }
  const lists = (data as { setlists?: unknown } | null)?.setlists;
  if (!Array.isArray(lists) || (data as { v?: unknown }).v !== 1) throw new Error("This isn't a Tone Studio setlist file.");
  return lists.map((raw: Record<string, unknown>) => {
    if (!raw || !isDeviceKey(raw.device) || !Array.isArray(raw.items)) throw new Error("A setlist in this file is damaged.");
    return {
      id: newId(),
      name: clean(raw.name, NAME_MAX).trim() || "Setlist",
      device: raw.device,
      items: raw.items.slice(0, ITEMS_MAX).map((i: Record<string, unknown>) => {
        if (!i || !Number.isInteger(i.slot) || (i.slot as number) < 0) throw new Error("A preset in this file has no valid slot.");
        return { id: newId(), slot: i.slot as number, name: clean(i.name, NAME_MAX), note: clean(i.note, NOTE_MAX) };
      }),
    };
  });
}

export const serialize = (lists: readonly Setlist[]) => JSON.stringify({ v: 1, setlists: lists }, null, 2);
