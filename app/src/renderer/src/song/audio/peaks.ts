import { peaks } from "@/song/stems/mix";

/** Waveform peaks per song, kept so the timeline does not read the whole audio again on each render or resize. */
const cache = new Map<string, Float32Array>();
const MAX_ENTRIES = 12;

/** The number of peaks for a drawing `width` pixels wide: a multiple of 200, so small resizes reuse the same peaks. */
export function peakBuckets(width: number): number {
  return Math.min(2000, Math.max(200, Math.ceil(width / 200) * 200));
}

/**
 * The peaks of a song's audio for a drawing of `width` pixels, kept per song and width bucket. `songId` names the song and its audio, so
 * different audio under the same id (a re-split) must use a different id.
 */
export function cachedPeaks(songId: string, channels: Float32Array[], width: number): Float32Array {
  const buckets = peakBuckets(width);
  const key = `${songId}:${buckets}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const computed = peaks(channels, buckets);
  cache.set(key, computed);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return computed;
}

/** Forgets every kept peak list. */
export function clearPeakCache(): void {
  cache.clear();
}
