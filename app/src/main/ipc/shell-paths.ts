// Which paths the renderer may pass to shell.openPath and shell.showItemInFolder. Main hands a path out in two ways:
// a dialog result (the user picked it, see handle.ts) and anything under userData (the app's own folders). Any other
// path is refused, so a compromised renderer cannot open or launch an arbitrary file.
import { realpath as realpathFs } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

/** Valeton Suite's default install on macOS. */
export const MAC_SUITE = "/Applications/Valeton Suite.app";

/** Opening one of these runs a program, so openPath refuses them even inside userData. */
const EXECUTABLE_EXTENSIONS = [".app", ".exe", ".bat", ".cmd", ".com", ".command", ".msi", ".pkg", ".sh", ".desktop", ".appimage"];

export interface ShellPathsDeps {
  /** The app's userData folder. A function, so it is read when needed (the app path is not known at import time). */
  userData: () => string;
  realpath?: (path: string) => Promise<string>;
}

/** Registry of paths main handed out, plus the userData check. */
export class ShellPaths {
  private readonly handed = new Set<string>();
  private readonly realpath: (path: string) => Promise<string>;

  constructor(private readonly deps: ShellPathsDeps) {
    this.realpath = deps.realpath ?? realpathFs;
  }

  /** Record a path main gave to the user, e.g. a save or open dialog result. */
  allow(path: string): void {
    this.handed.add(resolve(path));
  }

  /** True for a recorded path, or a path inside userData once symlinks are resolved (so a link out of it is refused). */
  async isAllowed(path: string): Promise<boolean> {
    const full = resolve(path);
    if (this.handed.has(full)) return true;
    const target = await this.realpath(full).catch(() => null);
    const root = await this.realpath(this.deps.userData()).catch(() => null);
    if (!target || !root) return false;
    return isInside(root, target);
  }
}

/** True when `path` is `root` or below it. Both must already be real, absolute paths. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

/**
 * True when opening the path would run something: a program by extension, or (not on Windows) a file with an execute
 * bit. `info` is the path's stat, or null when it could not be read.
 */
export function isExecutable(path: string, info: { isDirectory(): boolean; mode: number } | null, platform: NodeJS.Platform): boolean {
  if (EXECUTABLE_EXTENSIONS.includes(extname(path).toLowerCase())) return true;
  if (platform === "win32" || !info || info.isDirectory()) return false;
  return (info.mode & 0o111) !== 0;
}

/**
 * The Valeton Suite to launch. A path chosen in Settings counts only when it was picked through the file dialog
 * (`suitePathPicked`), so a settings file edited by the renderer cannot point this at another program. With no path
 * set, macOS uses its default install.
 */
export function suiteToLaunch(settings: { valetonSuitePath: string | null; suitePathPicked: boolean }, platform: NodeJS.Platform): string | null {
  if (settings.valetonSuitePath === null) return platform === "darwin" ? MAC_SUITE : null;
  return settings.suitePathPicked ? settings.valetonSuitePath : null;
}
