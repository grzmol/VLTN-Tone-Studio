// The Band panel and Performance screen share the harmony input with simultaneous key analysis.
import { startChordReading, type HarmonyJob } from "../analysis/harmony-client";
import type { Chord, ChordsInput } from "../performance/chords";

export type ChordDetectionJob = HarmonyJob<Chord[]>;

/** Starts chord detection on `input`. Cancelling releases this job without interrupting another reader of the same audio. */
export function startChordDetection(input: ChordsInput): ChordDetectionJob {
  return startChordReading(input);
}
