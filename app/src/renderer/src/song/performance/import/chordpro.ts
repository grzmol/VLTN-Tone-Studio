/*
 * ChordPro (.cho, .chordpro, .pro, .crd) to the app's chart format. Inline chords `[C]` already match the chart syntax, so they pass through.
 * Directives become metadata, section headings or comments. A directive the app does not support is kept as an editor comment and listed
 * in the notes, so nothing is lost without the performer knowing. The parser never throws.
 */
import { CAPO_MAX } from "../speed";
import type { ChartMetadata, ImportNote, ImportResult } from "./import-result";

/** Directives that the app's own syntax uses. They are kept exactly as written, so a mixed file still works. */
const NATIVE = /^\{(midi|label|color|\/color|chase|nochase)(?![a-z])/i;
/** Directives that set song details. They are read into the metadata and never shown in the chart. */
const METADATA = new Set(["title", "t", "artist", "key", "tempo", "bpm", "capo", "duration", "year"]);
/** Directives that start a section, with the heading used when the directive has no label. */
const SECTION_STARTS: Record<string, string> = {
  start_of_chorus: "Chorus",
  soc: "Chorus",
  start_of_verse: "Verse",
  sov: "Verse",
  start_of_bridge: "Bridge",
  sob: "Bridge",
};
/** Directives that close a section. Nothing is written for them. */
const SECTION_ENDS = new Set(["end_of_chorus", "eoc", "end_of_verse", "eov", "end_of_bridge", "eob"]);
/** Directives whose text is shown as a label line, the way ChordPro prints a comment. */
const COMMENTS = new Set(["comment", "c", "comment_italic", "ci", "comment_box", "cb"]);
const TAB_START = new Set(["start_of_tab", "sot"]);
const TAB_END = new Set(["end_of_tab", "eot"]);
/** A second song starts here. Only the first song is imported. */
const NEW_SONG = new Set(["new_song", "ns"]);

/** The directive name (lower case) and its value: `{title: Amazing Grace}` gives "title" and "Amazing Grace"; `{soc}` gives "soc" and "". */
export function directive(body: string): { name: string; value: string } {
  const match = /^\s*([^\s:]*)\s*:?\s*(.*?)\s*$/.exec(body);
  return { name: (match?.[1] ?? "").toLowerCase(), value: match?.[2] ?? "" };
}

/** A whole number within `min` to `max`, or null. */
function wholeNumber(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number >= min && number <= max ? number : null;
}

/** A time as seconds: `3:45` or `225`. */
function seconds(value: string): number | null {
  const clock = /^(\d+):([0-5]\d)$/.exec(value.trim());
  const total = clock ? Number(clock[1]) * 60 + Number(clock[2]) : /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return total > 0 ? total : null;
}

/** Converts ChordPro text. Only the first song is read when the text holds several. */
export function parseChordPro(text: string): ImportResult {
  const notes: ImportNote[] = [];
  const metadata: ChartMetadata = {};
  const out: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let tabStart = 0;
  const note = (line: number, message: string) => notes.push({ line, text: message });

  /**
   * Reads a metadata directive into `metadata`. Returns true when the directive was metadata, which is not shown, and false otherwise.
   * A bad value is reported and ignored, and still counts as metadata.
   */
  const readMetadata = (name: string, value: string, line: number): boolean => {
    if (!METADATA.has(name)) return false;
    if (name === "title" || name === "t") metadata.title ??= value || undefined;
    else if (name === "artist") metadata.artist ??= value || undefined;
    else if (name === "key") {
      if (value.length > 40) note(line, "The key is too long, so it was ignored.");
      else if (value) metadata.key ??= value;
    } else if (name === "tempo" || name === "bpm") {
      const tempo = wholeNumber(value, 20, 300);
      if (tempo === null) note(line, `{${name}: ${value}} is not a tempo from 20 to 300 BPM, so it was ignored.`);
      else metadata.tempo = tempo;
    } else if (name === "capo") {
      const capo = wholeNumber(value, 0, CAPO_MAX);
      if (capo === null) note(line, `{capo: ${value}} is not a capo from 0 to ${CAPO_MAX}, so it was ignored.`);
      else metadata.capo = capo;
    } else if (name === "duration") {
      const duration = seconds(value);
      if (duration === null) note(line, `{duration: ${value}} is not a time such as 3:45, so it was ignored.`);
      else metadata.duration = duration;
    } else if (name === "year") {
      const year = wholeNumber(value, 1000, 2999);
      if (year === null) note(line, `{year: ${value}} is not a year, so it was ignored.`);
      else metadata.year = year;
    }
    return true;
  };

  /** The text a directive becomes on its own line. Unsupported directives become a `//` comment, which the stage does not show. */
  const lineFor = (body: string, line: number): string | null => {
    const { name, value } = directive(body);
    if (readMetadata(name, value, line)) return null;
    if (name in SECTION_STARTS) return `# ${value || SECTION_STARTS[name]}`;
    if (SECTION_ENDS.has(name)) return null;
    if (COMMENTS.has(name)) return value ? `# ${value}` : null;
    note(line, `{${body.trim()}} is not supported, so it was kept as an editor comment.`);
    return value ? `// ${name}: ${value}` : `// ${name}`;
  };

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();
    const whole = /^\{([^{}]*)\}$/.exec(trimmed);
    const name = whole ? directive(whole[1]).name : "";

    if (NEW_SONG.has(name)) {
      note(lineNumber, "The text holds more than one song. Only the first is imported; this line and everything after it were ignored.");
      break;
    }
    if (tabStart) {
      if (TAB_END.has(name)) tabStart = 0;
      else out.push(trimmed ? `// ${trimmed}` : "");
      continue;
    }
    if (TAB_START.has(name)) {
      tabStart = lineNumber;
      note(lineNumber, "A tab block is kept as editor comments and is not shown on stage.");
      continue;
    }
    if (trimmed.startsWith("#")) {
      out.push(`// ${trimmed.slice(1).trim()}`.trimEnd());
      continue;
    }
    if (!trimmed) {
      out.push("");
      continue;
    }
    if (whole) {
      if (NATIVE.test(trimmed)) out.push(trimmed);
      else {
        const shown = lineFor(whole[1], lineNumber);
        if (shown !== null) out.push(shown);
      }
      continue;
    }
    // A directive inside a lyric or chord line: metadata is read and removed, anything else is kept as a comment after the line.
    const kept: string[] = [];
    const rest = raw.replace(/\{([^{}]*)\}/g, (token: string, body: string) => {
      if (NATIVE.test(token)) return token;
      const { name: inner, value } = directive(body);
      if (readMetadata(inner, value, lineNumber) || SECTION_ENDS.has(inner)) return "";
      const shown = lineFor(body, lineNumber);
      if (shown !== null) kept.push(shown.replace(/^# /, "// "));
      return "";
    });
    out.push([rest.trimEnd(), ...kept].filter(Boolean).join(" "));
  }

  return { format: "chordpro", chart: trimBlankEnds(out).join("\n"), metadata, notes };
}

/** Blank lines at the start and end are not part of the chart. */
function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}
