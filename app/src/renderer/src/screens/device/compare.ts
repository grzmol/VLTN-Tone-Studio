// Compare a backup's presets with the pedal's, slot by slot, before a restore or a bulk write. Two copies of one preset
// can differ in bytes the pedal rewrites when it saves or reads back (the slot number in the header, a checksum), so
// normalizeForCompare zeroes those per model first. An unchanged slot then compares as "same" even when the file on
// the pedal was rewritten. Each model's volatile bytes come from its toolkit codec (the GP-200 family's from its
// volatileMask, the GP-150's from its OFFSET table); the GP-5 family has only the CRC byte, which is derived from the
// rest of the file. The GP-5 family's normalisation is from the code and fixtures only, so Status records it for
// hardware review.
import { CRC_OFF } from "@/gp5/lib/prst.mjs";
import { imageOf, volatileMask } from "@/gp200/lib/prst.mjs";
import { OFFSET as GP150_OFFSET } from "@/gp150/lib/prst.mjs";
import { profileFor, type DeviceKey } from "@shared/devices";
import { isEmptySlotName } from "@/state/device-model";
import type { BackupEntry } from "@/state/device-types";

/** same: identical after normalising. changed: same name, other bytes. different: other name. empty: one side has no preset. */
export type SlotState = "same" | "changed" | "different" | "empty";

export interface SlotComparison {
  slot: number;
  state: SlotState;
  /** The backup's preset name */
  name: string;
  /** The pedal's preset name, "" when the pedal has no entry for the slot */
  pedalName: string;
}

const range = (from: number, length: number) => Array.from({ length }, (_, i) => from + i);

const zeroed = (bytes: Uint8Array, offsets: number[]): Uint8Array => {
  const out = bytes.slice();
  for (const o of offsets) out[o] = 0;
  return out;
};

/**
 * `prst` as the pedal would hold it for comparison: the bytes the pedal rewrites on save are zeroed. GP-5 and GP-50: the
 * CRC byte. GP-200 family: the image (slot mirrors, dead bytes, CTRL junk) with its volatile bytes zeroed, the file's
 * own position word and byte sum left out. GP-150 and GP-180: the slot number, the length field and the checksum.
 * Throws for bytes that are no preset of `device`'s family.
 */
export function normalizeForCompare(prst: Uint8Array, device: DeviceKey): Uint8Array {
  const family = profileFor(device).family;
  if (family === "gp5") return zeroed(prst, [CRC_OFF]);
  if (family === "gp150") {
    const volatile = [...range(GP150_OFFSET.SLOT, 4), ...range(GP150_OFFSET.BODY_LEN, 2), ...range(GP150_OFFSET.CHECKSUM, 2)];
    return zeroed(prst, volatile);
  }
  const image = imageOf(prst).slice();
  const mask = volatileMask(image);
  return image.map((b, i) => (mask[i] ? 0 : b));
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** A preset name that reads as an empty slot on `device` (the pedal's own empty name, or a blank name). */
export const isEmptyPreset = (name: string, device: DeviceKey): boolean => !name.trim() || isEmptySlotName(name, device);

/** Whether `state` is a slot a restore would write when only changed slots are written. */
export const isChangedState = (state: SlotState): boolean => state !== "same";

/**
 * Classifies each backup entry against the pedal's entry for the same slot. `pedal` is what the pedal holds now
 * (a fresh backupAll read), `device` the connected pedal's model. Entries keep the backup's order.
 */
export function classifySlots(source: BackupEntry[], pedal: BackupEntry[], device: DeviceKey): SlotComparison[] {
  const onPedal = new Map(pedal.map((e) => [e.slot, e]));
  return source.map((s): SlotComparison => {
    const p = onPedal.get(s.slot);
    const base = { slot: s.slot, name: s.name, pedalName: p?.name ?? "" };
    if (!p) return { ...base, state: "different" };
    if (isEmptyPreset(s.name, device) !== isEmptyPreset(p.name, device)) return { ...base, state: "empty" };
    let equal = false;
    try {
      equal = sameBytes(normalizeForCompare(s.prst, device), normalizeForCompare(p.prst, device));
    } catch {
      // Bytes that don't parse as this model: compare by name below.
    }
    if (equal) return { ...base, state: "same" };
    return { ...base, state: s.name.trim() === p.name.trim() ? "changed" : "different" };
  });
}
