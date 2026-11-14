// Bar and step timing shared by the generated parts. A step is a point on the style's grid inside one bar, and its song time follows
// the beat grid, so the parts stay on the beat when the tempo drifts. Pure: no audio and no store.

import type { SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import type { Style } from "./styles/types";

/** Index of the plan covering `time`, or -1 when no plan does. Plans are in time order and do not overlap. */
export function planIndexAt(plans: readonly SectionPlan[], time: number): number {
  return plans.findIndex((plan) => time >= plan.start && time < plan.end);
}

/** Beats in one bar, as the grid counts them. At least one. */
export function barBeats(grid: BeatGrid): number {
  return Math.max(1, Math.round(grid.beatsPerBar));
}

/**
 * Start beat of every bar in the grid, from the downbeat on. A beat before the downbeat is a pickup and gets no bar. A grid whose bar lines
 * move (see `barStartsFromChords`) gives its own starts; otherwise every bar has `barBeats` beats.
 */
export function barStarts(grid: BeatGrid): number[] {
  if (grid.barStarts) return grid.barStarts.filter((beat) => beat < grid.beats.length);
  const perBar = barBeats(grid);
  const starts: number[] = [];
  for (let beat = Math.max(0, Math.round(grid.downbeat)); beat < grid.beats.length; beat += perBar) starts.push(beat);
  return starts;
}

/** One bar of the grid: its first beat and how many beats it has. */
export interface BarSpan {
  start: number;
  beats: number;
}

/** Every bar of the grid with its length in beats. The last bar has `barBeats` beats, since it has no next bar to end at. */
export function barSpans(grid: BeatGrid): BarSpan[] {
  const starts = barStarts(grid);
  const perBar = barBeats(grid);
  return starts.map((start, k) => ({ start, beats: k + 1 < starts.length ? starts[k + 1] - start : perBar }));
}

/**
 * Position of a beat inside its bar, counted from the bar's first beat. With no bar starts in the grid this is the usual position on a
 * fixed bar, so a grid without them behaves as before.
 */
export function beatInBar(grid: BeatGrid, beat: number): number {
  if (grid.barStarts) {
    let start = -1;
    for (const candidate of grid.barStarts) if (candidate <= beat) start = candidate;
    if (start >= 0) return beat - start;
  }
  const perBar = barBeats(grid);
  return (((beat - Math.round(grid.downbeat)) % perBar) + perBar) % perBar;
}

/**
 * A bar's pattern fitted to the bar's own length. Patterns are written for `perBar` beats in `steps` steps. A shorter bar plays only the
 * steps that fall in its beats. A longer bar starts the pattern again for its extra beats, as steps past `steps`, which `stepAt` places
 * after the usual bar.
 */
export function fitStepsToBar<T extends { step: number }>(items: readonly T[], steps: number, perBar: number, barLength: number): T[] {
  if (barLength === perBar) return [...items];
  const beatOf = (step: number) => Math.floor((step * perBar) / steps);
  if (barLength < perBar) return items.filter((item) => beatOf(item.step) < barLength);
  const extra = barLength - perBar;
  return [...items, ...items.filter((item) => beatOf(item.step) < extra).map((item) => ({ ...item, step: item.step + steps }))];
}

/** Length of a beat in seconds. The last beat has no following beat, so it uses the interval before it. */
export function beatSpan(beats: readonly number[], beat: number): number {
  if (beat + 1 < beats.length) return beats[beat + 1] - beats[beat];
  if (beat > 0) return beats[beat] - beats[beat - 1];
  return 0.5;
}

/** Time of a point `fraction` of the way through beat `beat`. */
export function timeIn(beats: readonly number[], beat: number, fraction: number): number {
  return beats[beat] + fraction * beatSpan(beats, beat);
}

/** Time the bar starting at beat `start` ends: the next bar's downbeat, or one bar of the last beat's length past the grid's end. */
export function barEnd(beats: readonly number[], start: number, perBar: number): number {
  if (start + perBar < beats.length) return beats[start + perBar];
  return beats[start] + perBar * beatSpan(beats, start);
}

/** The plan a bar belongs to: the plan covering the bar's middle. A section start within half a bar of a bar line then takes that bar. */
export function planOfBar(plans: readonly SectionPlan[], beats: readonly number[], span: BarSpan): number {
  const middle = (beats[span.start] + barEnd(beats, span.start, span.beats)) / 2;
  return planIndexAt(plans, middle);
}

/**
 * How late an off-beat step plays, in beats. The off-beat is the odd step of a sixteenth or eighth grid. At full swing (1) it would
 * sit two thirds of the way through the pair, so swing × half a step is close to a triplet feel at the top of the range. Triplet
 * grids take no swing here: their pattern already places the swing.
 */
export function swingDelay(style: Style, fraction: number, swing: number): number {
  const perBeat = style.meter.stepsPerBeat;
  if (swing <= 0 || perBeat === 3) return 0;
  if (Math.round(fraction * perBeat) % 2 === 0) return 0;
  return (swing * 0.5) / perBeat;
}

/**
 * Whether a style's bar is stretched over the grid's bar, whatever the grid's beats. Six-eight has two dotted beats to the bar, and a
 * song counted in four has a dotted beat every two beats, so its six steps are spread over the whole grid bar. Every other style keeps
 * its steps per beat and is cut or carried on to the grid's bar.
 */
export function stretchesToBar(style: Style): boolean {
  return style.meter.beatsPerBar === 2 && style.meter.stepsPerBeat === 3;
}

/** The beats a style's pattern is written for, as `fitStepsToBar` takes them: the grid's own bar for a style that stretches to it. */
export function patternBeats(style: Style, perBar: number): number {
  return stretchesToBar(style) ? perBar : style.meter.beatsPerBar;
}

/** Steps per grid beat that open a hit beat, for `hitSteps`: a stretched style has its steps spread over the grid's bar. */
export function stepsPerGridBeat(style: Style, perBar: number): number {
  return stretchesToBar(style) ? (style.meter.beatsPerBar * style.meter.stepsPerBeat) / perBar : style.meter.stepsPerBeat;
}

/** Steps in a bar of `perBar` beats for a style: its steps per beat stay, and the bar is cut or carried on. */
export function stepsForBar(style: Style, perBar: number): number {
  return style.meter.stepsPerBeat * perBar;
}

/**
 * One step of a bar. `start` is the bar's first beat and `perBar` the grid's beats in a bar, which only a style that stretches to the bar
 * uses. A step sits on the same part of its beat whatever the grid's bar length: its
 * beat is `step / stepsPerBeat` rounded down, and its fraction the rest. The step's beat may fall past the end of the grid; callers
 * check `beat` before using `time`.
 */
export function stepAt(
  beats: readonly number[],
  style: Style,
  start: number,
  step: number,
  perBar: number,
  swing: number,
): { beat: number; time: number } {
  const perBeat = style.meter.stepsPerBeat;
  let beatOffset = Math.floor(step / perBeat);
  let fraction = (step % perBeat) / perBeat;
  if (stretchesToBar(style)) {
    // The style's bar is spread over the grid's bar (see stretchesToBar).
    const steps = style.meter.beatsPerBar * perBeat;
    const scaled = step * perBar;
    beatOffset = Math.floor(scaled / steps);
    fraction = (scaled - beatOffset * steps) / steps;
  }
  const beat = start + beatOffset;
  return { beat, time: timeIn(beats, beat, fraction + swingDelay(style, fraction, swing)) };
}

export function clampVelocity(value: number): number {
  return Math.min(127, Math.max(1, Math.round(value)));
}
