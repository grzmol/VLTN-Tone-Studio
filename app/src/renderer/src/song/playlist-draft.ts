import { overridesFor, type EntryOverride } from "@shared/entry-overrides";
import type { Playlist, PlaylistSet } from "@shared/song-library";

/*
 * The draft of a static playlist: what its editor changes before the user saves it. Nothing here touches the library. The editor starts
 * from the saved playlist, and only Save writes the draft out, so a half-made edit never reaches the saved list.
 */

/** A static playlist's name, entries, set headings and per-entry overrides, as the editor holds them. */
export interface PlaylistDraft {
  name: string;
  songs: string[];
  sets: PlaylistSet[];
  /** Lined up with `songs`, the same as the saved playlist's overrides. */
  overrides: (EntryOverride | null)[];
}

/** The draft a saved playlist starts from. Missing sets and overrides become empty, so a draft always compares the same way. */
export function draftOf(playlist: Playlist): PlaylistDraft {
  return {
    name: playlist.name,
    songs: [...playlist.songs],
    sets: [...(playlist.sets ?? [])],
    overrides: overridesFor(playlist.songs.length, playlist.overrides),
  };
}

/** Whether the draft has changed from the snapshot it was started from. */
export function isDirty(draft: PlaylistDraft, base: PlaylistDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(base);
}

/** What Save writes: the name without its outer spaces, and the entries, sets and overrides as they are. */
export function changeOf(draft: PlaylistDraft): Pick<Playlist, "name" | "songs" | "sets" | "overrides"> {
  return { name: draft.name.trim(), songs: draft.songs, sets: draft.sets, overrides: draft.overrides };
}

/**
 * Inserts songs before the entry at `at`, with no overrides. A set heading at `at` moves down with them, so the songs belong to the block
 * before it: inserting at the end of a set adds to that set, and inserting at the end of the playlist adds to its last set.
 */
export function insertSongs(draft: PlaylistDraft, at: number, ids: string[]): PlaylistDraft {
  const songs = [...draft.songs];
  songs.splice(at, 0, ...ids);
  const overrides = [...draft.overrides];
  overrides.splice(at, 0, ...ids.map(() => null));
  const sets = draft.sets.map((set) => (set.start >= at ? { ...set, start: set.start + ids.length } : set));
  return { ...draft, songs, overrides, sets };
}
