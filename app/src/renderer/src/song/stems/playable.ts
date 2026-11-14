import type { PcmAudio, Stems } from "../types";

/**
 * The stems a song plays from: its split stems, or its whole source as one stem when it was saved without a split. The session and the
 * background preload both use this, so a player prepared ahead is the one the session would have built at the join. `leaveOut` names
 * stems that are not played as tracks.
 */
export function playableStems(stems: Stems | null, source: PcmAudio, leaveOut: readonly string[] = []): Stems {
  if (!stems || !Object.keys(stems).length) return { other: source };
  // The extras of a generated part (band/extras.ts) are short buffers the session plays at moments of its own, not tracks of the song.
  const kept = leaveOut.length ? Object.fromEntries(Object.entries(stems).filter(([key]) => !leaveOut.includes(key))) : stems;
  return Object.keys(kept).length ? (kept as Stems) : { other: source };
}
