/*
 * Per-entry overrides (pure). A playlist entry, and a queue entry, may override a song's own end behaviour and whether the song starts by
 * itself. Overrides are kept in an array that lines up with the entries (`overrides[i]` belongs to `songs[i]`), so the entries themselves
 * stay plain song ids. A null entry, or a missing array, means "as the song is saved".
 */

export const ENTRY_END_BEHAVIOURS = ["next", "stop", "loop"] as const;
export type EntryEndBehaviour = (typeof ENTRY_END_BEHAVIOURS)[number];

export interface EntryOverride {
  /** false: the song loads and waits for Play instead of starting by itself. Missing means it starts by itself. */
  autoplay?: boolean;
  /** Replaces the song's own end behaviour for this entry. Missing means the song's own. */
  endBehaviour?: EntryEndBehaviour;
}

const KEYS = ["autoplay", "endBehaviour"];

/** Whether a value is a well-formed override: an object with only the known keys, each of the right type. */
export function isEntryOverride(value: unknown): value is EntryOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).some((key) => !KEYS.includes(key))) return false;
  if (entry.autoplay !== undefined && typeof entry.autoplay !== "boolean") return false;
  if (entry.endBehaviour !== undefined && !(ENTRY_END_BEHAVIOURS as readonly unknown[]).includes(entry.endBehaviour)) return false;
  return true;
}

/** The override as it is stored: defaults are dropped, and an override with nothing left is null. */
export function normaliseOverride(override: EntryOverride | null | undefined): EntryOverride | null {
  if (!override) return null;
  const next: EntryOverride = {};
  if (override.autoplay === false) next.autoplay = false;
  if (override.endBehaviour !== undefined) next.endBehaviour = override.endBehaviour;
  return next.autoplay === undefined && next.endBehaviour === undefined ? null : next;
}

/** The overrides for `length` entries: the given ones, with null for any entry that has none. */
export function overridesFor(length: number, overrides?: readonly (EntryOverride | null)[] | null): (EntryOverride | null)[] {
  return Array.from({ length }, (_, i) => overrides?.[i] ?? null);
}

/** The overrides with entry `index` set to `override`. Other entries keep theirs. */
export function withOverride(overrides: readonly (EntryOverride | null)[], index: number, override: EntryOverride | null): (EntryOverride | null)[] {
  return overrides.map((current, i) => (i === index ? normaliseOverride(override) : current));
}
