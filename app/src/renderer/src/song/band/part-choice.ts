// Which drum and bass parts a song plays: the split's original stem, the generated track, or both. Pure, so the mix can be tested without
// WebAudio. The choice only changes mute flags, so the user's volumes and pans survive switching back and forth.

import type { Mix } from "@/song/stems/mix";
import { defaultStemMix } from "@/song/stems/mix";
import type { TrackInfo } from "@/song/tracks";
import type { PartPresence } from "./detect";
import { GENERATED_PART_NAMES } from "./generated-names";

export const PART_KINDS = ["drums", "bass"] as const;
export type PartKind = (typeof PART_KINDS)[number];

export type PartChoice = "original" | "generated" | "both";
export type PartChoices = Record<PartKind, PartChoice>;

const CHOICES: readonly PartChoice[] = ["original", "generated", "both"];

/** The choices a song with nothing saved starts from: every part plays its original. */
export const ORIGINAL_PARTS: PartChoices = { drums: "original", bass: "original" };

/**
 * The track keys a part's choice applies to. `original` is the split's stem, `generated` the generated track; either may be missing. A
 * song with no split has no original, so only the generated track is controlled there.
 */
export type PartKeys = Partial<Record<PartKind, { original?: string; generated?: string }>>;

/**
 * The choice a part starts with when the song has none saved. A part the split found missing (absent or partial) starts on its
 * generated track when there is one. A part that was present, or not checked, keeps both, which is how such a song already plays.
 */
export function defaultPartChoice(presence: PartPresence, hasGenerated: boolean): PartChoice {
  if (!hasGenerated) return "original";
  if (presence === "absent" || presence === "partial") return "generated";
  if (presence === "present") return "original";
  return "both";
}

/** The choice each part starts with when the song saved none, from what the split found and which generated tracks the song has. */
export function defaultPartChoices(missing: Partial<Record<PartKind, PartPresence>> | null | undefined, keys: PartKeys): PartChoices {
  return {
    drums: defaultPartChoice(missing?.drums ?? "unknown", keys.drums?.generated !== undefined),
    bass: defaultPartChoice(missing?.bass ?? "unknown", keys.bass?.generated !== undefined),
  };
}

/**
 * The choices read from the song's saved `partChoice` option. Each part reads its own saved value, and a missing or invalid value takes
 * the fallback for that part, so an old or damaged entry never breaks the mix.
 */
export function readPartChoices(saved: unknown, fallback: PartChoices): PartChoices {
  const record = saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const read = (kind: PartKind): PartChoice => {
    const value = record[kind];
    return CHOICES.includes(value as PartChoice) ? (value as PartChoice) : fallback[kind];
  };
  return { drums: read("drums"), bass: read("bass") };
}

/** The track keys each part's choice applies to: the stems the song has, and the user tracks that carry the generated part's name. */
export function partKeysOf(tracks: Readonly<Record<string, TrackInfo>>, stems: Readonly<Record<string, unknown>> | null | undefined): PartKeys {
  const keys: PartKeys = {};
  for (const kind of PART_KINDS) {
    const original = stems?.[kind] ? kind : undefined;
    const generated = Object.entries(tracks).find(([, info]) => info.kind === "user" && info.name === GENERATED_PART_NAMES[kind])?.[0];
    if (original === undefined && generated === undefined) continue;
    keys[kind] = { original, generated };
  }
  return keys;
}

/**
 * The mix with each part's original and generated track muted or unmuted to match its choice. A choice that needs a generated track the
 * song does not have falls back to the original. A part with no original stem plays its generated track whenever it has one, since
 * "original" would otherwise silence the part. Other tracks, volumes and pans are untouched.
 */
export function applyPartChoices(mix: Mix, choices: PartChoices, keys: PartKeys): Mix {
  const next: Mix = { ...mix };
  for (const kind of PART_KINDS) {
    const part = keys[kind];
    if (!part) continue;
    const { original, generated } = playingTracks(choices[kind], part);
    if (part.original !== undefined) next[part.original] = { ...(next[part.original] ?? defaultStemMix()), mute: !original };
    if (part.generated !== undefined) next[part.generated] = { ...(next[part.generated] ?? defaultStemMix()), mute: !generated };
  }
  return next;
}

/** Whether a part's original and generated tracks play under its choice. The rule is shared by the mute levels and the mixer's badges. */
function playingTracks(choice: PartChoice, part: { original?: string; generated?: string }): { original: boolean; generated: boolean } {
  const shown = effectiveChoice(choice, part);
  return {
    original: part.original !== undefined && (shown === "original" || shown === "both"),
    generated: part.generated !== undefined && shown !== "original",
  };
}

/**
 * The choice that actually plays for a part. The saved choice is kept as it is, so it comes back when the generated track is restored, but
 * a part with no generated track plays its original, and a part with no original stem plays its generated track.
 */
export function effectiveChoice(choice: PartChoice, part: { original?: string; generated?: string }): PartChoice {
  if (part.generated === undefined) return "original";
  if (part.original === undefined) return "generated";
  return choice;
}

/**
 * The tracks that "What plays" silences, by track key, with the text the mixer shows on them: the original stem is off when the
 * generated part plays, and the generated track is off when the original plays. A track that plays is not in the result.
 */
export function silencedByChoice(choices: PartChoices, keys: PartKeys): Record<string, string> {
  const off: Record<string, string> = {};
  for (const kind of PART_KINDS) {
    const part = keys[kind];
    if (!part) continue;
    const playing = playingTracks(choices[kind], part);
    if (part.original !== undefined && !playing.original) off[part.original] = "Off: generated plays";
    if (part.generated !== undefined && !playing.generated) off[part.generated] = "Off: original plays";
  }
  return off;
}
