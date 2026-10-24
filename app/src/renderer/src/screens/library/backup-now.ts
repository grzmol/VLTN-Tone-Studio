// "Back up now": read every slot (backupAll), save them as a backups folder, report. Shared with the Device screen.
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { pedalName } from "@/state/device-model";
import { notifyBackupDone, notifyError } from "@/app/notify";
import type { CollectionInfo } from "@shared/host/files";
import { useLibrary } from "./store";

/** Runs the whole backup with progress (window + taskbar). Resolves with the new backup, or null when it failed. */
export async function runBackupNow(): Promise<CollectionInfo | null> {
  const d = useDevice.getState();
  if (d.status !== "connected") {
    notifyError("Couldn't start the backup", new Error(`The ${pedalName(d.device)} isn't connected. Connect it and try again.`));
    return null;
  }
  if (d.unsavedChanges > 0) {
    const name = d.preset?.name ?? "the current preset";
    notifyError(
      "Save or discard your changes first",
      new Error(`A backup steps through every preset on the pedal, which would drop your ${d.unsavedChanges} unsaved changes to ${name}.`),
    );
    return null;
  }
  useLibrary.setState({ backupStartedAt: Date.now() });
  try {
    const entries = await d.backupAll({ onProgress: (f) => void host.app.setProgress(f).catch(() => {}) });
    const info = await host.files.saveBackup(entries, d.device ?? undefined);
    useLibrary.getState().noteBackup(info, entries);
    await useLibrary.getState().refreshCollections();
    notifyBackupDone({ folder: info.id.slice(info.id.indexOf("/") + 1), path: info.path, count: entries.length });
    return info;
  } catch (e) {
    notifyError("Backup didn't finish", e, async () => void (await runBackupNow()));
    return null;
  } finally {
    useLibrary.setState({ backupStartedAt: null });
    void host.app.setProgress(null).catch(() => {});
  }
}
