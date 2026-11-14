// How a generated song ends (spec 136). Pure: it decides which bar is the ending and where its hits fall, and the drum and bass
// generators write their own notes from that. The recording's last beat is where the beat tracker stopped, which for a song that
// fades out is somewhere inside the fade, so a performer can pick the ending and where it lands.

import type { SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { barBeats, barEnd, barSpans, beatSpan, planOfBar } from "./timing";

/** Hit: a kick, crash and bass note on one downbeat. Hold: a fill, then a hit that rings. Three hits: unison hits, then a last one. Slow: slows down, then holds. None: plays to the end. */
export const ENDINGS = ["hit", "hold", "hits", "slow", "none"] as const;
export type EndingKind = (typeof ENDINGS)[number];

export interface EndingSettings {
  kind: EndingKind;
  /** The section the ending goes at the end of. Unset (or a section that is gone) means the last section with drums on. */
  atSection?: string | null;
  /** Bars a slow ending takes to slow down. Default 1. */
  bars?: 1 | 2;
}

/** The ending songs have always had, and the default for a saved song. */
export const DEFAULT_ENDING: EndingSettings = { kind: "hit" };

/** A hold rings this many bars. */
export const HOLD_BARS = 2;
/** A slow ending ends at this share of the tempo. */
export const SLOW_TEMPO = 0.7;
/** Seconds of cymbal that sound after a final hit that has no bass note ringing under it. */
export const ENDING_TAIL = 1.5;

export function isEnding(value: unknown): value is EndingSettings {
  if (typeof value !== "object" || value === null) return false;
  const ending = value as Record<string, unknown>;
  return (
    ENDINGS.includes(ending.kind as EndingKind) &&
    (ending.atSection === undefined || ending.atSection === null || typeof ending.atSection === "string") &&
    (ending.bars === undefined || ending.bars === 1 || ending.bars === 2)
  );
}

/** Reads a saved ending. A song saved before endings existed, or a damaged value, ends the way songs always did. */
export function parseEnding(value: unknown): EndingSettings {
  if (!isEnding(value)) return { ...DEFAULT_ENDING };
  const ending: EndingSettings = { kind: value.kind };
  if (typeof value.atSection === "string" && value.atSection !== "") ending.atSection = value.atSection;
  if (value.bars === 1 || value.bars === 2) ending.bars = value.bars;
  return ending;
}

/** Time of beat `index`, carrying the grid's last beat interval on past its end. */
export function beatTimeAt(beats: readonly number[], index: number): number {
  if (index < beats.length) return beats[index];
  const last = beats.length - 1;
  return beats[last] + (index - last) * beatSpan(beats, last);
}

/**
 * The bar the ending is on, or -1 when the song has none. The bar is the last full bar before `endTime` (the trim end) when that is
 * given, and no later than the end of the chosen section, or of the last section that has drums on (the last one with bass when no
 * section has drums). A grid with no bar lines of its own gives the last bar of the song when nothing limits it.
 */
export function endingBar(grid: BeatGrid, plans: readonly SectionPlan[], ending: EndingSettings, endTime?: number): number {
  if (ending.kind === "none" || grid.beats.length === 0 || plans.length === 0) return -1;
  const spans = barSpans(grid);
  const planOf = spans.map((span) => planOfBar(plans, grid.beats, span));
  const last = (wanted: (plan: SectionPlan) => boolean): number => {
    for (let k = spans.length - 1; k >= 0; k--) if (planOf[k] >= 0 && wanted(plans[planOf[k]])) return k;
    return -1;
  };

  let bar = ending.atSection ? last((plan) => plan.sectionId === ending.atSection) : -1;
  if (bar < 0) bar = last((plan) => plan.play.drums);
  if (bar < 0) bar = last((plan) => plan.play.bass);
  if (bar < 0 || endTime === undefined) return bar;

  // A bar counts when it ends by the trim end, with a millisecond to spare for a trim end set on a beat.
  for (let k = bar; k >= 0; k--) if (barEnd(grid.beats, spans[k].start, spans[k].beats) <= endTime + 0.001) return k;
  return -1;
}

/** Where the notes of an ending fall, for the drum and bass generators to write their own notes on. */
export interface EndingShape {
  /** The bar's own groove is replaced by the unison hits (hit and three hits). Otherwise the bar plays on, as a fill for drums on a hold. */
  replacesBar: boolean;
  /** Drums play a size 3 fill in the ending bar (hold). */
  fill: boolean;
  /** Times of the unison hits before the last one. */
  unison: number[];
  /** Time of the last hit: the ending bar's downbeat for a hit, and the next bar's downbeat for the others. */
  final: number;
  /** Seconds the last bass note rings. */
  ring: number;
  /** Beats of the slow-down after the ending bar, each with whether it is the first beat of a bar. Empty unless the ending slows down. */
  slowing: { time: number; downbeat: boolean }[];
  /** True when this ending's last hit is on the ending bar's own downbeat (a plain hit), so nothing is played past the bar. */
  inBar: boolean;
}

/**
 * Where the ending of bar `k` falls. A slow ending that is not on the grid's last bar behaves as a hold: the recording is still playing
 * there, and slowing the generated parts down would pull them away from it, so slowing down only happens after the last beat.
 */
export function endingShape(grid: BeatGrid, k: number, ending: EndingSettings): EndingShape {
  const beats = grid.beats;
  const spans = barSpans(grid);
  const { start, beats: length } = spans[k];
  const beatLength = beatSpan(beats, Math.min(beats.length - 1, start + length - 1));
  const nextDownbeat = beatTimeAt(beats, start + length);
  const empty = { fill: false, unison: [], slowing: [] };

  if (ending.kind === "hit") return { ...empty, replacesBar: true, final: beats[start], ring: barEnd(beats, start, length) - beats[start], inBar: true };
  if (ending.kind === "hits") {
    const unison = Array.from({ length: Math.min(3, length) }, (_, i) => beats[start + i]);
    return { ...empty, replacesBar: true, unison, final: nextDownbeat, ring: length * beatLength, inBar: false };
  }
  if (ending.kind === "slow" && k === spans.length - 1) {
    const bars = ending.bars ?? 1;
    const count = bars * barBeats(grid);
    const slowing: EndingShape["slowing"] = [];
    let time = nextDownbeat;
    let interval = beatLength;
    for (let i = 0; i < count; i++) {
      slowing.push({ time, downbeat: i % barBeats(grid) === 0 });
      // The tempo falls evenly from the full tempo to SLOW_TEMPO over the beats, so each beat is a little longer than the one before.
      interval = beatLength / (1 - (1 - SLOW_TEMPO) * ((i + 1) / count));
      time += interval;
    }
    return { fill: false, unison: [], replacesBar: false, final: time, ring: HOLD_BARS * length * interval, slowing, inBar: false };
  }
  return { fill: true, unison: [], replacesBar: false, final: nextDownbeat, ring: HOLD_BARS * length * beatLength, slowing: [], inBar: false };
}
