// The vocals the lyrics are sung from (spec 80). A split song's vocals stem is used first. An imported song with no vocals stem uses the
// user track named like vocals, so a multitrack import with "Lead Vox" gets lyrics without a split.

import type { TrackInfo } from "../tracks";
import type { PcmAudio, Stems } from "../types";

/** The names a user track takes to be the vocals: vocal, vocals, vox, lead vocal, lead vocals or lead vox, in any case. */
export const VOCALS_NAME = /^(lead\s*)?(vocals?|vox)$/i;

/** The vocals to transcribe: the split's vocals stem, or else a user track whose name is in VOCALS_NAME. Null when there are none. */
export function vocalsOf(stems: Stems | null, tracks: Record<string, TrackInfo>): PcmAudio | null {
  if (!stems) return null;
  if (stems.vocals) return stems.vocals;
  const found = Object.entries(tracks).find(([key, info]) => info.kind === "user" && VOCALS_NAME.test(info.name.trim()) && stems[key as keyof Stems]);
  return found ? (stems[found[0] as keyof Stems] ?? null) : null;
}

/** The stems a lyrics step reads, with `vocals` set to the vocals it sings from. Other stems are kept as they are. */
export function stemsWithVocals(stems: Stems | null, vocals: PcmAudio | null): Stems | null {
  if (!vocals) return stems;
  return { ...stems, vocals };
}
