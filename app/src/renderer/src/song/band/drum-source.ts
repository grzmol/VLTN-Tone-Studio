// Which drums a song plays when it starts. A song can choose the RC-10R pedal, but the pedal only plays when the song has automatic
// RC-10R cues and the cues are armed (output connected, Send cues on). Otherwise the song's fallback drums play, so a show never starts
// with no drums. Pure, so every combination can be tested.

import type { DrumFallback, PartChoice, PartChoices } from "./part-choice";

export type DrumsReason = "pedal-ready" | "no-cues" | "not-armed" | "chosen";
export interface DrumSource {
  /** What plays: the pedal, or one of the app's own drum choices. */
  plays: "pedal" | "original" | "generated" | "both";
  reason: DrumsReason;
}

/** Decides the drums for one song start. `fallback` is the already defaulted fallback (see pedalFallbackOf). */
export function resolveDrums(input: { choice: PartChoice; fallback: DrumFallback; hasRhythmCues: boolean; armed: boolean }): DrumSource {
  const { choice, fallback, hasRhythmCues, armed } = input;
  if (choice !== "pedal") return { plays: choice, reason: "chosen" };
  if (!hasRhythmCues) return { plays: fallback, reason: "no-cues" };
  if (!armed) return { plays: fallback, reason: "not-armed" };
  return { plays: "pedal", reason: "pedal-ready" };
}

/** True when the song chose the pedal but its fallback drums play instead. */
export const isFallback = (choice: PartChoice, source: DrumSource): boolean => choice === "pedal" && source.plays !== "pedal";

/** The song's choices with the drums replaced by what really plays, for the mix and the mixer badges. */
export function withResolvedDrums(choices: PartChoices, source: DrumSource): PartChoices {
  return { ...choices, drums: source.plays };
}

/** The reason the pedal could not play, as a sentence for the toast and the chip's title. Empty when it plays or was not chosen. */
export function fallbackReason(source: DrumSource, outputConnected: boolean): string {
  if (source.reason === "no-cues") return "this song has no automatic RC-10R drums";
  if (source.reason !== "not-armed") return "";
  return outputConnected ? "Send cues off" : "output disconnected";
}

/**
 * Whether a held decision should follow the live armed state. The drums are decided while stopped and held while playing, so the
 * drum tracks never switch mid-song: the next Play decides again.
 */
export const settledArmed = (held: boolean, armed: boolean, playing: boolean): boolean => (playing ? held : armed);

/** What the transport chip says for a song's drums, and how to colour it. */
export function drumsChip(choice: PartChoice, source: DrumSource, fallbackWhy: string): { text: string; tone: "ok" | "warn" | "neutral"; title: string } {
  const name = { pedal: "RC-10R", original: "Original", generated: "Generated", both: "Both" }[source.plays];
  if (choice !== "pedal") return { text: `Drums: ${name}`, tone: "neutral", title: "Open This song → What plays" };
  if (source.plays === "pedal") return { text: "Drums: RC-10R", tone: "ok", title: "The RC-10R plays the drums" };
  return { text: `Drums: ${name} (fallback)`, tone: "warn", title: `RC-10R not used: ${fallbackWhy}` };
}
