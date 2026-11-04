// Preset variations: Randomize nudges every continuous knob around where it is; Morph blends toward another preset.
// Both only return new param arrays; edits.ts applies them so they land in the undo history.
import { clampParamValue } from "@/state/preset-codec";
import type { BlockState, ParamInfo } from "@/state/device-types";

/** Loudness params stay put so a variation can't jump in level. ponytail: name match, a catalog flag if it misses one. */
const LEVEL = /^(volume|level|master|output)\b/i;

/** Knobs a variation moves: not switches, Sync toggles, menus or levels. */
const movable = (p: ParamInfo) => !p.toggle && p.syncs === undefined && !p.labels && !p.values && !LEVEL.test(p.name) && p.max > p.min;

/** `block`'s params with each movable knob moved up to ±`amount` (0-1) of its range; `rng` is Math.random-like. */
export function randomized(block: BlockState, amount: number, rng: () => number = Math.random): number[] {
  const out = [...block.params];
  for (const p of block.model?.params ?? []) {
    if (!movable(p)) continue;
    out[p.index] = clampParamValue(p, out[p.index] + (rng() * 2 - 1) * amount * (p.max - p.min));
  }
  return out;
}

/** Params of `a` blended `t` (0 = a, 1 = b) toward `b`; null when the two blocks run different models (can't blend). */
export function morphed(a: BlockState, b: BlockState, t: number): number[] | null {
  if (a.fxid !== b.fxid) return null;
  const out = [...a.params];
  for (const p of a.model?.params ?? []) {
    const from = a.params[p.index];
    const to = b.params[p.index];
    // switches and menus don't blend: they flip halfway
    out[p.index] = movable(p) || LEVEL.test(p.name) ? clampParamValue(p, from + (to - from) * t) : t < 0.5 ? from : to;
  }
  return out;
}
