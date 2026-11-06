import type { LibrarySong } from "@shared/song-library";
import { speedFromOptions } from "./speed";
import { shapeFromOptions } from "./song-shape";
import { playRange } from "./transition";

/*
 * The time a song takes to play in a set (pure): its trimmed length, at the speed it is saved at. A trim that starts past its end, or no
 * usable length, counts as zero rather than a negative time. Set totals and queue times use this, so they match what plays.
 */

/** The seconds a song plays for in a set: its trimmed range divided by its speed. */
export function runningSeconds(song: LibrarySong): number {
  const options = song.settings[":options"] ?? "";
  const range = playRange(song.duration, shapeFromOptions(options));
  const length = Math.max(0, range.end - range.start);
  const rate = speedFromOptions(options).rate;
  return rate > 0 ? length / rate : length;
}
