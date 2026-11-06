import { TURNS_MAX } from "@shared/chart-annotations";

/*
 * Page turns for a PDF chart: the song times at which the next page starts. Page 1 is shown from the start, and each turn starts the
 * next page, so the page at a song time is the number of turns that have passed. Turns are kept sorted, with no repeats.
 */

/** Turns closer together than this are the same turn, so a double tap does not add two pages. */
export const TURN_MIN_GAP_S = 0.25;

/** The page (1-based) that is shown at `time`. A song without turns stays on page 1. */
export function pageAtTime(turns: readonly number[], time: number): number {
  if (!Number.isFinite(time)) return 1;
  let count = 0;
  for (const turn of turns) if (turn <= time) count++;
  return count + 1;
}

/** Adds a turn at `time`, keeping the list sorted. A turn within the minimum gap of an existing one is not added. Returns the same list when nothing changes. */
export function addTurn(turns: readonly number[], time: number): number[] {
  if (!Number.isFinite(time) || time < 0 || turns.length >= TURNS_MAX) return [...turns];
  if (turns.some((turn) => Math.abs(turn - time) < TURN_MIN_GAP_S)) return [...turns];
  return [...turns, time].sort((a, b) => a - b);
}

/** Removes the turn at `index`. Out of range leaves the list as it is. */
export function removeTurn(turns: readonly number[], index: number): number[] {
  return turns.filter((_, i) => i !== index);
}
