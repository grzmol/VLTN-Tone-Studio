// Runs the beat tracker in a worker so a long song does not block the window. The job can be cancelled: cancelling ends the worker at
// once, so a song that is closed or re-split during analysis does not keep a thread busy.

import type { PcmAudio } from "../types";
import { monoSum, type BeatGrid, type MeterEstimate, type TempoHintOptions } from "./beat-grid";

export interface BeatGridRequest extends TempoHintOptions {
  sources: readonly PcmAudio[];
  sampleRate: number;
  beatsPerBar: number;
  /** Chord change times, in seconds of the same audio */
  chordChanges?: number[];
}

/** What the worker receives. The stems are already summed, so only one mono buffer is sent, and it is transferred, not copied. */
export interface BeatGridMessage extends TempoHintOptions {
  mono: Float32Array;
  sampleRate: number;
  beatsPerBar: number;
  chordChanges?: number[];
}

export interface BeatGridJob {
  /** Resolves with the grid, or rejects with an AbortError after `cancel`. */
  done: Promise<BeatGrid>;
  /** The meter the beats fall into. Resolves with null when the job fails or is cancelled. */
  meter: Promise<MeterEstimate | null>;
  cancel(): void;
}

/**
 * Starts beat tracking in a worker. Call it while playback is stopped: summing the sources to mono loops over the whole song on the
 * calling thread. Never call it during playback.
 */
export function startBeatGrid(request: BeatGridRequest): BeatGridJob {
  const mono = monoSum(request.sources);
  const message: BeatGridMessage = {
    mono,
    sampleRate: request.sampleRate,
    beatsPerBar: request.beatsPerBar,
    chordChanges: request.chordChanges,
    tempoHint: request.tempoHint,
    lockTempo: request.lockTempo,
  };
  const worker = new Worker(new URL("./beat-grid-worker.ts", import.meta.url), { type: "module" });
  let rejectDone: (error: Error) => void = () => {},
    resolveMeter: (meter: MeterEstimate | null) => void = () => {};
  const meter = new Promise<MeterEstimate | null>((resolve) => (resolveMeter = resolve));
  const done = new Promise<BeatGrid>((resolve, reject) => {
    rejectDone = reject;
    worker.onmessage = (event: MessageEvent<{ grid?: BeatGrid; meter?: MeterEstimate; error?: string }>) => {
      worker.terminate();
      resolveMeter(event.data.meter ?? null);
      if (event.data.error || !event.data.grid) reject(new Error(event.data.error || "Beat tracking returned no grid."));
      else resolve(event.data.grid);
    };
    worker.onerror = () => {
      worker.terminate();
      resolveMeter(null);
      reject(new Error("Beat tracking could not finish."));
    };
  });
  worker.postMessage(message, [mono.buffer]);
  return {
    done,
    meter,
    cancel() {
      worker.terminate();
      resolveMeter(null);
      const error = new Error("Beat tracking was cancelled.");
      error.name = "AbortError";
      rejectDone(error);
    },
  };
}
