// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vite only bundles a worker that is written as `new Worker(new URL("./x-worker.ts", import.meta.url))` in one expression. A worker URL
// held in a variable or passed to a helper is treated as an asset: Vite inlines the TypeScript source as a data URL with the MPEG
// transport-stream MIME type, and the packaged app's Content Security Policy blocks it. Dev mode works, so only a packaged build shows it.

const root = dirname(fileURLToPath(import.meta.url));

/** Every app source file, without the tests. */
async function sourceFiles(dir: string = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) files.push(path);
  }
  return files;
}

/** A `new URL("...")` whose path names a worker, with the text before it. */
function workerUrls(text: string): { path: string; before: string }[] {
  const found: { path: string; before: string }[] = [];
  for (const match of text.matchAll(/new URL\(\s*(["'`])([^"'`]*)\1/g)) {
    if (!match[2].includes("worker")) continue;
    found.push({ path: match[2], before: text.slice(0, match.index) });
  }
  return found;
}

describe("worker URLs", () => {
  it("builds every worker URL directly inside new Worker(...) or new SharedWorker(...)", async () => {
    const offenders: string[] = [];
    let count = 0;
    for (const file of await sourceFiles()) {
      const text = await readFile(file, "utf8");
      for (const { path, before } of workerUrls(text)) {
        count += 1;
        if (!/new (Shared)?Worker\(\s*$/.test(before)) offenders.push(`${file.slice(root.length + 1)}: new URL("${path}")`);
      }
    }
    expect(offenders).toEqual([]);
    // A sanity floor, so a moved root or a broken pattern cannot make the check pass with nothing to check.
    expect(count).toBeGreaterThan(10);
  });

  it("flags a worker URL that is passed to a helper instead of a Worker", () => {
    const text = `runWorker(new URL("../performance/key-worker.ts", import.meta.url), input, signal);`;
    const [found] = workerUrls(text);
    expect(/new (Shared)?Worker\(\s*$/.test(found.before)).toBe(false);
  });
});
