// When the drummer's count (band/count-in.ts) plays, and how long it leads the song. Pure, so the player that plays it and the session that
// times its MIDI from it agree.

import type { PcmAudio } from "../types";

/**
 * The drummer's count: a short buffer that plays through one track's voice, so it follows that track's volume, mute and output. `start` is
 * the song time of its first frame, negative when it plays ahead of the song.
 */
export interface DrummerCount {
  /** The track the count plays through: the generated drums. */
  track: string;
  audio: PcmAudio;
  start: number;
}

/** A start counts in only from the beginning of the song, within this many seconds of where the count was made to end. */
export const COUNT_START_TOLERANCE_S = 0.05;

/** Whether a start from song time `from` plays the count: only from the beginning, never from a seek into the song. */
export function countApplies(count: DrummerCount | undefined, from: number): count is DrummerCount {
  return count !== undefined && from <= Math.max(0, count.start) + COUNT_START_TOLERANCE_S;
}

/** Audio seconds the count leads the song by at `rate`: the part of the count that falls before song time 0. Zero when it plays inside the song. */
export function countLeadSeconds(count: DrummerCount | undefined, from: number, rate: number): number {
  return countApplies(count, from) ? Math.max(0, -count.start) / rate : 0;
}
