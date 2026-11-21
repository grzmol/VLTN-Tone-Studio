// "Keep backups": which backups of one pedal model the retention setting moves to the Trash. Pure, so the desktop app
// (which owns the folders) and the tests share one rule. A pinned backup is never pruned and doesn't count toward the
// number kept, so pinning a backup never pushes another one out.

export const BACKUP_RETENTIONS = ["all", "10", "30", "90d"] as const;
export type BackupRetention = (typeof BACKUP_RETENTIONS)[number];

export const RETENTION_LABELS: Record<BackupRetention, string> = {
  all: "Keep every backup",
  "10": "Keep the newest 10 per pedal",
  "30": "Keep the newest 30 per pedal",
  "90d": "Keep the last 90 days",
};

const DAY_MS = 86_400_000;

export interface RetainableBackup {
  id: string;
  /** ISO timestamp */
  createdAt: string;
  pinned: boolean;
}

/**
 * The backups `policy` no longer keeps, oldest first. "10" and "30" keep that many unpinned backups, newest first; "90d"
 * prunes unpinned backups made more than 90 days before `now`. "all" prunes nothing.
 */
export function backupsToPrune<T extends RetainableBackup>(backups: readonly T[], policy: BackupRetention, now: Date): T[] {
  if (policy === "all") return [];
  const unpinned = backups.filter((b) => !b.pinned);
  if (policy === "90d") {
    const cutoff = now.getTime() - 90 * DAY_MS;
    return unpinned.filter((b) => Date.parse(b.createdAt) < cutoff).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  const newestFirst = [...unpinned].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return newestFirst.slice(Number(policy)).reverse();
}
