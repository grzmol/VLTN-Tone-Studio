// Offering to resume after a renderer crash (spec 120). On start, a fresh resume point loads its playlist entry paused; the performer then
// presses Resume. Nothing here starts audio or sends MIDI: the song waits for Play like any entry that is set to wait.
import { create } from "zustand";
import { overridesFor, withOverride } from "@shared/entry-overrides";
import { useSongLibrary } from "@/song/library";
import { clearResumePoint, holdResumePoint, loadResumePoint, type ResumePoint } from "./resume-point";

/** The point on offer, or null. The banner on the Performance tab shows it. */
export const useResumeOffer = create<{ point: ResumePoint | null }>(() => ({ point: null }));

/** Whether a point found at start is offered: after a crash always, otherwise only if the music was playing when the app went away. */
export function shouldOffer(point: ResumePoint, recovered: boolean): boolean {
  return recovered || point.playing;
}

let started = false;

/**
 * Loads the saved place paused, and puts the offer up. The old point is held so the freshly loaded, rewound song does not overwrite it
 * while the offer is open. A song that is gone from the library drops the offer instead of guessing.
 */
export async function startResumeOffer(recovered: boolean, now = Date.now()): Promise<void> {
  if (started) return;
  started = true;
  const point = loadResumePoint(now);
  if (!point || !shouldOffer(point, recovered)) return;
  holdResumePoint(true);
  useResumeOffer.setState({ point });
  const library = useSongLibrary.getState();
  // "Wait for Play" is the entry setting the playlist already honours, so the song loads and stays paused with no special path.
  const base = overridesFor(point.queue.length, point.overrides);
  const overrides = withOverride(base, point.position, { ...base[point.position], autoplay: false });
  if (point.queue.length === 1 && !point.playlistId) await library.load(point.songId, point.queue, 0, overrides);
  else await library.playPlaylist(point.queue, point.position, point.playlistId ?? undefined, overrides);
  const after = useSongLibrary.getState();
  if (after.queue[after.position] !== point.songId) dismissResume();
}

/** Closes the offer and forgets the point. */
export function dismissResume(): void {
  useResumeOffer.setState({ point: null });
  clearResumePoint();
}

/** For tests: lets `startResumeOffer` run again. */
export function resetResumeOffer(): void {
  started = false;
  useResumeOffer.setState({ point: null });
}
