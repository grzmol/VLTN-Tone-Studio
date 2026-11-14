import { bandChartKey, bandOptionsKey } from "./dependencies";
export interface RhythmExportRecord {
  input: string;
  exportedAt: string;
}
export interface RhythmTransferRecord {
  version: 1;
  exported: RhythmExportRecord;
  confirmed?: RhythmExportRecord & { memory: number; userSlot: number; confirmedAt: string };
}
function options(settings: Record<string, string>): Record<string, unknown> {
  try {
    const value = JSON.parse(settings[":options"] || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
/** Exact musical input revision. Mix, display, trim-only and cue edits do not alter the full-length exported passages. */
export function rhythmInputRevision(settings: Record<string, string>): string {
  const value = options(settings);
  return JSON.stringify([
    settings[":bpm"] ?? "",
    bandChartKey(settings[""] ?? ""),
    bandOptionsKey(value),
    value.rhythmExport,
    (value.rhythmAutomation as { bpm?: unknown } | undefined)?.bpm,
  ]);
}
export function rhythmTransferRecord(settings: Record<string, string>): RhythmTransferRecord | null {
  const record = options(settings).rhythmTransfer as Partial<RhythmTransferRecord> | undefined;
  if (record?.version !== 1 || typeof record.exported?.input !== "string" || typeof record.exported.exportedAt !== "string") return null;
  return record as RhythmTransferRecord;
}
export function rhythmTransferStatus(settings: Record<string, string>, memory: number): "Needs export" | "Needs transfer confirmation" | "Transfer confirmed" {
  const record = rhythmTransferRecord(settings);
  if (!record || record.exported.input !== rhythmInputRevision(settings) || options(settings).bandOutOfDate === true) return "Needs export";
  return record.confirmed?.input === record.exported.input &&
    record.confirmed.exportedAt === record.exported.exportedAt &&
    record.confirmed.memory === memory &&
    Number.isInteger(record.confirmed.userSlot) &&
    record.confirmed.userSlot >= 1 &&
    record.confirmed.userSlot <= 50
    ? "Transfer confirmed"
    : "Needs transfer confirmation";
}
/** Exporting a new file always requires a new explicit transfer confirmation, even with identical musical inputs. */
export function recordRhythmExport(settings: Record<string, string>, exportedAt = new Date().toISOString()): RhythmTransferRecord {
  return { version: 1, exported: { input: rhythmInputRevision(settings), exportedAt } };
}
export function confirmRhythmTransfer(settings: Record<string, string>, memory: number, userSlot: number): RhythmTransferRecord {
  if (!Number.isInteger(memory) || memory < 1 || memory > 99 || !Number.isInteger(userSlot) || userSlot < 1 || userSlot > 50)
    throw new Error("Choose phrase memory 1–99 and User rhythm 1–50.");
  if (rhythmTransferStatus(settings, memory) === "Needs export") throw new Error("Export the current drum rhythm before confirming its transfer.");
  const record = rhythmTransferRecord(settings)!;
  return { ...record, confirmed: { ...record.exported, memory, userSlot, confirmedAt: new Date().toISOString() } };
}
