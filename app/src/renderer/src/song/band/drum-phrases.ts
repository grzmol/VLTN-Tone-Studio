// Drum phrases: where each bar of a section sits in its phrases, which decides how the bar plays. A drummer thinks in phrases of four bars:
// the last bar of a phrase turns around, the last bar of every second phrase has a small fill, and the section's last bar leads into the
// next section. Pure.

import { CLOSED_HAT, OPEN_HAT, PEDAL_HAT, RIDE } from "./note";
import { isPhraseEnd, phraseBars } from "./phrases";
import { isChorusName, type FillSize, type SectionPlan } from "./arrangement";
import type { DrumHit } from "./styles/types";

/** Where a bar sits in its section's phrases. Phrases are 4 bars, or 2 in a section shorter than 4 bars (the same rule as the bass). */
export interface BarRole {
  /** Index of the bar in the section. */
  bar: number;
  /** Index of the phrase in the section. */
  phrase: number;
  /** 0 to the phrase's length minus one. */
  inPhrase: number;
  /** The last bar of a phrase. */
  phraseEnd: boolean;
  /** The last bar of every second phrase (bar 8, 16, and so on, counting from 1). */
  pairEnd: boolean;
  sectionStart: boolean;
  sectionEnd: boolean;
}

/** The role of every bar of a section of `sectionBars` bars. */
export function barRoles(sectionBars: number): BarRole[] {
  const length = phraseBars(sectionBars);
  return Array.from({ length: Math.max(0, sectionBars) }, (_, bar) => ({
    bar,
    phrase: Math.floor(bar / length),
    inPhrase: bar % length,
    phraseEnd: isPhraseEnd(bar, sectionBars),
    pairEnd: (bar + 1) % (2 * length) === 0,
    sectionStart: bar === 0,
    sectionEnd: bar === sectionBars - 1,
  }));
}

/** The hat and the ride: voices that keep time, so a hit of one on a step takes the place of another on the same step. */
const TIME_KEEPERS: readonly number[] = [CLOSED_HAT, OPEN_HAT, PEDAL_HAT, RIDE];

/**
 * A groove's hits with a patch laid over its steps from `from` on: groove hits there on a voice the patch plays are dropped, and so is a
 * hat or ride hit on a step where the patch plays a hat or a ride. The patch's hits are added. A turnaround is such a patch.
 */
export function overlay(hits: readonly DrumHit[], patch: readonly DrumHit[], from: number): DrumHit[] {
  const voices = new Set(patch.map((hit) => hit.pitch));
  const keptTime = new Set(patch.filter((hit) => TIME_KEEPERS.includes(hit.pitch)).map((hit) => hit.step));
  const kept = hits.filter((hit) => hit.step < from || !(voices.has(hit.pitch) || (TIME_KEEPERS.includes(hit.pitch) && keptTime.has(hit.step))));
  return [...kept, ...patch];
}

/** A fill of this many hits or more should not be flat. */
export const FLAT_FILL_HITS = 4;
/** The velocity range a fill of FLAT_FILL_HITS hits or more has at least. */
export const FILL_RANGE = 15;
/** The first hit of a flat fill plays at this share of its written velocity, and the last at this plus FILL_RISE. */
const FILL_START = 0.72;
const FILL_RISE = 0.4;

/**
 * A fill as it plays. A fill of four hits or more whose velocities are all close is made to rise: each hit is scaled from 72% of its
 * velocity up to 112%, and the last is at least `accent`. Other fills play as written.
 */
export function shapeFill(hits: readonly DrumHit[], accent: number): DrumHit[] {
  const voiced = hits.filter((hit) => !hit.ghost);
  if (voiced.length < FLAT_FILL_HITS) return [...hits];
  const velocities = voiced.map((hit) => hit.velocity);
  if (Math.max(...velocities) - Math.min(...velocities) >= FILL_RANGE) return [...hits];
  const order = [...voiced].sort((a, b) => a.step - b.step || a.pitch - b.pitch);
  return hits.map((hit) => {
    const rank = order.indexOf(hit);
    if (rank < 0) return hit;
    const scaled = Math.round(hit.velocity * (FILL_START + (FILL_RISE * rank) / (order.length - 1)));
    return { ...hit, velocity: rank === order.length - 1 ? Math.max(scaled, accent) : scaled };
  });
}

/** The fill size an automatic fill takes when the section after is this much louder (2 or more levels). */
const BIG_CHANGE = 2;
/** A section's last bar ends with a kick and a crash before a section with the drums off, from this energy up. */
export const CHOKE_FROM_ENERGY = 4;

/** What an automatic fill reads from the section it ends and the section after it. */
type FillSection = Pick<SectionPlan, "name" | "energy" | "play">;

/**
 * The size of the fill that ends `plan`, when the performer has left it automatic, from this section's energy and the next one's:
 * into a quieter or the same section a last-beat fill (none from energy 1), into a section one level louder half a bar, and into
 * one two or more levels louder, or a chorus after another kind of section, the whole bar. Before a section with the drums off there is no
 * fill. At the song's end (no next section) the ending decides, so none.
 */
export function autoFillSize(plan: FillSection, next: FillSection | undefined): FillSize {
  if (!next || !next.play.drums) return 0;
  if (isChorusName(next.name) && !isChorusName(plan.name)) return 3;
  const change = next.energy - plan.energy;
  if (next.name === plan.name || change <= -BIG_CHANGE) return plan.energy === 1 ? 0 : 1;
  if (change <= 0) return 1;
  return change === 1 ? 2 : 3;
}

/** The size of the fill that ends `plan`: a size the performer set, none, or the automatic one. */
export function fillSizeOf(plan: Pick<SectionPlan, "fill"> & FillSection, next: FillSection | undefined): FillSize {
  if (plan.fill === false) return 0;
  if (plan.fill === true) return autoFillSize(plan, next);
  return plan.fill;
}

/** Whether the last bar before a section with the drums off ends with a kick and a crash: only for an automatic fill, from energy 4 up. */
export function choked(plan: Pick<SectionPlan, "fill"> & FillSection, next: FillSection | undefined): boolean {
  return plan.fill === true && next !== undefined && !next.play.drums && plan.energy >= CHOKE_FROM_ENERGY;
}
