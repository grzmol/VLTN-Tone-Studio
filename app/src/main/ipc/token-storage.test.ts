import { describe, expect, it } from "vitest";
import { tokenEncryptionAvailable } from "./token-storage";

describe("tokenEncryptionAvailable", () => {
  it("trusts safeStorage on macOS and Windows", () => {
    expect(tokenEncryptionAvailable({ platform: "darwin", encryptionAvailable: true, backend: null })).toBe(true);
    expect(tokenEncryptionAvailable({ platform: "win32", encryptionAvailable: true, backend: null })).toBe(true);
  });

  it("trusts a real Linux keyring", () => {
    for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
      expect(tokenEncryptionAvailable({ platform: "linux", encryptionAvailable: true, backend })).toBe(true);
    }
  });

  it("treats the Linux basic_text fallback as no encryption", () => {
    expect(tokenEncryptionAvailable({ platform: "linux", encryptionAvailable: true, backend: "basic_text" })).toBe(false);
  });

  it("is unavailable when safeStorage reports so", () => {
    expect(tokenEncryptionAvailable({ platform: "darwin", encryptionAvailable: false, backend: null })).toBe(false);
    expect(tokenEncryptionAvailable({ platform: "linux", encryptionAvailable: false, backend: "unknown" })).toBe(false);
  });
});
