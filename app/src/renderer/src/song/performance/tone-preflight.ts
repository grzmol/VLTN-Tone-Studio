// The tone check of the playlist preflight (spec 136): for each song, the files its bass and drum tone chains name must be on this
// computer. A song regenerated after a cache clear, on a second laptop or after restoring a backup (which does not carry the tone files)
// would otherwise get a clean part without a word.

import type { LibraryPreflightSong } from "@shared/song-library";
import { parseBandSettings } from "../band/arrangement";
import type { PartToneFiles } from "../band/part-tone";
import { missingToneFiles, missingToneWarning } from "../band/tone-check";
import type { PlaylistCheck } from "./playlist-preflight";

/** The band settings a saved song carries in its options, or null when it has none or its options cannot be read. */
function savedBand(song: NonNullable<LibraryPreflightSong["song"]>): unknown {
  try {
    const options: unknown = JSON.parse(song.settings[":options"] || "{}");
    return typeof options === "object" && options !== null ? (options as Record<string, unknown>).band : null;
  } catch {
    return null;
  }
}

/**
 * The report with a warning for each song whose tone chain names a file that is not on this computer, and the missing files kept on the
 * entry so the report can offer to download them. A song with no tone chain is left as it is.
 */
export async function withToneWarnings(
  report: readonly PlaylistCheck[],
  ids: readonly string[],
  snapshot: readonly LibraryPreflightSong[],
  files: PartToneFiles,
): Promise<PlaylistCheck[]> {
  const byId = new Map(snapshot.map((saved) => [saved.id, saved]));
  return Promise.all(
    report.map(async (check) => {
      const song = byId.get(ids[check.entry - 1])?.song;
      const band = song ? savedBand(song) : null;
      if (!band) return check;
      const missing = await missingToneFiles(parseBandSettings(band), files);
      if (!missing.length) return check;
      return { ...check, warnings: [...check.warnings, ...missing.map(missingToneWarning)], missingTones: missing };
    }),
  );
}
