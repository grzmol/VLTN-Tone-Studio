// A transport action from a band follower (spec 44). It runs through the performance screen's action registry (actions.ts), the same
// action a bound key runs. Stop needs a second press within a short time, as a double-press binding does, so a stray tap on a phone
// cannot end a song. The gate is the only state here and it is pure: the caller passes the time.
import type { FollowerAction } from "@shared/band-sync";

/** The second stop must come within this long of the first. It matches the hint the performer sees. */
export const STOP_SECOND_PRESS_MS = 600;

export type FollowerStep = { kind: "run"; action: FollowerAction } | { kind: "armed"; action: FollowerAction };

export class FollowerGate {
  private armedAt: number | null = null;

  constructor(private now: () => number = () => performance.now()) {}

  /** What a follower's action does now: run it, or wait for the second stop. Any other action clears a stop that was waiting. */
  take(action: FollowerAction): FollowerStep {
    if (action !== "transport.stop") {
      this.armedAt = null;
      return { kind: "run", action };
    }
    const now = this.now();
    if (this.armedAt !== null && now - this.armedAt <= STOP_SECOND_PRESS_MS) {
      this.armedAt = null;
      return { kind: "run", action };
    }
    this.armedAt = now;
    return { kind: "armed", action };
  }
}
