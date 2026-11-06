/**
 * Where an unpackaged (development) run keeps its data: next to the installed app's folder, with " (dev)" added, so a
 * development build never reads or changes the songs, playlists and settings of the installed app. Returns null when
 * the folder should stay as it is: in the packaged app, or when `--user-data-dir` already chose one.
 */
export function devUserDataPath(current: string, packaged: boolean, customDir: boolean): string | null {
  if (packaged || customDir) return null;
  return current + " (dev)";
}
