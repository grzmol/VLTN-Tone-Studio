import type { LibrarySong, Playlist, PlaylistSet } from "./song-library";
import type { EntryOverride } from "./entry-overrides";

/*
 * Playlist sets and entry edits (pure). A set header sits before the entry at its `start`; a set runs to the next header or the end.
 * Entries are edited by index, so the set starts are moved with them here, and an empty set is dropped rather than left pointing at
 * the wrong song. Nothing here touches the audio or the queue.
 */

export interface BlockSummary {
  /** The set, or null for the entries before the first set (or the whole playlist when it has no sets). */
  set: PlaylistSet | null;
  name: string;
  /** The first entry index in the block. */
  start: number;
  /** One past the last entry index. */
  end: number;
  count: number;
  /** The running time, in seconds, of the songs that are in the library. */
  seconds: number;
}

/**
 * The blocks of a playlist, in order, with the count and running time of each. The whole playlist is one block when it has no sets. Running
 * time is `timeOf` of each song; the default is the song's length.
 */
export function blockSummaries(
  playlist: Playlist,
  songs: readonly LibrarySong[],
  timeOf: (song: LibrarySong) => number = (song) => song.duration,
): BlockSummary[] {
  const byId = new Map(songs.map((song) => [song.id, song]));
  const sets = [...(playlist.sets ?? [])].sort((a, b) => a.start - b.start);
  const starts: { set: PlaylistSet | null; start: number }[] = [];
  if (!sets.length || sets[0].start > 0) starts.push({ set: null, start: 0 });
  for (const set of sets) starts.push({ set, start: set.start });
  return starts.map((block, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].start : playlist.songs.length;
    const entries = playlist.songs.slice(block.start, end);
    const seconds = entries.reduce((sum, id) => {
      const song = byId.get(id);
      return song ? sum + timeOf(song) : sum;
    }, 0);
    return { set: block.set, name: block.set?.name ?? "", start: block.start, end, count: entries.length, seconds };
  });
}

/** Removes an entry at `index` and moves the set starts that come after it. A set that is left empty is dropped. */
export function removeEntry(playlist: Playlist, index: number): Pick<Playlist, "songs" | "sets" | "overrides"> {
  const songs = playlist.songs.filter((_, i) => i !== index);
  const sets = (playlist.sets ?? []).map((set) => (set.start > index ? { ...set, start: set.start - 1 } : set));
  const overrides = playlist.overrides?.filter((_, i) => i !== index);
  return { songs, sets: normaliseSets(sets, songs.length), overrides };
}

/**
 * Moves the entry at `from` to `to`. Set headers stay at their positions, so a set may gain or lose the song that moved. The entry's
 * overrides move with it.
 */
export function moveEntry(playlist: Playlist, from: number, to: number): Pick<Playlist, "songs" | "sets" | "overrides"> {
  const songs = [...playlist.songs];
  const [moved] = songs.splice(from, 1);
  const target = Math.min(Math.max(to, 0), songs.length);
  songs.splice(target, 0, moved);
  let overrides: (EntryOverride | null)[] | undefined;
  if (playlist.overrides) {
    overrides = [...playlist.overrides];
    const [movedOverride] = overrides.splice(from, 1);
    overrides.splice(target, 0, movedOverride ?? null);
  }
  return { songs, sets: normaliseSets(playlist.sets ?? [], songs.length), overrides };
}

/** Adds a set header before the entry at `at`. Refused when one already starts there, or the position is out of range. */
export function addSet(playlist: Playlist, name: string, at: number, id: string): { ok: true; sets: PlaylistSet[] } | { ok: false; reason: string } {
  if (at < 0 || at >= playlist.songs.length) return { ok: false, reason: "A set starts on a song in the playlist." };
  const sets = playlist.sets ?? [];
  if (sets.some((set) => set.start === at)) return { ok: false, reason: "A set already starts there." };
  const next = [...sets, { id, name: name.trim(), start: at }].sort((a, b) => a.start - b.start);
  return { ok: true, sets: next };
}

/** Renames a set. Blank names are refused, so a block always has a heading. */
export function renameSet(sets: readonly PlaylistSet[], id: string, name: string): PlaylistSet[] {
  const trimmed = name.trim();
  if (!trimmed) return [...sets];
  return sets.map((set) => (set.id === id ? { ...set, name: trimmed } : set));
}

/** Removes a set's header. Its songs stay in the playlist and join the block before it. */
export function deleteSet(sets: readonly PlaylistSet[], id: string): PlaylistSet[] {
  return sets.filter((set) => set.id !== id);
}

/**
 * Keeps set starts inside the playlist, in order, one per entry. Starts past the end are dropped. Where two sets start on the same entry,
 * the earlier one is empty and is dropped, so the later heading names the block.
 */
export function normaliseSets(sets: readonly PlaylistSet[], length: number): PlaylistSet[] {
  const inRange = sets.filter((set) => set.start >= 0 && set.start < length).sort((a, b) => a.start - b.start);
  const result: PlaylistSet[] = [];
  for (const set of inRange) {
    if (result.length && result[result.length - 1].start === set.start) result.pop();
    result.push(set);
  }
  return result;
}
