import { mkdir, open as openFile, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import { ALGORITHM_XML, MAX_XML_BYTES, decodeXmlText, parseStoredCatalog, storedCatalogFile, type Gp200XmlFile, type StoredGp200Catalog } from "@shared/host/gp200-catalog";
import { HostError } from "@shared/ipc";

// The GP-200 effect catalog (see src/shared/host/gp200-catalog.ts): find or pick the editor's algorithm.xml, and keep
// the catalog the renderer built from it in userData/gp200/catalog.json. Valeton's data stays on this computer.

/** The file inside an editor install folder (Windows installer layout, also an unpacked copy on Linux). */
const IN_INSTALL = ["Resource", "GP-200", "File", ALGORITHM_XML];
/** Install folders under Program Files (the installer's default is not documented, so the likely names). */
const EDITOR_DIRS = [
  ["Valeton", "GP-200"],
  ["GP-200"],
  ["Hotone", "GP-200"],
];
/** macOS: Resource.pkg installs the data here; the app bundle may carry a copy. */
const MAC_DATA = ["Library", "Application Support", "Valeton", "GP-200", "File", ALGORITHM_XML];
const MAC_BUNDLE_FILES = [["Contents", "Resources", ALGORITHM_XML], ["Contents", "Resources", "File", ALGORITHM_XML], ["Contents", "Resources", ...IN_INSTALL]];

export interface LocateEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}

/** Sub-folders of `dir` (none when it doesn't exist). */
async function subdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
}

/** Wine prefixes on Linux: $WINEPREFIX, ~/.wine, and the prefixes of common launchers. */
async function winePrefixes({ env, home }: LocateEnv): Promise<string[]> {
  const managed = await Promise.all(
    [join(home, ".local", "share", "wineprefixes"), join(home, ".local", "share", "bottles", "bottles"), join(home, "Games")].map(subdirs),
  );
  return [env.WINEPREFIX, join(home, ".wine"), ...managed.flat()].filter((p): p is string => Boolean(p));
}

/** Every place an installed GP-200 editor may keep algorithm.xml, most likely first. */
export async function algorithmXmlCandidates(where: LocateEnv): Promise<string[]> {
  const { platform, env, home } = where;
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432, env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs")];
    const unique = [...new Set(roots.filter((r): r is string => Boolean(r)))];
    return unique.flatMap((root) => EDITOR_DIRS.map((dir) => win32.join(root, ...dir, ...IN_INSTALL)));
  }
  if (platform === "darwin") {
    const bundles = ["/Applications/GP-200.app", posix.join(home, "Applications", "GP-200.app")];
    return [posix.join("/", ...MAC_DATA), posix.join(home, ...MAC_DATA), ...bundles.flatMap((b) => MAC_BUNDLE_FILES.map((f) => posix.join(b, ...f)))];
  }
  const programFiles = (await winePrefixes(where)).flatMap((prefix) => ["Program Files", "Program Files (x86)"].map((pf) => join(prefix, "drive_c", pf)));
  const native = [join(home, "GP-200"), join(home, ".local", "share", "Valeton", "GP-200"), "/opt/GP-200", "/opt/Valeton/GP-200"];
  return [...programFiles.flatMap((root) => EDITOR_DIRS.map((dir) => join(root, ...dir, ...IN_INSTALL))), ...native.map((dir) => join(dir, ...IN_INSTALL))];
}

/** The first candidate that is a file, or null. */
export async function findAlgorithmXml(candidates: readonly string[]): Promise<string | null> {
  for (const path of candidates) {
    const s = await stat(path).catch(() => null);
    if (s?.isFile()) return path;
  }
  return null;
}

/** Read and decode `path` (size-capped). Throws HostError("invalid") when it is too big or no XML text. */
export async function readAlgorithmXml(path: string): Promise<Gp200XmlFile> {
  const file = await openFile(path, "r");
  try {
    if ((await file.stat()).size > MAX_XML_BYTES) throw new HostError("invalid", `This file is too big to be the GP-200 editor's ${ALGORITHM_XML}.`);
    try {
      return { path, text: decodeXmlText(new Uint8Array(await file.readFile())) };
    } catch (e) {
      throw new HostError("invalid", e instanceof Error ? e.message : String(e));
    }
  } finally {
    await file.close();
  }
}

/** The kept catalog in `<root>/gp200/catalog.json` (root = userData). */
export class Gp200CatalogStore {
  readonly #file: string;

  constructor(root: string) {
    this.#file = join(root, "gp200", "catalog.json");
  }

  async load(): Promise<StoredGp200Catalog | null> {
    const text = await readFile(this.#file, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    return text === null ? null : parseStoredCatalog(text);
  }

  /** Written to a temporary file first, so a crash never leaves half a catalog. */
  async save(catalog: unknown, source: string, now = new Date()): Promise<StoredGp200Catalog> {
    const { kept, text } = storedCatalogFile(catalog, source, now);
    await mkdir(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, this.#file);
    return kept;
  }

  async remove(): Promise<void> {
    await rm(this.#file, { force: true });
  }
}
