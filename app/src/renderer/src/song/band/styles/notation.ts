// Helpers that write the style data compactly. A pattern is one bar, given lane by lane: each lane is a drum voice, the steps it
// plays and a velocity. Nothing here runs during playback; it only builds the data once, when the module loads.

import type { DrumGroove, DrumHit, DrumPattern, Tier } from "./types";

/** Velocities used across the styles. Accents 100 to 115, normal 85 to 95, ghosts 30 to 45 (checked in styles.test.ts). */
export const VEL = {
  accent: 108,
  normal: 90,
  hat: 86,
  ghost: 38,
  crash: 110,
} as const;

/** Step positions in a bar of sixteenths. */
export const QUARTERS = [0, 4, 8, 12];
export const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
export const ODD_SIXTEENTHS = [1, 3, 5, 7, 9, 11, 13, 15];
export const SIXTEENTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export interface HitFlags {
  /** Plays from a complexity level: "lean" from 1/3, "busy" from 2/3. Untagged hits always play. */
  tier?: Tier;
  /** Dropped when ghost notes are off. */
  ghost?: boolean;
}

/** The hits of one voice on the given steps, all at one velocity. */
export function lane(pitch: number, velocity: number, steps: readonly number[], flags: HitFlags = {}): DrumHit[] {
  return steps.map((step) => ({ step, pitch, velocity, ...flags }));
}

/** One bar of `steps` steps, built from lanes. Hits are sorted by step, then pitch. */
export function bar(steps: number, ...lanes: DrumHit[][]): DrumPattern {
  const hits = lanes.flat().sort((a, b) => a.step - b.step || a.pitch - b.pitch);
  return { steps, hits };
}

/** A named groove: one bar, built from lanes. */
export function groove(name: string, steps: number, ...lanes: DrumHit[][]): DrumGroove {
  return { name, ...bar(steps, ...lanes) };
}
