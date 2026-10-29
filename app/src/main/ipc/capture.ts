import { app, shell, type BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CaptureDraft, CaptureKey, CaptureRecipe, CaptureState, CaptureVersion } from "@shared/host/capture";
import type { ToneRecord } from "@shared/host/tones";
import { HostError } from "@shared/ipc";
import { handle, showSaveDialog } from "./handle";
import { writeJsonAtomic } from "./fs-atomic";

// Layout: see src/shared/host/capture.ts. Tones' files (meta.json, <model_id>.nam) are only read here.
const userData = () => app.getPath("userData");
const MAX_NAM_BYTES = 64 * 1024 * 1024;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Refs are either a TONE3000 tone id or "file-<16 hex>"; anything else could escape userData. */
function refDir(ref: unknown): { kind: "tone" | "file"; dir: string } {
  if (typeof ref === "string" && /^\d{1,12}$/.test(ref)) return { kind: "tone", dir: join(userData(), "tones", ref) };
  if (typeof ref === "string" && /^file-[0-9a-f]{16}$/.test(ref)) return { kind: "file", dir: join(userData(), "captures", ref) };
  throw new HostError("invalid", "Unknown capture");
}

function versionsDir(key: CaptureKey): string {
  const { kind, dir } = refDir(key.ref);
  if (kind === "file") return join(dir, "versions");
  if (!Number.isInteger(key.modelId)) throw new HostError("invalid", "Unknown TONE3000 model");
  return join(dir, "versions", String(key.modelId));
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Minimal shape check so main never stores arbitrary files as captures; the renderer parses fully. */
function assertNamText(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HostError("invalid", "This file isn't valid JSON, so it can't be a NAM capture.");
  }
  const j = json as { architecture?: unknown; weights?: unknown };
  if (typeof j !== "object" || j === null || typeof j.architecture !== "string" || !Array.isArray(j.weights)) {
    throw new HostError("invalid", "This file isn't a NAM capture.");
  }
}

async function importText(fileName: string, text: string): Promise<string> {
  if (typeof text !== "string" || text.length > MAX_NAM_BYTES) throw new HostError("invalid", "This file is too large to be a NAM capture.");
  assertNamText(text);
  const ref = `file-${sha256(text).slice(0, 16)}`;
  const { dir } = refDir(ref);
  await mkdir(dir, { recursive: true });
  const original = join(dir, "original.nam");
  if (!(await exists(original))) await writeFile(original, text, "utf8");
  await writeJsonAtomic(join(dir, "source.json"), { fileName: basename(String(fileName)), importedAt: new Date().toISOString() });
  return ref;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** The downloaded model of a tone to edit: the requested one, else the A2 model, else the first on disk. */
async function toneModel(dir: string, modelId: number | null | undefined): Promise<{ modelId: number; path: string; fileName: string }> {
  const record = await readJson<ToneRecord>(join(dir, "meta.json"));
  const onDisk = new Set((await readdir(dir).catch(() => [] as string[])).filter((n) => /^\d+\.nam$/.test(n)));
  const models = (record?.models ?? []).filter((m) => onDisk.has(`${m.id}.nam`));
  const pick =
    modelId != null
      ? (models.find((m) => m.id === modelId) ?? (onDisk.has(`${modelId}.nam`) ? { id: modelId, name: `${modelId}` } : undefined))
      : (models.find((m) => m.architecture === "2") ?? models[0] ?? [...onDisk].map((n) => ({ id: Number(n.slice(0, -4)), name: n }))[0]);
  if (!pick) throw new HostError("not-found", "No model of this tone is downloaded yet.");
  return { modelId: pick.id, path: join(dir, `${pick.id}.nam`), fileName: `${pick.name}.nam` };
}

async function listVersions(dir: string): Promise<CaptureVersion[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^v\d+\.json$/.test(n));
  const versions = await Promise.all(names.map((n) => readJson<CaptureVersion>(join(dir, n))));
  return versions.filter((v): v is CaptureVersion => v !== null).sort((a, b) => a.n - b.n);
}

async function open(ref: string, modelId?: number | null): Promise<CaptureState> {
  const { kind, dir } = refDir(ref);
  let text: string;
  let fileName: string;
  let key: CaptureKey;
  if (kind === "tone") {
    const model = await toneModel(dir, modelId);
    text = await readFile(model.path, "utf8");
    fileName = model.fileName;
    key = { ref, modelId: model.modelId };
  } else {
    text = await readFile(join(dir, "original.nam"), "utf8");
    fileName = (await readJson<{ fileName: string }>(join(dir, "source.json")))?.fileName ?? "capture.nam";
    key = { ref, modelId: null };
  }
  const sha = sha256(text);
  const vdir = versionsDir(key);
  // Versions made from a different original (e.g. the tone's file was re-downloaded) don't apply to this one.
  const versions = (await listVersions(vdir)).filter((v) => v.base === sha);
  const draft = await readJson<CaptureDraft>(join(vdir, "draft.json"));
  return { source: { ...key, kind, fileName, sha256: sha, text }, versions, draft };
}

async function saveVersion(key: CaptureKey, input: { recipe: CaptureRecipe; summary: string; restoredFrom?: number; file: string }): Promise<CaptureVersion> {
  assertNamText(input.file);
  const state = await open(key.ref, key.modelId);
  const vdir = versionsDir(key);
  await mkdir(vdir, { recursive: true });
  const all = await listVersions(vdir);
  const n = all.reduce((max, v) => Math.max(max, v.n), 0) + 1;
  const version: CaptureVersion = {
    n,
    createdAt: new Date().toISOString(),
    base: state.source.sha256,
    recipe: input.recipe,
    summary: String(input.summary).slice(0, 300),
    ...(input.restoredFrom ? { restoredFrom: input.restoredFrom } : {}),
  };
  await writeFile(join(vdir, `v${n}.nam`), input.file, "utf8");
  await writeJsonAtomic(join(vdir, `v${n}.json`), version);
  await rm(join(vdir, "draft.json"), { force: true });
  return version;
}

async function deleteVersion(key: CaptureKey, n: number): Promise<void> {
  if (!Number.isInteger(n) || n < 1) throw new HostError("invalid", "The original can't be deleted");
  const vdir = versionsDir(key);
  await rm(join(vdir, `v${n}.json`), { force: true });
  await rm(join(vdir, `v${n}.nam`), { force: true });
}

async function saveDraft(key: CaptureKey, draft: CaptureDraft | null): Promise<void> {
  const vdir = versionsDir(key);
  if (draft === null) return rm(join(vdir, "draft.json"), { force: true });
  await mkdir(vdir, { recursive: true });
  await writeJsonAtomic(join(vdir, "draft.json"), draft);
}

/** File names we write: no path separators, `.nam` extension. */
function safeNamName(name: unknown): string {
  const base = basename(String(name ?? ""))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim();
  if (!base) throw new HostError("invalid", "The file needs a name");
  return /\.nam$/i.test(base) ? base : `${base}.nam`;
}

export function registerCaptureIpc(getWindow: () => BrowserWindow | null): void {
  handle("capture:importFile", async (_e, path: string) => {
    if (typeof path !== "string" || !/\.nam$/i.test(path)) throw new HostError("invalid", "Only .nam files can be opened here");
    if ((await stat(path)).size > MAX_NAM_BYTES) throw new HostError("invalid", "This file is too large to be a NAM capture.");
    return importText(basename(path), await readFile(path, "utf8"));
  });
  handle("capture:importText", (_e, fileName: string, text: string) => importText(fileName, text));
  handle("capture:open", (_e, ref: string, modelId?: number | null) => open(ref, modelId));
  handle("capture:saveVersion", (_e, key: CaptureKey, input: Parameters<typeof saveVersion>[1]) => saveVersion(key, input));
  handle("capture:deleteVersion", (_e, key: CaptureKey, n: number) => deleteVersion(key, n));
  handle("capture:saveDraft", (_e, key: CaptureKey, draft: CaptureDraft | null) => saveDraft(key, draft));
  handle("capture:showFiles", async (_e, key: CaptureKey) => {
    const vdir = versionsDir(key);
    const target = (await exists(vdir)) ? vdir : refDir(key.ref).dir;
    shell.showItemInFolder(target);
  });
  handle("capture:exportFile", async (_e, suggestedName: string, text: string) => {
    assertNamText(text);
    const win = getWindow();
    const options = {
      title: "Export NAM capture",
      defaultPath: join(app.getPath("downloads"), safeNamName(suggestedName)),
      filters: [{ name: "NAM capture", extensions: ["nam"] }],
    };
    const res = await showSaveDialog(win, options);
    if (res.canceled || !res.filePath) return null;
    await writeFile(res.filePath, text, "utf8");
    return res.filePath;
  });
}
