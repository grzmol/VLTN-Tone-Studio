// @vitest-environment node
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { isExecutable, isInside, MAC_SUITE, ShellPaths, suiteToLaunch } from "./shell-paths";

let base: string;
let userData: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "shell-paths-"));
  userData = join(base, "userData");
  await mkdir(join(userData, "logs"), { recursive: true });
  await mkdir(join(base, "x"));
});

const registry = () => new ShellPaths({ userData: () => userData });

describe("ShellPaths.isAllowed", () => {
  it("accepts a path the user picked in a dialog, wherever it is", async () => {
    const picks = registry();
    const saved = join(base, "Downloads", "export.prst");
    expect(await picks.isAllowed(saved)).toBe(false);
    picks.allow(saved);
    expect(await picks.isAllowed(saved)).toBe(true);
  });

  it("accepts the userData log folder", async () => {
    expect(await registry().isAllowed(join(userData, "logs"))).toBe(true);
  });

  it("refuses an app on the system, which does not exist here", async () => {
    expect(await registry().isAllowed("/Applications/Calculator.app")).toBe(false);
  });

  it("refuses a Windows system program", async () => {
    expect(await registry().isAllowed("C:\\Windows\\System32\\cmd.exe")).toBe(false);
  });

  it("refuses a path that climbs out of userData with ..", async () => {
    expect(await registry().isAllowed(join(userData, "..", "x"))).toBe(false);
  });

  it("refuses a symlink inside userData that points outside it", async () => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "not yours");
    await symlink(outside, join(userData, "link"));
    expect(await registry().isAllowed(join(userData, "link", "secret.txt"))).toBe(false);
  });

  it("refuses a file not in the registry and outside userData even when a sibling exists", async () => {
    await writeFile(join(base, "x", "note.txt"), "x");
    expect(await registry().isAllowed(join(base, "x", "note.txt"))).toBe(false);
  });
});

describe("isInside", () => {
  it("is true for the root itself and for children, false for siblings that share a prefix", () => {
    expect(isInside("/a/ud", "/a/ud")).toBe(true);
    expect(isInside("/a/ud", "/a/ud/logs/x.txt")).toBe(true);
    expect(isInside("/a/ud", "/a/udx/file")).toBe(false);
    expect(isInside("/a/ud", "/a/file")).toBe(false);
  });
});

describe("isExecutable", () => {
  const file = { isDirectory: () => false, mode: 0o644 };
  const dir = { isDirectory: () => true, mode: 0o755 };

  it("treats launcher extensions as programs, whatever the platform", () => {
    for (const name of ["Valeton Suite.app", "setup.exe", "run.BAT", "tool.command", "start.sh", "app.AppImage"]) {
      expect(isExecutable(join(userData, name), null, "darwin")).toBe(true);
    }
  });

  it("refuses a file with the execute bit on macOS and Linux, but not on Windows", () => {
    const script = { isDirectory: () => false, mode: 0o755 };
    expect(isExecutable("/ud/tool", script, "darwin")).toBe(true);
    expect(isExecutable("/ud/tool", script, "linux")).toBe(true);
    expect(isExecutable("/ud/tool", script, "win32")).toBe(false);
  });

  it("does not treat a plain file or a folder as a program", () => {
    expect(isExecutable("/ud/logs/log.txt", file, "darwin")).toBe(false);
    expect(isExecutable("/ud/logs", dir, "darwin")).toBe(false);
    expect(isExecutable("/ud/logs/log.txt", null, "darwin")).toBe(false);
  });
});

describe("suiteToLaunch", () => {
  it("launches only a path chosen through the dialog", () => {
    expect(suiteToLaunch({ valetonSuitePath: "/opt/Valeton Suite.app", suitePathPicked: true }, "darwin")).toBe("/opt/Valeton Suite.app");
    expect(suiteToLaunch({ valetonSuitePath: "/opt/Valeton Suite.app", suitePathPicked: false }, "darwin")).toBeNull();
  });

  it("falls back to the macOS default install only when no path is set", () => {
    expect(suiteToLaunch({ valetonSuitePath: null, suitePathPicked: false }, "darwin")).toBe(MAC_SUITE);
    expect(suiteToLaunch({ valetonSuitePath: null, suitePathPicked: false }, "win32")).toBeNull();
  });
});
