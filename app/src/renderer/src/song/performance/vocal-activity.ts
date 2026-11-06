// Where someone sings, found from the vocals stem alone. The transcriber is only run on these regions: Whisper invents
// text over silence and bleed, so the gaps are left out and the timings of the regions are kept.
//
// Frames are 50 ms. A frame is voiced when it is above a floor and within a range of the stem's typical loud level. The range is
// relative to the stem itself because the stem's own level is all this step has. The typical level is a high percentile of the
// frames, not the loudest one: a single transient would otherwise set the range and gate out the quieter singing around it.

export interface Region {
  start: number;
  end: number;
}

export const FRAME_SECONDS = 0.05;
/** A frame must be louder than this (dBFS). */
export const FLOOR_DB = -45;
/** and no more than this far below the stem's loud level. */
export const RANGE_DB = 25;
/** The stem's loud level is this percentile of its frame levels. */
export const REFERENCE_PERCENTILE = 0.95;
/** Transcription windows overlap their neighbour by this much, so a word cut by a window's edge is heard whole in one of them. */
export const WINDOW_OVERLAP_SECONDS = 2;
/** Voiced frames hold for this long after they end, so word endings aren't cut. */
export const HANGOVER_SECONDS = 0.3;
/** Islands shorter than this are dropped as clicks and bleed. */
export const MIN_ISLAND_SECONDS = 0.4;
/** Transcription windows: at most this long, and padded this much on each side. */
export const WINDOW_SECONDS = 30;
export const WINDOW_PAD_SECONDS = 0.3;

/** RMS level in dBFS of each frame of `samples`. A silent frame is -180 dB. */
export function frameLevels(samples: Float32Array, sampleRate: number): number[] {
  const size = Math.max(1, Math.round(FRAME_SECONDS * sampleRate));
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    levels.push(20 * Math.log10(Math.max(Math.sqrt(sum / (end - start)), 1e-9)));
  }
  return levels;
}

/** The level at `percentile` of the frame levels (-Infinity when there are none). */
export function referenceLevel(levels: readonly number[], percentile = REFERENCE_PERCENTILE): number {
  if (!levels.length) return -Infinity;
  const sorted = [...levels].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)];
}

export function voicedFrames(levels: readonly number[], floorDb = FLOOR_DB, rangeDb = RANGE_DB): boolean[] {
  const reference = referenceLevel(levels);
  return levels.map((level) => level > floorDb && level > reference - rangeDb);
}

/** Extends each voiced run by `hold` frames. */
export function hangover(frames: readonly boolean[], hold: number): boolean[] {
  let since = Infinity;
  return frames.map((voiced) => {
    since = voiced ? 0 : since + 1;
    return since < hold;
  });
}

/** Runs of true frames, as [first, end) frame indices. */
function runs(frames: readonly boolean[]): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = 0; i <= frames.length; i++) {
    const on = i < frames.length && frames[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      found.push({ start, end: i });
      start = -1;
    }
  }
  return found;
}

/** Runs of voiced frames at least `minFrames` long, in seconds. */
export function voicedRegions(frames: readonly boolean[], minFrames: number): Region[] {
  return runs(frames)
    .filter((run) => run.end - run.start >= minFrames)
    .map((run) => ({ start: run.start * FRAME_SECONDS, end: run.end * FRAME_SECONDS }));
}

/** Keeps only the voiced runs at least `minFrames` long: shorter ones are clicks and bleed, not singing. */
export function dropShortRuns(frames: readonly boolean[], minFrames: number): boolean[] {
  const kept = frames.map(() => false);
  for (const run of runs(frames)) if (run.end - run.start >= minFrames) kept.fill(true, run.start, run.end);
  return kept;
}

/** Where the vocals stem has singing: long voiced runs, held for the hangover so word endings are kept. */
export function singingRegions(samples: Float32Array, sampleRate: number): Region[] {
  const long = dropShortRuns(voicedFrames(frameLevels(samples, sampleRate)), Math.round(MIN_ISLAND_SECONDS / FRAME_SECONDS));
  return voicedRegions(hangover(long, Math.round(HANGOVER_SECONDS / FRAME_SECONDS)), 1);
}

/**
 * Groups the singing regions into windows the transcriber takes in one call: padded, joined while a window stays
 * within `maxSeconds`, and split when a single region is longer than that. A split window overlaps the next piece by
 * `overlap` seconds, so no word is cut off at a seam. Windows never run past the song.
 */
export function transcriptionWindows(
  regions: readonly Region[],
  duration: number,
  maxSeconds = WINDOW_SECONDS,
  pad = WINDOW_PAD_SECONDS,
  overlap = WINDOW_OVERLAP_SECONDS,
): Region[] {
  const joined: Region[] = [];
  for (const region of regions) {
    const padded = { start: Math.max(0, region.start - pad), end: Math.min(duration, region.end + pad) };
    const last = joined[joined.length - 1];
    if (last && padded.end - last.start <= maxSeconds) last.end = padded.end;
    else joined.push(padded);
  }
  return joined.flatMap((window) => {
    const pieces: Region[] = [];
    let start = window.start;
    for (;;) {
      const end = Math.min(window.end, start + maxSeconds);
      pieces.push({ start, end });
      if (end >= window.end) return pieces;
      start = end - overlap;
    }
  });
}

/**
 * The part of the song each window is responsible for: from the midpoint with the window before it to the midpoint with the
 * window after it. Neighbours that overlap split the overlap between them, so a word in it is kept by exactly one window.
 */
export function ownedSpans(windows: readonly Region[]): Region[] {
  return windows.map((window, i) => ({
    start: i === 0 ? -Infinity : (windows[i - 1].end + window.start) / 2,
    end: i === windows.length - 1 ? Infinity : (window.end + windows[i + 1].start) / 2,
  }));
}
