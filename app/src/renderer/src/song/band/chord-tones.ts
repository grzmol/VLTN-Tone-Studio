// The intervals of a chord's tones above its root, shared by the bass line (bass.ts) and the bass figures (bass-figures.ts). Pure.

import type { ChordQuality, ChordSeventh } from "./harmony";

/** Intervals above the root, in semitones. A missing third or seventh is null. */
export const THIRD: Record<ChordQuality, number | null> = { major: 4, minor: 3, dim: 3, aug: 4, sus2: 2, sus4: 5, power: null };
export const SEVENTH: Record<ChordSeventh, number | null> = { none: null, dom7: 10, maj7: 11, min7: 10, dim7: 9, "half-dim": 10 };

export const pitchClass = (note: number): number => ((note % 12) + 12) % 12;

/** Semitones from the root to the fifth. A diminished chord has a flat fifth, an augmented one a sharp fifth. */
export function fifthInterval(quality: ChordQuality): number {
  if (quality === "dim") return 6;
  if (quality === "aug") return 8;
  return 7;
}
