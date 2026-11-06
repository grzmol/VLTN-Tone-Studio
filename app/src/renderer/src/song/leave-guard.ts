import { create } from "zustand";

// The question asked before the open song is replaced while it has audio that is not saved. The dialog (SaveBeforeLeaving) answers it. The
// logic that decides whether to ask lives in library.ts, next to what counts as unsaved.

export type LeaveChoice = "save" | "discard" | "cancel";

interface LeaveGuardState {
  /** How many dialogs are on screen to answer. With none, a question would never be answered, so the guard does not ask. */
  mounted: number;
  /** The question waiting for an answer, or null */
  asking: { title: string; detail: string; answer(choice: LeaveChoice): void } | null;
}

export const useLeaveGuard = create<LeaveGuardState>(() => ({ mounted: 0, asking: null }));

/** Whether a dialog is there to answer. */
export const leaveGuardShown = (): boolean => useLeaveGuard.getState().mounted > 0;

/** Registers a dialog. Returns the function that removes it. */
export function mountLeaveGuard(): () => void {
  useLeaveGuard.setState((s) => ({ mounted: s.mounted + 1 }));
  return () => {
    useLeaveGuard.setState((s) => ({ mounted: s.mounted - 1 }));
    // A dialog that goes away with a question open answers it as Cancel, so the caller never waits for ever.
    if (!leaveGuardShown()) useLeaveGuard.getState().asking?.answer("cancel");
  };
}

/** Asks whether to save first. A question that is already open is answered as Cancel, since only one song is replaced at a time. */
export function askLeave(title: string, detail: string): Promise<LeaveChoice> {
  useLeaveGuard.getState().asking?.answer("cancel");
  return new Promise((resolve) => {
    const answer = (choice: LeaveChoice) => {
      if (useLeaveGuard.getState().asking?.answer === answer) useLeaveGuard.setState({ asking: null });
      resolve(choice);
    };
    useLeaveGuard.setState({ asking: { title, detail, answer } });
  });
}
