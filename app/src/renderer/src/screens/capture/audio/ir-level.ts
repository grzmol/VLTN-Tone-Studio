// Level matching for a cab IR. An impulse response changes the tone, not the loudness, so the convolved signal is scaled back to the
// level it had before the IR. The gain is measured on the signal itself (RMS before and after), so it is right for any IR. Pure, so the
// tests run without WebAudio.

/** The most a cab IR may change the level, either way, in dB. Past this the IR is not level-matched any further. */
export const IR_LEVEL_LIMIT_DB = 24;
/** Below this RMS (-120 dBFS) a signal counts as silent, and the IR is left alone. */
const SILENT_RMS = 1e-6;

/** Root mean square of a signal. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * The gain that brings `wet` (the signal after the IR) back to the RMS of `dry` (the signal before it). It is clamped to
 * ±IR_LEVEL_LIMIT_DB, and it is 1 when either signal is silent, since a ratio of silences says nothing about the IR.
 */
export function irLevelGain(dry: ArrayLike<number>, wet: ArrayLike<number>, limitDb = IR_LEVEL_LIMIT_DB): number {
  const dryRms = rms(dry);
  const wetRms = rms(wet);
  if (dryRms < SILENT_RMS || wetRms < SILENT_RMS) return 1;
  const limit = 10 ** (limitDb / 20);
  return Math.min(limit, Math.max(1 / limit, dryRms / wetRms));
}
