// Whether the lyrics step of a run may transcribe a song's chart (spec 80). A run makes lyrics for a song with none, and replaces a chart
// that an earlier run made for different audio, which is the re-split case. It never replaces a chart the performer wrote or timed, a
// chart from before 0.9.2 (its source is not known), or a chart pasted and timed by hand.

import { chartSourceOf } from "../performance/lyrics-chart";
import type { LyricsSkip } from "./batch";

/** The reason a run leaves a song's chart alone, or null when it may transcribe it. */
export function lyricsRunSkip(text: string, options: Record<string, unknown>, audioChanged: boolean): LyricsSkip | null {
  if (!text.trim()) return null;
  const source = chartSourceOf(options);
  if (source === "user") return "user";
  if (source === "aligned") return "pasted";
  if (source === "unknown") return "unknown";
  return audioChanged ? null : "made";
}
