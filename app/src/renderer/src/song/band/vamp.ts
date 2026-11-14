// Vamps (spec 136, part C): sections that loop or repeat. The generator plays a vamp so that it repeats cleanly (no fill or lead-in on its
// last bar, no crash on its first), and renders the vamp's last bar again with the fill and lead-in into the next section as its exit bar.
// Pure: where each vamp's last bar falls, and the pieces of audio a vamp needs.

import type { SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { barEnd, barSpans, planOfBar } from "./timing";

/** An exit bar's buffer runs this long past the bar, so the fill's last cymbal is not cut where the next section's own audio takes over. */
export const EXIT_TAIL = 0.3;
/** The loop point has no cut: this much of the last bar's ring is mixed into the vamp's start. */
export const WRAP_TAIL = 0.3;

/** A vamp's last bar, and where the vamp starts, all in song seconds. */
export interface VampBar {
  sectionId: string;
  /** The vamp's start, which the loop jumps back to. */
  start: number;
  /** The last bar of the vamp: its exit bar replaces this span on the last pass. */
  from: number;
  to: number;
}

/** The last bar of every vamp that has a section of its own. A vamp with no whole bar of the grid in it has none. */
export function vampBars(grid: BeatGrid, plans: readonly SectionPlan[]): VampBar[] {
  const beats = grid.beats;
  const spans = barSpans(grid);
  const planOf = spans.map((span) => planOfBar(plans, beats, span));
  const bars: VampBar[] = [];
  plans.forEach((plan, index) => {
    if (!plan.vamp || plan.sectionId === null) return;
    const last = planOf.lastIndexOf(index);
    if (last < 0) return;
    bars.push({ sectionId: plan.sectionId, start: plan.start, from: beats[spans[last].start], to: barEnd(beats, spans[last].start, spans[last].beats) });
  });
  return bars;
}

/** The plans as an ordinary song would have them: no vamps. The exit bars are cut from the notes these give. */
export function withoutVamps(plans: readonly SectionPlan[]): SectionPlan[] {
  return plans.map((plan) => {
    const { vamp: _vamp, ...rest } = plan;
    return rest;
  });
}
