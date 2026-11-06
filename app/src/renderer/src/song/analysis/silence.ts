// Finds the silence at the start and end of a song, so the performer can trim it with one click. Nothing is trimmed automatically: the
// result is saved with the analysis and offered in the shape controls.

import type { PcmAudio } from "../types";

/** A window counts as silent below this level, in dBFS. */
export const SILENCE_DB = -50;
/** Length of each window the level is measured over, in seconds. */
export const SILENCE_WINDOW_SECONDS = 0.05;
/** Silence shorter than this is not reported: a quiet intro or a breath is not worth trimming. */
export const SILENCE_MIN_SECONDS = 0.25;

/**
 * The silence at the ends of a song. `start` is the length of the silence before the first sound, in seconds, or 0 when there is none
 * worth trimming. `end` is the time the silence after the last sound starts, or the song's length when there is none.
 */
export interface SilenceEnds {
  start: number;
  end: number;
}

/**
 * Measures the leading and trailing silence across every channel. A window is sound when any channel is above `SILENCE_DB`. Null when
 * the whole song is silent, since there is then no sound to trim to.
 */
export function silenceEnds(audio: PcmAudio): SilenceEnds | null {
  const frames = audio.channels[0]?.length ?? 0;
  const windowFrames = Math.max(1, Math.round(SILENCE_WINDOW_SECONDS * audio.sampleRate));
  const windows = Math.floor(frames / windowFrames);
  const threshold = 10 ** (SILENCE_DB / 20);
  const loud = new Array<boolean>(windows);
  for (let w = 0; w < windows; w++) {
    let peak = 0;
    for (const channel of audio.channels) {
      for (let i = w * windowFrames, end = i + windowFrames; i < end; i++) peak = Math.max(peak, Math.abs(channel[i]));
    }
    loud[w] = peak > threshold;
  }
  const first = loud.indexOf(true);
  if (first < 0) return null;
  let last = windows - 1;
  while (!loud[last]) last--;
  const duration = frames / audio.sampleRate;
  const leading = first * SILENCE_WINDOW_SECONDS;
  const trailingStart = (last + 1) * SILENCE_WINDOW_SECONDS;
  return {
    start: leading >= SILENCE_MIN_SECONDS ? leading : 0,
    end: duration - trailingStart >= SILENCE_MIN_SECONDS ? trailingStart : duration,
  };
}
