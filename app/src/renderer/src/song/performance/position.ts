import type { BeatGrid } from "../band/beat-grid";
import { barStarts, beatInBar } from "../band/timing";
import type { Cue } from "./chart";
import { presetCueTarget, presetNumber, type PresetModel } from "./pedal-preset-names";

/** How far past a bar line the playhead still counts as being on it, so clock jitter does not change a count. */
const EDGE_S = 0.001;

/** Beat times of a steady tempo: one every 60 / bpm seconds from `firstBeat` to `duration`. Null when there is no tempo to count by. */
export function steadyGrid(bpm: number, beatsPerBar: number, firstBeat: number, duration: number): BeatGrid | null {
  if (!(bpm > 0) || !(duration > 0)) return null;
  const step = 60 / bpm;
  const beats: number[] = [];
  for (let time = Math.max(0, firstBeat); time <= duration; time += step) beats.push(time);
  return { beatsPerBar, beats, downbeat: 0, bpm, steady: { bpm, firstBeat: Math.max(0, firstBeat) } };
}

/** The time of every bar line in the grid, in seconds. */
function barTimes(grid: BeatGrid): number[] {
  return barStarts(grid).map((beat) => grid.beats[beat]);
}

/** Index of the last beat at or before `time`, or -1 before the first. */
function beatAt(beats: readonly number[], time: number): number {
  let low = 0;
  let high = beats.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (beats[middle] <= time + EDGE_S) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/**
 * Bars still to play before `sectionEnd`, counting the bar the song is in: 8 at the first beat of an 8-bar section, 1 in its last bar.
 * Bar lines come from the grid (`grid.barStarts` when they move). A section that ends part way into a bar counts that bar too. Null when
 * the grid has no bars.
 */
export function barsUntil(grid: BeatGrid | null, time: number, sectionEnd: number): number | null {
  if (!grid) return null;
  const lines = barTimes(grid);
  if (!lines.length) return null;
  const ahead = lines.filter((line) => line > time + EDGE_S && line <= sectionEnd + EDGE_S);
  const last = ahead.length ? ahead[ahead.length - 1] : Math.max(time, lines[0]);
  // The rest of the section after its last bar line is a bar of its own when it is more than a beat long.
  const beat = grid.bpm > 0 ? 60 / grid.bpm : 0;
  const partial = sectionEnd - last > Math.max(EDGE_S, beat / 2) && last >= lines[0] ? 1 : 0;
  return ahead.length + partial;
}

/** The bar and the beat in it at `time`, both counted from 1, or null before the first bar or without a grid. */
export function barAndBeat(grid: BeatGrid | null, time: number): { bar: number; beat: number } | null {
  if (!grid) return null;
  const beat = beatAt(grid.beats, time);
  if (beat < 0) return null;
  const lines = barStarts(grid);
  let bar = 0;
  for (const start of lines) if (start <= beat) bar++;
  if (!bar) return null;
  return { bar, beat: beatInBar(grid, beat) + 1 };
}

/** A cue that recalls a pedal memory: when, which memory, and the pedal's model when the label names it. */
export interface PatchCue {
  time: number;
  slot: number;
  name: string | null;
  model: PresetModel | null;
}

/** The timed cues of a song that recall a pedal memory, in time order. */
export function patchCues(cues: readonly Cue[]): PatchCue[] {
  const found: PatchCue[] = [];
  for (const cue of cues) {
    if (cue.trigger || cue.managed || cue.messages.length !== 2) continue;
    const channel = (cue.messages[1][0] & 0x0f) + 1;
    const target = presetCueTarget(cue, channel);
    if (target) found.push({ time: cue.time, ...target });
  }
  return found.sort((a, b) => a.time - b.time);
}

/** The memory the pedal is on at `time`: the last patch cue that has fired, or null before the first. */
export function patchNow(patches: readonly PatchCue[], time: number): PatchCue | null {
  let current: PatchCue | null = null;
  for (const patch of patches) if (patch.time <= time) current = patch;
  return current;
}

/** The next patch cue still to fire after `time`, or null. */
export function patchNext(patches: readonly PatchCue[], time: number): PatchCue | null {
  return patches.find((patch) => patch.time > time) ?? null;
}

/** "011 Crunch", or "011" for a cue without a name. */
export function patchText(patch: PatchCue): string {
  return patch.name ? `${presetNumber(patch.slot)} ${patch.name}` : presetNumber(patch.slot);
}

/** The pedal's name for the strip: "GP-180", or "Pedal" when the cue's label does not say. */
export function patchPedal(patch: PatchCue): string {
  return patch.model === "gp150" ? "GP-150" : patch.model === "gp180" ? "GP-180" : "Pedal";
}
