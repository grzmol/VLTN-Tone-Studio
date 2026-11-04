import type { PcmAudio } from "./types";

// The part of a song that gets split (pure). A guitarist's tone often changes between verse, chorus and solo, so
// Tone Match reads one part better than the whole song; a shorter part also splits faster and in less memory.

/** Start and end of the part, in seconds. */
export interface SongRange {
  start: number;
  end: number;
}

/** Shortest part to split: Tone Match needs a few seconds of playing to read the tone. */
export const MIN_RANGE_SECONDS = 5;

/** Length of planar audio in seconds. */
export const audioSeconds = (audio: PcmAudio) => (audio.channels[0]?.length ?? 0) / audio.sampleRate;

/**
 * `range` kept inside the song (`duration` seconds) and at least MIN_RANGE_SECONDS long (the whole song when it is
 * shorter); null when it covers the whole song, which is what a null range means.
 */
export function clampRange(range: SongRange | null, duration: number): SongRange | null {
  if (!range) return null;
  const min = Math.min(MIN_RANGE_SECONDS, duration);
  const start = Math.max(0, Math.min(range.start, duration - min));
  const end = Math.min(duration, Math.max(range.end, start + min));
  return start <= 0 && end >= duration ? null : { start, end };
}

/** The samples of `range` as views into `audio` (the whole song when null). */
export function sliceAudio(audio: PcmAudio, range: SongRange | null): PcmAudio {
  if (!range) return audio;
  const from = Math.round(range.start * audio.sampleRate);
  const to = Math.round(range.end * audio.sampleRate);
  return { sampleRate: audio.sampleRate, channels: audio.channels.map((c) => c.subarray(from, to)) };
}
