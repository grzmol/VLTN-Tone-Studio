import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeError } from "@/app/notify";
import { host } from "@/host";
import { useDevice, useProfile } from "@/state/device";
import { pedalName } from "@/state/device-model";
import type { BackupEntry } from "@/state/device-types";
import type { CollectionInfo } from "@shared/host/files";
import { classifySlots, type SlotComparison } from "@/screens/device/compare";
import { CompareList } from "@/screens/device/CompareList";

interface Result {
  source: BackupEntry[];
  pedal: BackupEntry[];
  rows: SlotComparison[];
}

/**
 * Compare with pedal: each slot of a backup against what the connected pedal holds now. Read-only; nothing is written.
 * `collection` null closes it. Refuses when the pedal isn't connected, is another model, or has unsaved changes.
 */
export function ComparePedalDialog({ collection, onOpenChange }: { collection: CollectionInfo | null; onOpenChange: (open: boolean) => void }) {
  const { slotLabel } = useProfile();
  const busy = useDevice((s) => s.busy);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const id = collection?.id ?? null;

  useEffect(() => {
    setResult(null);
    setError(null);
    if (!collection) return;
    void compare(collection);
    // One read per opened backup: `collection` changes identity only when another one is opened.
  }, [id]);

  if (!collection) return null;

  async function compare(c: CollectionInfo) {
    const d = useDevice.getState();
    if (d.status !== "connected" || !d.device) {
      setError("Connect the pedal to compare this backup with it.");
      return;
    }
    if (c.device && c.device !== d.device) {
      setError(`This backup is from a ${pedalName(c.device)}, and the connected pedal is a ${pedalName(d.device)}. Compare with a backup of the same model.`);
      return;
    }
    if (d.unsavedChanges > 0) {
      const changes = `${d.unsavedChanges} unsaved ${d.unsavedChanges === 1 ? "change" : "changes"}`;
      setError(`The Rig has ${changes}. Save or discard them first. Reading the pedal would drop them.`);
      return;
    }
    setReading(true);
    try {
      const presets = await host.files.listPresets(c.id);
      const source = presets.flatMap((p) => (p.slot === null ? [] : [{ slot: p.slot, name: p.name, prst: p.prst }]));
      const pedal = await d.backupAll();
      setResult({ source, pedal, rows: classifySlots(source, pedal, d.device) });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setReading(false);
    }
  }

  const device = useDevice.getState().device;

  return (
    <AlertDialog open onOpenChange={(open) => !reading && onOpenChange(open)}>
      <AlertDialogContent className="sm:max-w-[560px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Compare {collection.title} with the pedal</AlertDialogTitle>
          <AlertDialogDescription>
            Each slot of this backup against what the pedal holds now. Nothing is written. {reading ? (busy?.label ?? "Reading the pedal") : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div role="alert" className="rounded-lg bg-well px-3.5 py-3 text-sm text-pretty text-silkscreen-2">
            {error}
          </div>
        )}

        {result && device && <CompareList rows={result.rows} source={result.source} pedal={result.pedal} device={device} slotLabel={slotLabel} />}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={reading}>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
