// electron-builder afterPack hook. Gives an unsigned macOS bundle a valid ad-hoc signature.
//
// Without a certificate, electron-builder leaves the app bundle unsigned: only the Electron binary's linker
// signature is left, and `codesign --verify --deep --strict` fails. On Apple Silicon a downloaded copy then
// opens as "damaged". Signing the whole bundle ad-hoc fixes that. There is no Developer ID yet; signing with a
// certificate and notarization are spec 69 (.claude/docs/specs/69-signed-builds-and-update-trust.md).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

// Pure decision: sign the bundle only for an unsigned macOS build made on a Mac.
function decideAdhocSign({ platform, env, hostPlatform }) {
  if (platform !== "darwin") return { sign: false, reason: `not a macOS target (${platform})` };
  if (env.CSC_LINK) return { sign: false, reason: "a signing certificate is configured (CSC_LINK)" };
  if (env.VLTN_ADHOC_SIGN !== "1" && env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") {
    return { sign: false, reason: "signing identity discovery is on" };
  }
  if (hostPlatform !== "darwin") return { sign: false, reason: `codesign needs a macOS host (${hostPlatform})` };
  return { sign: true, reason: "unsigned macOS build" };
}

// The codesign calls go through `exec` so the test can inject them.
function adhocSign(context, { env = process.env, hostPlatform = process.platform, exec = execFileSync, log = console.log } = {}) {
  const decision = decideAdhocSign({ platform: context.electronPlatformName, env, hostPlatform });
  if (!decision.sign) {
    log(`[adhoc-sign] skipped: ${decision.reason}`);
    return;
  }
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  log(`[adhoc-sign] signing ${appPath} ad-hoc (${decision.reason})`);
  exec("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  try {
    exec("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" });
  } catch (error) {
    throw new Error(`[adhoc-sign] ${appPath} fails codesign --verify --deep --strict, not shipping it: ${error.message}`);
  }
  log(`[adhoc-sign] ${appPath} passes codesign --verify --deep --strict`);
}

module.exports = adhocSign;
module.exports.default = adhocSign;
module.exports.decideAdhocSign = decideAdhocSign;
