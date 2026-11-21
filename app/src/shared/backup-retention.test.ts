import { describe, expect, it } from "vitest";
import { backupsToPrune, type RetainableBackup } from "./backup-retention";

const now = new Date("2026-10-29T12:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
/** Backups `n` days old, newest first (index 0 is today). */
const backups = (ages: number[], pinned: number[] = []): RetainableBackup[] => ages.map((age, i) => ({ id: `b${i}`, createdAt: day(age), pinned: pinned.includes(i) }));

describe("backupsToPrune", () => {
  it("prunes nothing when every backup is kept", () => {
    expect(backupsToPrune(backups([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), "all", now)).toEqual([]);
  });

  it("keeps the newest 10 and moves the oldest beyond them", () => {
    const list = backups([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(backupsToPrune(list, "10", now).map((b) => b.id)).toEqual(["b10"]);
  });

  it("keeps the newest 30", () => {
    const list = backups(Array.from({ length: 32 }, (_, i) => i));
    expect(backupsToPrune(list, "30", now).map((b) => b.id)).toEqual(["b31", "b30"]);
  });

  it("never prunes a pinned backup, and pinned ones don't count toward the number kept", () => {
    const list = backups([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [11]);
    expect(backupsToPrune(list, "10", now).map((b) => b.id)).toEqual(["b10"]);
    const oldPinned = backups([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [11, 12]);
    expect(backupsToPrune(oldPinned, "10", now).map((b) => b.id)).toEqual(["b10"]);
  });

  it("prunes unpinned backups older than 90 days, oldest first, and keeps pinned old ones", () => {
    const list = backups([1, 60, 91, 200, 150], [4]);
    expect(backupsToPrune(list, "90d", now).map((b) => b.id)).toEqual(["b3", "b2"]);
  });

  it("uses the backup's own time, not the order it was given in", () => {
    const shuffled = [backups([5])[0], { id: "new", createdAt: day(0), pinned: false }, { id: "old", createdAt: day(20), pinned: false }];
    expect(backupsToPrune(shuffled, "10", now)).toEqual([]);
    expect(backupsToPrune(shuffled, "90d", now)).toEqual([]);
  });
});
