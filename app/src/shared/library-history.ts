import { HISTORY_MAX, type HistoryEntry, type LibrarySong } from "./song-library";

/*
 * Play history (pure). A play is recorded once a song has played to its halfway point, so a song that was started by mistake and stopped
 * at once does not count. The history keeps the newest HISTORY_MAX entries; an older play falls off the end, so the index stays small.
 */

/** Whether a song that has played `position` seconds of `duration` counts as played. Halfway is enough; the song need not finish. */
export function countsAsPlayed(position: number, duration: number): boolean {
  return Number.isFinite(position) && Number.isFinite(duration) && duration > 0 && position >= duration / 2;
}

/** The history with `entry` added as the newest play. Bounded: the oldest entries go first when the history is full. */
export function appendPlay(history: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [...history, entry];
  return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
}

/** The plays at or after `since` (an ISO date or time), oldest first. An unreadable date gives an empty list rather than everything. */
export function playsSince(history: readonly HistoryEntry[], since: string): HistoryEntry[] {
  const from = Date.parse(since);
  if (Number.isNaN(from)) return [];
  return history.filter((entry) => Date.parse(entry.at) >= from);
}

/**
 * The songs of the plays since `since`, in the order they were played, for a new playlist. A song played twice appears twice, as it was
 * played twice. Songs no longer in the library are skipped.
 */
export function songsFromHistory(songs: readonly LibrarySong[], history: readonly HistoryEntry[], since: string): string[] {
  const known = new Set(songs.map((song) => song.id));
  return playsSince(history, since)
    .map((entry) => entry.songId)
    .filter((id) => known.has(id));
}

/** The history without the plays of one song, for when that song is removed from the library. */
export function withoutSong(history: readonly HistoryEntry[], songId: string): HistoryEntry[] {
  return history.filter((entry) => entry.songId !== songId);
}
