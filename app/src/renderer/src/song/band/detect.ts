// Missing-part detection: does a split song have drums or bass? A stem that is far below the mix in most of the song is
// treated as missing, so the Band panel can offer to generate that part. Pure functions over the audio already in memory:
// no WebAudio and no store, and nothing is copied.

import type { Section } from "../performance/sections";
import type { PcmAudio, Stems } from "../types";

/** Length of one comparison window, in seconds. */
export const WINDOW_SECONDS = 0.4;
/** Windows where the mix is quieter than this (dBFS) are not counted: silence says nothing about whether a part is there. */
export const MIN_MIX_DB = -50;
/**
 * A window is absent when the stem is more than this many dB below the mix in it. Demucs leaves a missing stem around −40 to −30 dB
 * rather than silence, so this has to sit above that leakage. Tuned against real splits later.
 */
export const ABSENT_BELOW_MIX_DB = 35;
/** A part is absent from the song, or from a section, when at least this share of its counted windows are absent. */
export const ABSENT_SHARE = 0.85;

/** `unknown` when the split has no stem for that part (no split, or a model without it). */
export type PartPresence = "present" | "partial" | "absent" | "unknown";

export interface MissingParts {
  drums: PartPresence;
  bass: PartPresence;
  /** Ids of the sections where a part is absent, when it is `partial`. Empty otherwise. */
  absentSections: { drums: string[]; bass: string[] };
}

const SKIPPED = 0;
const PRESENT = 1;
const ABSENT = 2;

/** Mean power in dB of each window, over every channel. Windows past the end of the audio are not made. */
function levelsDb(audio: PcmAudio, count: number, windowSamples: number): Float64Array {
  const levels = new Float64Array(count);
  for (let w = 0; w < count; w++) {
    let energy = 0;
    for (const channel of audio.channels) {
      for (let i = w * windowSamples, end = i + windowSamples; i < end; i++) energy += channel[i] * channel[i];
    }
    levels[w] = 10 * Math.log10(energy / (windowSamples * audio.channels.length));
  }
  return levels;
}

/** Works out one part from the mix's and the stem's window levels. A section named here is absent from the part, not from the song. */
function presenceOf(
  mix: PcmAudio,
  mixLevels: Float64Array,
  stemLevels: Float64Array,
  sections: readonly Section[],
  windowSamples: number,
): { presence: PartPresence; absentSections: string[] } {
  const count = Math.min(mixLevels.length, stemLevels.length);
  const states = new Uint8Array(count);
  let counted = 0,
    absent = 0;
  for (let w = 0; w < count; w++) {
    if (mixLevels[w] <= MIN_MIX_DB) continue;
    counted++;
    if (stemLevels[w] < mixLevels[w] - ABSENT_BELOW_MIX_DB) {
      states[w] = ABSENT;
      absent++;
    } else states[w] = PRESENT;
  }
  // Nothing loud enough to judge (a silent mix): the part is not called absent.
  if (!counted) return { presence: "present", absentSections: [] };
  if (absent >= counted * ABSENT_SHARE) return { presence: "absent", absentSections: [] };

  const absentSections = sections
    .filter((section) => {
      // A window belongs to a section when it starts inside it.
      const first = Math.ceil((section.start * mix.sampleRate) / windowSamples),
        last = Math.min(count, Math.ceil((section.end * mix.sampleRate) / windowSamples));
      let sectionCounted = 0,
        sectionAbsent = 0;
      for (let w = first; w < last; w++) {
        if (states[w] === SKIPPED) continue;
        sectionCounted++;
        if (states[w] === ABSENT) sectionAbsent++;
      }
      return sectionCounted > 0 && sectionAbsent >= sectionCounted * ABSENT_SHARE;
    })
    .map((section) => section.id);
  return absentSections.length ? { presence: "partial", absentSections } : { presence: "present", absentSections: [] };
}

/**
 * Compares the drums and bass stems of a split with the mix. Pass the song's sections to find a part that is missing from only some of
 * the song (for example, no drums in the intro). Without sections, a part is either absent or present.
 */
export function detectMissingParts(mix: PcmAudio, stems: Stems, sections: readonly Section[] = []): MissingParts {
  const windowSamples = Math.max(1, Math.round(WINDOW_SECONDS * mix.sampleRate));
  const mixCount = mix.channels.length ? Math.floor(mix.channels[0].length / windowSamples) : 0;
  const mixLevels = levelsDb(mix, mixCount, windowSamples);
  const result: MissingParts = { drums: "unknown", bass: "unknown", absentSections: { drums: [], bass: [] } };
  for (const part of ["drums", "bass"] as const) {
    const stem = stems[part];
    if (!stem || !stem.channels.length) continue;
    const stemCount = Math.floor(stem.channels[0].length / windowSamples);
    const { presence, absentSections } = presenceOf(mix, mixLevels, levelsDb(stem, stemCount, windowSamples), sections, windowSamples);
    result[part] = presence;
    result.absentSections[part] = absentSections;
  }
  return result;
}
