// Restore sources: a backup collection or a folder picked by the user → slot-addressed presets to write, each
// prepared for the connected pedal's model (GP-5 ⇄ GP-50; presets of another family are skipped).
import { parseSlotFileName } from "@shared/files-naming";
import { PRST_MODELS, prstName, profileFor, sniffPrst } from "@shared/devices";
import { isEmptySlotName, prepareForDevice, profileOrDefault, type PreparedPreset } from "@/state/device-model";
import type { BackupEntry, DeviceKey } from "@/state/device-types";
import { editPrst } from "@/state/preset-codec";

/** An entry made on the other model, converted for the connected pedal. */
export interface RestoreConversion {
  slot: number;
  name: string;
  from: DeviceKey;
  /** Blocks left empty because their model doesn't exist on the pedal, e.g. "PRE (PRE C-Wah)" */
  dropped: string[];
}

export interface RestoreSource {
  /** "gp5-2026-10-07" or the picked folder's name */
  title: string;
  /** "backups/gp5-2026-10-07" or the folder path */
  location: string;
  /** One per slot, sorted by slot, ready to write to the connected pedal */
  entries: BackupEntry[];
  /** Entries converted from the other model, sorted by slot (the dialog lists dropped blocks before writing) */
  converted: RestoreConversion[];
  /** Files that can't be restored, with the reason */
  skipped: string[];
}

export interface SourceFile {
  fileName: string;
  /** Slot recorded with the file (backups), otherwise taken from an `NN-` file name prefix */
  slot?: number | null;
  bytes: Uint8Array | null;
  error?: string | null;
}

/**
 * Keep presets of either model with a known slot, one per slot (the first wins); explain everything else.
 * `target` is the connected pedal's model: other-model presets are converted for it, and an empty slot of the other
 * model is renamed to the target's empty name so it still reads as empty. Null target: entries stay as they are.
 */
export function restoreEntries(files: SourceFile[], target: DeviceKey | null): Omit<RestoreSource, "title" | "location"> {
  const bySlot = new Map<number, { entry: BackupEntry; conversion: RestoreConversion | null }>();
  const skipped: string[] = [];
  for (const f of files) {
    if (!f.bytes) {
      skipped.push(`${f.fileName}: ${f.error ?? "unreadable"}`);
      continue;
    }
    const model = sniffPrst(f.bytes);
    // File names carry the slot label of the model the file was saved from; bytes that are no preset are reported
    // below, after their slot (named as on the target pedal) is checked.
    const naming = model ?? target;
    const slot = f.slot ?? (naming ? parseSlotFileName(f.fileName, naming)?.slot : null) ?? null;
    if (slot === null || slot < 0 || slot >= profileOrDefault(target ?? model).slotCount) {
      skipped.push(`${f.fileName}: no slot number in the file name`);
      continue;
    }
    if (!model) {
      skipped.push(`${f.fileName}: not a ${PRST_MODELS} preset`);
      continue;
    }
    let prepared: PreparedPreset;
    try {
      prepared = prepareForDevice(f.bytes, target ?? model);
    } catch (e) {
      // Another family's preset (crossFamilyNote) or a file that fails to convert.
      skipped.push(`${f.fileName}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (bySlot.has(slot)) {
      skipped.push(`${f.fileName}: slot ${slot} appears twice`);
      continue;
    }
    const stored = prstName(f.bytes, model);
    const targetEmpty = target ? profileFor(target).emptyName : null;
    if (prepared.converted && targetEmpty !== null && isEmptySlotName(stored, prepared.from)) {
      bySlot.set(slot, { entry: { slot, name: targetEmpty, prst: editPrst(prepared.prst, { name: targetEmpty }) }, conversion: null });
      continue;
    }
    const name = stored || (profileFor(prepared.from).emptyName ?? "");
    const conversion = prepared.converted ? { slot, name, from: prepared.from, dropped: prepared.dropped } : null;
    bySlot.set(slot, { entry: { slot, name, prst: prepared.prst }, conversion });
  }
  const sorted = [...bySlot.values()].sort((a, b) => a.entry.slot - b.entry.slot);
  return {
    entries: sorted.map((s) => s.entry),
    converted: sorted.flatMap((s) => (s.conversion ? [s.conversion] : [])),
    skipped,
  };
}

/** "Slots 00–99", "Slots 00–04 and 07", "Slot 12" with the pedal's `label` per slot ("01-A–02-D" on a GP-200). */
export function describeSlots(slots: number[], label: (slot: number) => string): string {
  if (!slots.length) return "No slots";
  const runs: [number, number][] = [];
  for (const s of [...slots].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && s === last[1] + 1) last[1] = s;
    else runs.push([s, s]);
  }
  const parts = runs.map(([a, b]) => (a === b ? label(a) : `${label(a)}–${label(b)}`));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${slots.length === 1 ? "Slot" : "Slots"} ${list}`;
}

/**
 * Copy for the Restore dialog when the pedal already holds every slot of the backup, so "Write only changed slots" has
 * nothing to write. Nothing on the pedal would change, so there is no loss to warn about.
 */
export function alreadyMatchesCopy(pedal: string): { title: string; description: string } {
  return {
    title: `The ${pedal} already matches this backup`,
    description: "Every slot holds the same preset as this backup, so restoring would change nothing. Choose Write all to replace every slot anyway.",
  };
}
