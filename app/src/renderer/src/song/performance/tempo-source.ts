/**
 * Where a song's tempo came from. Earlier builds saved 120 for every song that was never given a tempo, so a saved 120 with no source is
 * the old default, not a choice.
 */
export type TempoSource = "manual" | "tap" | "chart";

const SOURCES: readonly TempoSource[] = ["manual", "tap", "chart"];

/** The tempo source saved in a song's options. Anything else, including a missing field, is no source. */
export function readTempoSource(options: unknown): TempoSource | null {
  const value = options && typeof options === "object" ? (options as { tempoSource?: unknown }).tempoSource : undefined;
  return SOURCES.find((source) => source === value) ?? null;
}
