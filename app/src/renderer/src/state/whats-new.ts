// "What's new" bookkeeping (localStorage): the release whose notes the user last saw. Every access survives missing storage.
import { loadDevice, loadLastConnected } from "./device-storage";

/** Release the notes in WhatsNewDialog describe. Bump it with the notes, not with package.json. */
export const WHATS_NEW_VERSION = "0.9.0";
const SEEN_KEY = "gp5.whatsNewSeen.v1";

export const loadWhatsNewSeen = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};

export function saveWhatsNewSeen(version = WHATS_NEW_VERSION) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* storage unavailable: the notes show again next launch */
  }
}

/** Open on the first launch after an upgrade. A first-time user (never connected a pedal) has nothing to compare with. */
export const shouldShowWhatsNew = (seen: string | null, returning: boolean): boolean => seen === WHATS_NEW_VERSION ? false : seen !== null || returning;

export const isReturningUser = () => loadDevice() !== null || loadLastConnected() !== null;
