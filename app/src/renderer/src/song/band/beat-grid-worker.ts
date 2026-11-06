import { analyseBeats } from "./beat-grid";
import type { BeatGridMessage } from "./beat-grid-client";

self.onmessage = (event: MessageEvent<BeatGridMessage>) => {
  const { mono, sampleRate, beatsPerBar, chordChanges, tempoHint, lockTempo } = event.data;
  try {
    const { grid, meter } = analyseBeats([{ sampleRate, channels: [mono] }], sampleRate, beatsPerBar, chordChanges, { tempoHint, lockTempo });
    self.postMessage({ grid, meter });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
