/** What Electron's safeStorage reports about this machine. `backend` is only read on Linux, where it tells a keyring from the fallback. */
export interface SafeStorageState {
  platform: string;
  encryptionAvailable: boolean;
  backend: string | null;
}

/**
 * Whether safeStorage really protects the tokens. On Linux, "basic_text" is the fallback used when no keyring runs.
 * It reports encryption as available but uses a constant key, so it counts as no encryption.
 */
export function tokenEncryptionAvailable(state: SafeStorageState): boolean {
  if (!state.encryptionAvailable) return false;
  return !(state.platform === "linux" && state.backend === "basic_text");
}
