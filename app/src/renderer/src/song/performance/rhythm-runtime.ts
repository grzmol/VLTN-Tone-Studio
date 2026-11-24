import type { Cue } from "./chart";

export const RHYTHM_RESTART = "RC-10R needs a restart. Use Play from beginning to align the drums again.";
export const RHYTHM_MEMORY_SETTLE_MS = 150;
export const hasPedalRhythm = (cues: readonly Cue[]): boolean => cues.some((cue) => cue.managed === "rhythm");
export const rhythmMemory = (cues: readonly Cue[]): number[][] =>
  cues.filter((cue) => cue.managed === "rhythm" && cue.trigger === "load").flatMap((cue) => cue.messages);
export const rhythmMemoryKey = (cues: readonly Cue[]): string => JSON.stringify(rhythmMemory(cues));
/** Starting before the first rhythm cue is safe; an offset after it cannot restore a toggled division's phase. */
export function canStartRhythm(cues: readonly Cue[], position: number): boolean {
  const first = Math.min(...cues.filter((cue) => cue.managed === "rhythm" && !cue.trigger).map((cue) => cue.time));
  return position <= first + 0.001;
}

/** A playlist's preparation can inspect rhythm ownership before mounting its performance view. */
export function hasSavedPedalRhythm(settings: Record<string, string>): boolean {
  try {
    return JSON.parse(settings[":options"] || "{}").rhythmAutomation?.followSong === true;
  } catch {
    return false;
  }
}
