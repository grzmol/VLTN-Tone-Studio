// The lyrics options of a saved or open song. Kept apart from lyrics-options.ts, which the lyrics worker imports: the song settings
// reach the host through `window`, and a worker has no `window`, so the worker must never load them.

import { lyricsOptionsFrom, type LyricsOptions } from "./lyrics-options";
import { readOptions } from "./settings";

/** The lyrics options for a song: the remembered model and quality, and the song's own language. */
export function lyricsOptions(key: string): LyricsOptions {
  return lyricsOptionsFrom(readOptions<{ lyricsLanguage?: unknown }>(key, {}));
}
