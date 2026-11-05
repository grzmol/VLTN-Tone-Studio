import { STEM_NAMES } from "../types";

// Stem mixer math (pure): gains from mute/solo/volume, waveform peaks, time labels.

export interface StemMix {
  /** 0..1 linear */
  volume: number;
  mute: boolean;
  solo: boolean;
  /** -1 (left) to 1 (right). Missing means centre. */
  pan?: number;
}

/** The mix of a song, by track key (see `trackKey` in the library). A key without an entry plays at the default. */
export type Mix = Record<string, StemMix>;

const DEFAULT_STEM_MIX: StemMix = { volume: 1, mute: false, solo: false };

/** The mix of a track that has no entry yet. */
export const defaultStemMix = (): StemMix => ({ ...DEFAULT_STEM_MIX });

export const defaultMix = (keys: readonly string[] = STEM_NAMES): Mix => Object.fromEntries(keys.map((n) => [n, defaultStemMix()]));

const sameStemMix = (a: StemMix | undefined, b: StemMix | undefined) =>
  a !== undefined && b !== undefined && a.volume === b.volume && a.mute === b.mute && a.solo === b.solo && a.pan === b.pan;

/**
 * The mix to save when a mixer writes `next`. The Stems tab and the Performance mixer keep one saved mix between them, and each holds
 * its own copy, so a copy that is out of date must not overwrite what the other saved. Only the tracks `next` changed from `previous`
 * (the mix this mixer last read or wrote) are taken from it; every other track keeps its saved entry. A track the saved mix lacks
 * is added.
 */
export function mergeMix(saved: Mix | undefined, previous: Mix | null, next: Mix): Mix {
  const merged: Mix = { ...saved };
  for (const key of Object.keys(next)) {
    if (!(key in merged) || !sameStemMix(previous?.[key], next[key])) merged[key] = next[key];
  }
  return merged;
}

/**
 * Linear gain per track: with any track soloed only soloed, unmuted tracks play; otherwise every unmuted track. `keys` are the tracks
 * the song plays. A track with no entry in `mix` takes the default.
 */
export function stemGains(mix: Mix, keys: readonly string[] = Object.keys(mix)): Record<string, number> {
  const entry = (key: string): StemMix => mix[key] ?? DEFAULT_STEM_MIX;
  const soloing = keys.some((key) => entry(key).solo);
  return Object.fromEntries(keys.map((key) => [key, entry(key).mute || (soloing && !entry(key).solo) ? 0 : entry(key).volume]));
}

/** Peak (max |x| over channels) per bucket, `buckets` buckets over the whole length. */
export function peaks(channels: Float32Array[], buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const n = channels[0]?.length ?? 0;
  if (!n) return out;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * n) / buckets);
    const to = Math.max(from + 1, Math.floor(((b + 1) * n) / buckets));
    let peak = 0;
    for (const ch of channels) for (let i = from; i < to && i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
    out[b] = peak;
  }
  return out;
}

/** RMS level of planar audio, all channels together. */
export function rms(channels: Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    count += ch.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/** 83.4 → "1:23" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
