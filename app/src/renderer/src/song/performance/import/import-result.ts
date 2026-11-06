/*
 * The shared shape of a text import. Every importer returns the chart in the app's own format, plus what it read from the text besides the
 * chart. Nothing an importer skips is dropped silently: it is listed in `notes`, so the summary can show it before the chart is saved.
 */

/** Song details found in the text. A value that is missing is left out, so the song's own value is kept. */
export interface ChartMetadata {
  title?: string;
  artist?: string;
  key?: string;
  /** Beats per minute, 20 to 300 */
  tempo?: number;
  /** Capo position, 0 to 7 */
  capo?: number;
  /** Seconds */
  duration?: number;
  year?: number;
}

/** A line the import did not take as written, or a directive it kept as a comment. */
export interface ImportNote {
  /** 1-based line of the source text */
  line: number;
  text: string;
}

export interface ImportResult {
  format: "chordpro" | "chord-over-lyrics" | "app";
  /** The chart in the app's format. Chords stay inline as `[C]`, sections become `# Heading` lines and comments start `//`. */
  chart: string;
  metadata: ChartMetadata;
  notes: ImportNote[];
  /** Set when the chart does not parse. Such a chart must not be saved. */
  error?: string;
}

/** The chart form of a chord token: `N.C.` becomes `N`, the app's no-chord name. */
export function chordName(token: string): string {
  return /^N\.?C?\.?$/.test(token) ? "N" : token;
}

/** A section name at the start of a line, such as `Verse 2`, `[Chorus]`, `Bridge:` or `Pre-Chorus`. */
const SECTION_LINE = /^\s*\[?\s*((?:pre-?\s?)?(?:verse|chorus|bridge|intro|outro|interlude|solo|tag|coda|ending|refrain|hook|instrumental)(?:\s+\d+)?)\s*\]?\s*:?\s*$/i;

/** The section name on its own line, with its first letter in capitals, or null. */
export function sectionName(line: string): string | null {
  const match = SECTION_LINE.exec(line);
  if (!match) return null;
  return match[1].replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\s+/g, " ");
}
