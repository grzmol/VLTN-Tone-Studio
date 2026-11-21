// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInContext, createContext } from "node:vm";
import { build, type Plugin } from "esbuild";

// Every worker must load where there is no `window`, `document` or `localStorage`. A worker that imports the song settings or the host
// (both reach for `window`) fails at load, before it reads its first message, so every job sent to it fails. The lyrics worker did
// exactly that. This test bundles each worker the app starts and runs the bundle's top level in a worker-like scope.

const root = dirname(fileURLToPath(import.meta.url));
const shared = resolve(root, "../../shared");

/** What a worker throws when it touches a global that only a page has. */
const MISSING_PAGE_GLOBAL = /\b(window|document|localStorage|sessionStorage) is not defined/;

/** Every source file that starts a worker, and the worker files it starts. */
async function workerEntries(): Promise<string[]> {
  const found = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        const text = await readFile(path, "utf8");
        for (const match of text.matchAll(/new Worker\(\s*new URL\("([^"]+\.ts)"/g)) found.add(resolve(dirname(path), match[1]));
      }
    }
  };
  await walk(root);
  return [...found].sort();
}

/** Resolves the app's aliases, and stands in for packages and asset URLs: only the app's own modules are loaded for real. */
const aliasesAndStubs: Plugin = {
  name: "aliases-and-stubs",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => ({ path: resolve(root, args.path.slice(2)) + (/\.[a-z]+$/.test(args.path) ? "" : ".ts") }));
    b.onResolve({ filter: /^@shared\// }, (args) => ({ path: resolve(shared, args.path.slice(8)) + ".ts" }));
    b.onResolve({ filter: /\?/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents:
        "const stub = new Proxy(function () {}, { get: (t, k) => (k === '__esModule' ? false : stub), apply: () => stub, construct: () => stub });" +
        " module.exports = stub;",
      loader: "js",
    }));
  },
};

/** A scope like a dedicated worker's: `self` and the timers, and no `window`, `document` or `localStorage`. */
function workerScope() {
  const scope: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    performance,
    TextEncoder,
    TextDecoder,
    URL,
    WebAssembly,
    Atomics,
    SharedArrayBuffer,
    navigator: { hardwareConcurrency: 4 },
    postMessage: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  scope.self = scope;
  scope.globalThis = scope;
  return createContext(scope);
}

describe("workers", () => {
  it("finds the workers the app starts", async () => {
    const entries = await workerEntries();
    expect(entries.some((path) => path.endsWith("performance/lyrics-worker.ts"))).toBe(true);
    expect(entries.length).toBeGreaterThan(10);
  });

  it("load every worker without window, document or localStorage", async () => {
    const failures: string[] = [];
    for (const entry of await workerEntries()) {
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        logLevel: "silent",
        plugins: [aliasesAndStubs],
      });
      try {
        runInContext(result.outputFiles[0].text, workerScope(), { filename: entry });
      } catch (error) {
        // Packages are stubbed, so a worker that reads a package's fields at load can throw here for that reason alone. Only a missing
        // page global is the failure this test looks for.
        const message = error instanceof Error ? error.message : String(error);
        if (MISSING_PAGE_GLOBAL.test(message)) failures.push(`${entry.slice(root.length + 1)}: ${message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60000);
});
