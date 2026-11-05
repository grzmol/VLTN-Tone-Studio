// macOS and Windows file systems ignore case, so `./Tuner` finds `tuner.ts` as readily as `Tuner.tsx`, and a build that
// works on Linux fails there (the 0.9.0 release build did, on a Tuner.tsx and a tuner.ts in the same folder).
// No two source files may have names that differ only by case.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = /\.(ts|tsx|mjs|js|css|json)$/;

describe("source file names", () => {
  it("never differ only by case", () => {
    const stems = (readdirSync(resolve("src"), { recursive: true }) as string[])
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => SOURCE.test(f))
      .map((f) => f.replace(/\.[^./]+$/, ""));
    const byLower = new Map<string, Set<string>>();
    for (const s of stems) byLower.set(s.toLowerCase(), (byLower.get(s.toLowerCase()) ?? new Set()).add(s));
    const clashes = [...byLower.values()].filter((names) => names.size > 1).map((names) => [...names]);
    expect(clashes).toEqual([]);
  });
});
