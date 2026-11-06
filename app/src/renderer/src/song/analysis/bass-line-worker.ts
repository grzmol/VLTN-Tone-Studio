import { bassLineOf } from "./bass-line";
import type { PcmAudio } from "../types";

/** The bass stem and the beat times of the grid. The reply is the bass note of each beat, or an error. */
export interface BassLineInput {
  bass: PcmAudio;
  beats: number[];
}

self.onmessage = (event: MessageEvent<BassLineInput>) => {
  try {
    self.postMessage({ bassLine: bassLineOf(event.data.bass, event.data.beats) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
