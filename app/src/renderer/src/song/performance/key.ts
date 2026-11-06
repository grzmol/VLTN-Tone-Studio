export const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const SONG_KEYS = KEY_NAMES.flatMap((root) => [`${root} major`, `${root} minor`]);

/**
 * The key a song's chord names are spelled by: the performer's key when set, else the key saved on the library entry (an import or the
 * song details). Undefined when neither is known, so the chords keep their spelling.
 */
export function effectiveSongKey(override: string, libraryKey: string | undefined): string | undefined {
  return override || libraryKey || undefined;
}
