/*
 * Plain text with chords on their own line above the lyrics, the layout most song sheets use. A chord line is merged into the lyric line
 * below it: each chord goes into the lyric at the column where it was typed, as `[C]`. A chord line with no lyric under it is kept as a
 * line of chords. Section names become `# Heading` lines. A few `Key: value` lines at the top are read as metadata.
 */
import { isChordName } from "../speed";
import { chordName, sectionName, type ChartMetadata, type ImportNote, type ImportResult } from "./import-result";

/** Header lines such as `Key: G` or `Tempo: 96`, read only before the first song line. */
const HEADER = /^\s*(title|artist|key|tempo|capo|year)\s*:\s*(.+?)\s*$/i;

/** The chord tokens of a line with their columns, or null when the line holds anything that is not a chord. */
export function chordColumns(line: string): { column: number; name: string }[] | null {
  const tokens = [...line.matchAll(/\S+/g)];
  if (!tokens.length || !tokens.every((token) => isChordName(token[0]))) return null;
  return tokens.map((token) => ({ column: token.index ?? 0, name: chordName(token[0]) }));
}

/** Places each chord into the lyric at its column. A column past the end of the lyric puts the chord at the end, in order. */
export function mergeChords(chords: { column: number; name: string }[], lyric: string): string {
  let result = "";
  let from = 0;
  for (const chord of [...chords].sort((a, b) => a.column - b.column)) {
    const at = Math.min(Math.max(chord.column, from), lyric.length);
    result += lyric.slice(from, at) + `[${chord.name}]`;
    from = at;
  }
  return result + lyric.slice(from);
}

/** Converts chord-over-lyrics text. */
export function parseChordOverLyrics(text: string): ImportResult {
  const notes: ImportNote[] = [];
  const metadata: ChartMetadata = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inHeader = true;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\s+$/, "");
    const header = HEADER.exec(line);
    if (inHeader && header) {
      // A header value that does not parse is kept as the lyric line it was typed as, so it is not lost.
      if (readHeader(header[1].toLowerCase(), header[2], index + 1, metadata, notes)) continue;
    }
    if (line.trim()) inHeader = false;
    if (!line.trim()) {
      out.push("");
      continue;
    }
    const section = sectionName(line);
    if (section) {
      out.push(`# ${section}`);
      continue;
    }
    const chords = chordColumns(line);
    if (!chords) {
      out.push(line);
      continue;
    }
    const below = lines[index + 1];
    const lyric = below !== undefined && below.trim() && !chordColumns(below) && !sectionName(below) ? below : null;
    if (lyric === null) {
      out.push(chords.map((chord) => `[${chord.name}]`).join(" "));
      notes.push({ line: index + 1, text: "Chords on a line with no lyric below. They are kept as a line of chords." });
      continue;
    }
    out.push(mergeChords(chords, lyric.replace(/\s+$/, "")));
    index++;
  }
  return { format: "chord-over-lyrics", chart: trimBlankEnds(out).join("\n"), metadata, notes };
}

/** Reads one header line. Returns false when the value is not usable, so the caller keeps the line as text. */
function readHeader(name: string, value: string, line: number, metadata: ChartMetadata, notes: ImportNote[]): boolean {
  if (name === "title") metadata.title = value;
  else if (name === "artist") metadata.artist = value;
  else if (name === "key") metadata.key = value;
  else if (name === "tempo" && /^\d+$/.test(value) && Number(value) >= 20 && Number(value) <= 300) metadata.tempo = Number(value);
  else if (name === "capo" && /^\d+$/.test(value) && Number(value) <= 7) metadata.capo = Number(value);
  else if (name === "year" && /^\d{4}$/.test(value)) metadata.year = Number(value);
  else {
    notes.push({ line, text: `${name}: ${value} is not a valid ${name}, so it was kept as a lyric line.` });
    return false;
  }
  return true;
}

function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}
