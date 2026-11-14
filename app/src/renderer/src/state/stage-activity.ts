// Whether a performance is using the pedal right now. The device store defers its own reads while it is, so the editor's
// request/reply traffic never shares the MIDI link with the cues. Kept in `state/` so it does not import the performance layer.
import { create } from "zustand";

/** The busy flag goes false this long after the last owner stops, so a hand-over between playlist songs does not flicker it. */
export const STAGE_IDLE_DEBOUNCE_MS = 500;

/** Whether a performance is playing or preparing. The device store defers its own reads while it is. */
export const useStageActivity = create<{ busy: boolean }>(() => ({ busy: false }));

const DEFAULT_OWNER = "default";
const busyOwners = new Set<unknown>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * True takes effect at once; false only after `STAGE_IDLE_DEBOUNCE_MS` with no owner busy. `owner` tells sessions apart, so an old
 * session ending cannot clear the busy flag of the next song's session that already started.
 */
export function setStageBusy(busy: boolean, owner: unknown = DEFAULT_OWNER): void {
  if (busy) busyOwners.add(owner);
  else busyOwners.delete(owner);
  clearTimeout(idleTimer);
  idleTimer = undefined;
  if (busyOwners.size > 0) {
    useStageActivity.setState({ busy: true });
  } else if (useStageActivity.getState().busy) {
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      useStageActivity.setState({ busy: false });
    }, STAGE_IDLE_DEBOUNCE_MS);
  }
}

/** Forgets every owner and goes idle at once. For tests, which end sessions without disposing them. */
export function resetStageActivity(): void {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  busyOwners.clear();
  useStageActivity.setState({ busy: false });
}
