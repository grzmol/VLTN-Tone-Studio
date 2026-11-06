// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import adhocSign, { decideAdhocSign } from "./adhoc-sign.cjs";

const unsigned = { CSC_IDENTITY_AUTO_DISCOVERY: "false" };

describe("decideAdhocSign", () => {
  it("signs an unsigned macOS build made on a Mac", () => {
    expect(decideAdhocSign({ platform: "darwin", env: unsigned, hostPlatform: "darwin" }).sign).toBe(true);
  });

  it("signs with the VLTN_ADHOC_SIGN override when discovery is left on", () => {
    const env = { VLTN_ADHOC_SIGN: "1" };
    expect(decideAdhocSign({ platform: "darwin", env, hostPlatform: "darwin" }).sign).toBe(true);
  });

  it("leaves a real identity alone", () => {
    const env = { ...unsigned, CSC_LINK: "/secrets/developer-id.p12" };
    expect(decideAdhocSign({ platform: "darwin", env, hostPlatform: "darwin" }).sign).toBe(false);
    const withOverride = { ...env, VLTN_ADHOC_SIGN: "1" };
    expect(decideAdhocSign({ platform: "darwin", env: withOverride, hostPlatform: "darwin" }).sign).toBe(false);
  });

  it("leaves identity discovery on alone", () => {
    expect(decideAdhocSign({ platform: "darwin", env: {}, hostPlatform: "darwin" }).sign).toBe(false);
  });

  it("skips other target platforms", () => {
    expect(decideAdhocSign({ platform: "win32", env: unsigned, hostPlatform: "darwin" }).sign).toBe(false);
    expect(decideAdhocSign({ platform: "linux", env: unsigned, hostPlatform: "darwin" }).sign).toBe(false);
  });

  it("skips a non-macOS host", () => {
    expect(decideAdhocSign({ platform: "darwin", env: unsigned, hostPlatform: "linux" }).sign).toBe(false);
  });
});

describe("adhocSign hook", () => {
  const context = {
    electronPlatformName: "darwin",
    appOutDir: "/out/mac-arm64",
    packager: { appInfo: { productFilename: "VLTN Tone Studio" } },
  };

  it("signs the bundle, then verifies it strictly", () => {
    const exec = vi.fn();
    adhocSign(context, { env: unsigned, hostPlatform: "darwin", exec, log: () => {} });
    const app = "/out/mac-arm64/VLTN Tone Studio.app";
    expect(exec.mock.calls).toEqual([
      ["codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" }],
      ["codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" }],
    ]);
  });

  it("throws, so a broken app never ships, when verification fails", () => {
    const exec = vi.fn((_cmd: string, args: string[]) => {
      if (args[0] === "--verify") throw new Error("code has no resources");
    });
    expect(() => adhocSign(context, { env: unsigned, hostPlatform: "darwin", exec, log: () => {} })).toThrow(
      /not shipping it/,
    );
  });

  it("does not run codesign when it skips", () => {
    const exec = vi.fn();
    adhocSign(context, { env: { ...unsigned, CSC_LINK: "x" }, hostPlatform: "darwin", exec, log: () => {} });
    expect(exec).not.toHaveBeenCalled();
  });
});
