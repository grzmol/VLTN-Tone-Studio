// Shared write helpers: the "Back up slot first" snapshot and user-facing error copy.
import { host } from "@/host";
import { sha256Hex } from "@shared/host/song";
import { DeviceError, useDevice } from "@/state/device";
import { pedalName, slotLabel } from "@/state/device-model";
import { emptyName } from "@/screens/library/store";
import { REPLACED_ID, type LocalPreset } from "@shared/host/files";

/** Where the "back up first" copy of a slot comes from. */
export type BackupSource =
  | { kind: "saved"; prst: Uint8Array }
  | { kind: "pedal" }
  /** `stale`: the copy's bytes aren't what the store last saw in the slot (or it saw none), so the pedal may hold newer ones */
  | { kind: "backup"; prst: Uint8Array; at: string; stale: boolean }
  | { kind: "none"; reason: string };

/**
 * The active slot uses its saved body (not the live edits). Other slots are read from the pedal: the export read
 * (GP-50) leaves the active preset alone; otherwise reading switches presets, which would drop unsaved edits, so
 * the newest backup's copy is used when its name still matches, flagged `stale` unless its bytes are the ones the store
 * last saw in that slot (a preset saved under the same name since the backup would otherwise look current).
 */
export async function resolveBackupSource(slot: number): Promise<BackupSource> {
  const d = useDevice.getState();
  if (d.slot === slot && d.saved) return { kind: "saved", prst: d.saved.prst };
  if (d.unsavedChanges === 0 || d.can("exportPreset")) return { kind: "pedal" };
  const name = d.names[slot]?.name;
  // Only a backup of this pedal's model can stand in for its slot.
  const newest = (await host.files.listCollections().catch(() => [])).find((c) => c.kind === "backup" && c.device === d.device);
  const copy = newest ? (await host.files.listPresets(newest.id).catch(() => [])).find((p) => p.slot === slot) : undefined;
  if (newest && copy && copy.name === name) {
    const stale = (await sha256Hex(copy.prst)) !== d.slotHashes.get(slot);
    return { kind: "backup", prst: copy.prst, at: newest.createdAt, stale };
  }
  return { kind: "none", reason: `Reading slot ${slotLabel(d.device, slot)} would drop your unsaved changes, and no backup has its current preset.` };
}

/** Save what is in `slot` now to the "Replaced presets" collection. */
export async function backUpSlot(slot: number, source?: BackupSource): Promise<LocalPreset> {
  const src = source ?? (await resolveBackupSource(slot));
  if (src.kind === "none") throw new Error(src.reason);
  const d = useDevice.getState();
  const name = d.names[slot]?.name ?? emptyName();
  const prst = src.kind === "pedal" ? await d.readPreset(slot) : src.prst;
  const [saved] = await host.files.addPresets(REPLACED_ID, [{ name, prst, slot, source: `Slot ${slotLabel(d.device, slot)} on ${pedalName(d.device)}` }]);
  return saved;
}

/** Plain-language reason for a failed pedal or file operation. */
export function describeError(e: unknown, slot?: number): string {
  const { device } = useDevice.getState();
  const pedal = pedalName(device);
  const err: { code?: string; message?: string } | null = e && typeof e === "object" ? e : null;
  const where = slot === undefined ? "The slot" : `Slot ${slotLabel(device, slot)}`;
  // Mid-sentence: only the first letter drops, GP-200 labels keep theirs ("slot 12-C")
  const inSentence = where[0].toLowerCase() + where.slice(1);
  switch (err?.code) {
    case "unsaved":
      return "This switches presets on the pedal, which would drop your unsaved changes. Save or discard them on the Rig first.";
    case "busy":
      return err.message ?? "Wait until the current pedal job finishes.";
    case "not-connected":
    case "closed":
      return `The ${pedal} isn't connected. Connect it and try again.`;
    case "timeout":
      return `The ${pedal} stopped answering. ${where} was not changed. Check the USB cable and try again.`;
    case "verify":
      if (/unchanged|acknowledged/.test(err.message ?? "")) return `The ${pedal} didn't acknowledge every frame and discarded the write. ${where} was not changed.`;
      // The GP-200 family acknowledges no frames: when its read-back stays silent, the write may or may not have landed.
      if (/did not answer/.test(err.message ?? "")) return `The ${pedal} didn't answer when Tone Studio read ${inSentence} back, so the write isn't confirmed. Retry, or restore ${inSentence} from the backup.`;
      return `The read-back differs from what was sent. Retry, or restore ${inSentence} from the backup.`;
    case "length":
    case "unsafe":
      // The store's own refusals (a locked feature, a preset without EXP settings) are already plain language.
      return e instanceof DeviceError ? e.message : "Tone Studio stopped this write because the data looked wrong. Nothing was sent.";
    case "unsupported":
      return err.message ?? "This needs the desktop app.";
    default:
      return err?.message || String(e);
  }
}
