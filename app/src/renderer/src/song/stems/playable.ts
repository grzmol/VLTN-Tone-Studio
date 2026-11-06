import type { PcmAudio, Stems } from "../types";

/**
 * The stems a song plays from: its split stems, or its whole source as one stem when it was saved without a split. The session and the
 * background preload both use this, so a player prepared ahead is the one the session would have built at the join.
 */
export function playableStems(stems: Stems | null, source: PcmAudio): Stems {
  return stems && Object.keys(stems).length ? stems : { other: source };
}
