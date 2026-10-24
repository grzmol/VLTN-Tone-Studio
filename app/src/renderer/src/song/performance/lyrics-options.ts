export const LYRIC_LANGUAGES = ['auto', 'english', 'afrikaans', 'dutch', 'french', 'german', 'italian', 'portuguese', 'spanish'] as const;
export type LyricsLanguage = typeof LYRIC_LANGUAGES[number];
export interface LyricsOptions { language: LyricsLanguage }
export function lyricsOptions(key: string): LyricsOptions {
  try {
    const value = JSON.parse(localStorage.getItem(key + ':options') || '{}').lyricsLanguage;
    return { language: LYRIC_LANGUAGES.includes(value) ? value : 'auto' };
  } catch { return { language: 'auto' }; }
}
