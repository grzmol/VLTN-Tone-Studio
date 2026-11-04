// Pitch shifting of stems (tune the song down or up without changing its tempo) with Rubber Band's finer engine (R3),
// run offline: a study pass over the whole stem first, then the shift. Works on plain Float32Arrays, so it runs in the
// worker (transpose-worker.ts) and in tests alike.
// Licence: Rubber Band is GPL v2 or later (source headers); the app is GPL-3.0.
import { RubberBandOption, type RubberBandInterface } from "rubberband-wasm";

/** How far the control goes either way. */
export const MAX_SEMITONES = 12;

/** Frequency ratio of `semitones` equal-tempered steps. */
export const pitchScale = (semitones: number) => 2 ** (semitones / 12);

/** The finer (R3) engine, offline; both channels analysed together so the stereo image stays put. */
const OPTIONS = RubberBandOption.RubberBandOptionProcessOffline | RubberBandOption.RubberBandOptionEngineFiner | RubberBandOption.RubberBandOptionChannelsTogether;

/**
 * `channels` shifted by `semitones` (negative = down), same length and sample rate. `onProgress` gets 0..1.
 * ponytail: the whole stem is processed in one go; fine for a song, but a very long file holds all of it in memory.
 */
export function shiftChannels(rb: RubberBandInterface, channels: readonly Float32Array[], sampleRate: number, semitones: number, onProgress?: (fraction: number) => void): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const out = channels.map(() => new Float32Array(length));
  if (!length || semitones === 0) return semitones === 0 ? channels.map((c) => c.slice()) : out;

  const state = rb.rubberband_new(sampleRate, channels.length, OPTIONS, 1, pitchScale(semitones));
  const block = Math.max(1, rb.rubberband_get_samples_required(state));
  const listPtr = rb.malloc(channels.length * 4);
  const dataPtrs = channels.map(() => rb.malloc(block * 4));
  try {
    dataPtrs.forEach((ptr, c) => rb.memWritePtr(listPtr + c * 4, ptr));
    rb.rubberband_set_expected_input_duration(state, length);

    // Study pass: lets the offline engine plan the whole stem, which is what makes it better than a live shift.
    for (let read = 0; read < length; ) {
      const n = Math.min(block, length - read);
      channels.forEach((c, i) => rb.memWrite(dataPtrs[i], c.subarray(read, read + n)));
      read += n;
      rb.rubberband_study(state, listPtr, n, read >= length ? 1 : 0);
      onProgress?.((read / length) * 0.3);
    }

    let write = 0;
    const retrieve = (all: boolean) => {
      for (;;) {
        const available = rb.rubberband_available(state);
        if (available < 1 || (!all && available < block)) return;
        const got = rb.rubberband_retrieve(state, listPtr, Math.min(block, available));
        const keep = Math.min(got, length - write);
        if (keep > 0) dataPtrs.forEach((ptr, i) => out[i].set(rb.memReadF32(ptr, keep), write));
        write += got;
      }
    };
    for (let read = 0; read < length; ) {
      const n = Math.min(block, length - read);
      channels.forEach((c, i) => rb.memWrite(dataPtrs[i], c.subarray(read, read + n)));
      read += n;
      rb.rubberband_process(state, listPtr, n, read >= length ? 1 : 0);
      retrieve(false);
      onProgress?.(0.3 + (read / length) * 0.7);
    }
    retrieve(true);
    return out;
  } finally {
    dataPtrs.forEach((ptr) => rb.free(ptr));
    rb.free(listPtr);
    rb.rubberband_delete(state);
  }
}
