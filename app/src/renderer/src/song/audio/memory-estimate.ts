// How much memory a song's audio takes, by who holds it (spec 127). Pure: it reads shapes, never samples.

/** One track's audio as held somewhere. `key` is the array or buffer itself, so one held by two holders counts once. */
export interface HeldTrack {
  channels: number;
  frames: number;
  key?: object;
}

export interface Footprint {
  /** PCM in the song store (source and stems) */
  store: number;
  /** The playing song's buffers */
  player: number;
  /** The next playlist song: its PCM and its buffers */
  prepared: number;
  /** Buffers of a speed render, which play instead of the song's own */
  renders: number;
  total: number;
}

/** Bytes of float32 audio: 4 per sample per channel. */
export function audioBytes(tracks: { channels: number; frames: number }[]): number {
  return tracks.reduce((sum, t) => sum + t.channels * t.frames * 4, 0);
}

/** The bytes of each holder. A track already counted under an earlier holder is not counted again. */
export function songFootprint(holders: { store: HeldTrack[]; player: HeldTrack[]; prepared: HeldTrack[]; renders: HeldTrack[] }): Footprint {
  const seen = new Set<object>();
  const count = (tracks: HeldTrack[]) =>
    audioBytes(
      tracks.filter((t) => {
        if (!t.key) return true;
        if (seen.has(t.key)) return false;
        seen.add(t.key);
        return true;
      }),
    );
  const store = count(holders.store);
  const player = count(holders.player);
  const prepared = count(holders.prepared);
  const renders = count(holders.renders);
  return { store, player, prepared, renders, total: store + player + prepared + renders };
}

/** Free memory under this, or a renderer over `RENDERER_WARN_KB`, is worth a warning line. */
export const FREE_WARN_KB = 1.5 * 1024 * 1024;
export const RENDERER_WARN_KB = 3.5 * 1024 * 1024;

const gb = (kb: number) => `${(kb / 1024 / 1024).toFixed(1)} GB`;
export const bytesText = (bytes: number) => gb(bytes / 1024);

/** The lines MIDI health shows: the memory sentence and, when memory is short, a warning. */
export function memoryLines(memory: { workingSetKb: number; peakWorkingSetKb: number; totalKb: number; freeKb: number } | null, footprint: Footprint): { text: string; warning: string } {
  const audio = `this song's audio ${bytesText(footprint.total)}`;
  if (!memory) return { text: `Memory: ${audio}`, warning: "" };
  const text = `Memory: app ${gb(memory.workingSetKb)} (peak ${gb(memory.peakWorkingSetKb)}), ${audio}, free on this Mac ${gb(memory.freeKb)}`;
  const short = memory.freeKb < FREE_WARN_KB;
  const big = memory.workingSetKb > RENDERER_WARN_KB;
  const warning =
    short || big ? `${short ? "Free memory is low" : "The app is using a lot of memory"}. A long set with big songs may stutter; close other apps or split the set.` : "";
  return { text, warning };
}
