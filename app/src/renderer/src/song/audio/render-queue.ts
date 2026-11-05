import { followsPitch, type SpeedSettings } from "../performance/speed";
import type { PcmAudio, Stems } from "../types";
import { orderedKeys } from "../tracks";
import type { StretchSettings } from "./stretch";
import { stretchInWorker } from "./stretch-client";

// Renders a song's stems at a speed and pitch, for the player to swap in. The queue keeps the latest request only: a render that a
// newer one has overtaken is aborted, so its queued stems never start and its running ones are ended. Renders are kept in memory for the current setting and the one before it,
// so going back to the last setting is instant. A song's queue is dropped with the song.

/** How many renders are kept: the current setting and the last one */
export const KEPT_RENDERS = 2;

export type Stretch = (pcm: PcmAudio, settings: StretchSettings, signal?: AbortSignal) => Promise<PcmAudio>;

/** The stretch one track is rendered with. A track that does not follow the pitch is rendered at the rate only. */
export function trackStretch(speed: Pick<SpeedSettings, "rate" | "semitones" | "cents" | "followsPitch">, track: string): StretchSettings {
  const shifted = followsPitch(speed, track);
  return { rate: speed.rate, semitones: shifted ? speed.semitones : 0, cents: shifted ? speed.cents : 0 };
}

/** At 100% and no shift the song plays its own stems, so nothing is rendered. */
export function isPlainSpeed(speed: Pick<SpeedSettings, "rate" | "semitones" | "cents">): boolean {
  return speed.rate === 1 && speed.semitones === 0 && speed.cents === 0;
}

/** A render's key: the settings each track is rendered with, so two requests that render the same audio share one render. */
export function renderKey(speed: Pick<SpeedSettings, "rate" | "semitones" | "cents" | "followsPitch">, tracks: readonly string[]): string {
  return tracks
    .map((track) => {
      const settings = trackStretch(speed, track);
      return `${track}:${settings.rate}:${settings.semitones}:${settings.cents}`;
    })
    .join("|");
}

export class RenderQueue {
  private latest = 0;
  private running: AbortController | null = null;
  private renders = new Map<string, Stems>();

  constructor(private readonly stretch: Stretch = stretchInWorker) {}

  /**
   * Renders `base` at `speed`. Resolves with the stems to play, or null when a newer request has replaced this one: the caller then
   * drops the result. `onProgress` reports tracks done out of the total while the render runs.
   */
  async render(base: Stems, speed: SpeedSettings, onProgress?: (done: number, total: number) => void): Promise<Stems | null> {
    const id = ++this.latest;
    this.cancel();
    if (isPlainSpeed(speed)) return base;
    const tracks = orderedKeys(Object.keys(base).filter((name) => base[name]));
    const key = renderKey(speed, tracks);
    const kept = this.renders.get(key);
    if (kept) return kept;
    let done = 0;
    onProgress?.(0, tracks.length);
    const controller = new AbortController();
    this.running = controller;
    let entries: (readonly [string, PcmAudio])[];
    try {
      entries = await Promise.all(
        tracks.map(async (track) => {
          const out = await this.stretch(base[track]!, trackStretch(speed, track), controller.signal);
          onProgress?.(++done, tracks.length);
          return [track, out] as const;
        }),
      );
    } catch (error) {
      // A newer request aborted this one, which is not a failure.
      if (controller.signal.aborted || id !== this.latest) return null;
      // One stem failed: the others are of no use, so they stop too.
      controller.abort();
      throw error;
    } finally {
      if (this.running === controller) this.running = null;
    }
    if (id !== this.latest) return null;
    const stems = Object.fromEntries(entries) as Stems;
    this.keep(key, stems);
    return stems;
  }

  /** Aborts the renders that are running or waiting, which frees their buffers. */
  cancel(): void {
    this.running?.abort();
    this.running = null;
  }

  /** Drops every render, for a song that is no longer the one playing. */
  clear(): void {
    this.latest++;
    this.cancel();
    this.renders.clear();
  }

  private keep(key: string, stems: Stems): void {
    this.renders.delete(key);
    this.renders.set(key, stems);
    while (this.renders.size > KEPT_RENDERS) this.renders.delete(this.renders.keys().next().value!);
  }
}
