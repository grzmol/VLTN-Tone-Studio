// Local tone records: `<tonesDir>/<tone_id>/meta.json` plus the downloaded model files beside it.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SlotLink, T3kModel, T3kTone, ToneRecord } from "@shared/host/tones";
import { isDeviceKey } from "@shared/devices";
import { HostError } from "@shared/ipc";
import { modelsVerdict } from "@shared/tone3000";
import { writeJsonAtomic } from "../ipc/fs-atomic";

export const metaPath = (tonesDir: string, toneId: number) => join(tonesDir, String(toneId), "meta.json");

export async function readRecord(tonesDir: string, toneId: number): Promise<ToneRecord | null> {
  try {
    return JSON.parse(await readFile(metaPath(tonesDir, toneId), "utf8")) as ToneRecord;
  } catch {
    return null;
  }
}

/** Atomic write, so a crash never leaves half a meta.json. */
export async function writeRecord(tonesDir: string, record: ToneRecord): Promise<ToneRecord> {
  await writeJsonAtomic(metaPath(tonesDir, record.tone_id), record);
  return record;
}

/**
 * Merge TONE3000 metadata and (optionally) a downloaded model into the record, keeping slot links
 * and earlier downloads.
 */
export function buildRecord(
  previous: ToneRecord | null,
  tone: T3kTone,
  models: T3kModel[] | null,
  download: { model: T3kModel; file: string; bytes: number; reshaped?: boolean } | null,
  now: Date,
): ToneRecord {
  const kept = (previous?.models ?? []).filter((m) => m.id !== download?.model.id);
  const added = download
    ? [{ id: download.model.id, name: download.model.name, size: download.model.size, architecture: download.model.architecture_version, file: download.file, bytes: download.bytes }]
    : [];
  const prevGp5 = previous?.gp5;
  let verdict = models ? modelsVerdict(tone.format, models).kind : (prevGp5?.verdict ?? (tone.format === "ir" ? "ir" : "ready"));
  if (download?.reshaped) verdict = "reshape";
  else if (download?.reshaped === false && verdict === "reshape") verdict = "ready";
  else if (prevGp5?.verdict === "reshape" && verdict === "ready") verdict = "reshape";
  return {
    tone_id: tone.id,
    title: tone.title,
    gear: tone.gear,
    format: tone.format,
    creator: { username: tone.user.username, avatar_url: tone.user.avatar_url },
    image_url: tone.images?.[0] ?? null,
    license: tone.license,
    url: tone.url,
    models: [...kept, ...added],
    gp5: { ...prevGp5, verdict },
    savedAt: now.toISOString(),
  };
}

/** Set (or with null, clear) the record's slot link. A link replaces the previous one, whichever pedal it was on. */
export function linkRecord(record: ToneRecord, link: SlotLink | null, now: Date): ToneRecord {
  const { snaptoneSlot: _s, irSlot: _i, slotName: _n, linkedAt: _l, device: _d, ...rest } = record.gp5;
  if (!link) return { ...record, gp5: rest };
  // The link comes over IPC: refuse a model the registry doesn't know rather than guess one.
  if (!isDeviceKey(link.device)) throw new HostError("invalid", `Unknown pedal model ${JSON.stringify(link.device)}`);
  const slot = link.kind === "snaptone" ? { snaptoneSlot: link.slot } : { irSlot: link.slot };
  return { ...record, gp5: { ...rest, ...slot, slotName: link.slotName, linkedAt: now.toISOString(), device: link.device } };
}

/** Every readable record under tonesDir (folders without a valid meta.json are skipped). */
export async function listRecords(tonesDir: string): Promise<ToneRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(tonesDir);
  } catch {
    return [];
  }
  const ids = entries.filter((e) => /^\d+$/.test(e)).map(Number);
  const records = await Promise.all(ids.map((id) => readRecord(tonesDir, id)));
  return records.filter((r): r is ToneRecord => r !== null);
}
