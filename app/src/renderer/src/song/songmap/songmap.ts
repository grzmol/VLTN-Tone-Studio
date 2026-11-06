// The song map: a Markdown file that an assistant (or the performer) writes by hand, and the app imports (spec 94). This module only reads
// and writes the text. It never throws. When a row is wrong it says which line it skipped and why, and the rest of the map is kept, so
// one slip does not cost the whole song.

import { BASS_PART_CHOICES, type BassPartChoice } from "@/song/band/bass-parts";
import { MAX_BASS_OVERRIDES, type OverrideOctave } from "@/song/band/bass-overrides";
import { parseChordName } from "@/song/band/harmony";
import { ENERGIES, STYLE_IDS, type Energy, type StyleId } from "@/song/band/styles/types";
import { NOTE_NAMES } from "@/song/analysis/chord-templates";
import { parseKey } from "@/song/analysis/chord-hmm";
import { parseChart } from "@/song/performance/chart";
import { MAX_SECTIONS, MAX_SECTION_NAME, MIN_SECTION_S } from "@/song/performance/sections";

/** The format version this module reads and writes. A file with any other `songmap:` value is not a song map of this version. */
export const SONGMAP_VERSION = 1;

/** The longest notes text kept. A longer text is cut, with a problem. */
const MAX_NOTES_LENGTH = 4000;
const BPM_MIN = 20;
const BPM_MAX = 300;
const MAX_BEATS_PER_BAR = 12;

/** A `## Heading` line. `###` and deeper are not headings of the map. */
const HEADING = /^##(?!#)\s+(\S.*)$/;
/** A code fence line, with the fence's info text (for example `chart`) in the first group. */
const FENCE = /^```(\S*)/;
/** A separator cell in a table, such as `---` or `:---:`. */
const SEPARATOR_CELL = /^:?-+:?$/;
/** A key: a note name (with `#` or `b`), then an optional `major`, `minor`, `maj`, `min` or `m`. */
const KEY_TEXT = /^([A-G](?:#|b)?)\s*([A-Za-z]*)$/;
/** A meter such as `4/4` or `6/8`. */
const METER_TEXT = /^(\d+)\/(\d+)$/;
/** A bare note name in a bass note row, such as `F#` or `Bb`. */
const NOTE_TEXT = /^[A-G](?:#|b)?$/;

const DRUMS_ON = ["on", "yes", "y", "✓"];
const DRUMS_OFF = ["off", "no", "n", "-"];
/** The bass values a section row may hold: each generated part, or `off` for no generated bass. */
const BASS_FIELD_CHOICES = [...BASS_PART_CHOICES, "off"] as const;
type BassFieldChoice = (typeof BASS_FIELD_CHOICES)[number];

/** One section of the song. Times are song seconds. `end` is the start of the next section when the map leaves it blank. */
export interface SongMapSection {
  start: number;
  end: number;
  name: string;
  drums?: boolean;
  /** A bass part, or `off` for no generated bass in this section. */
  bass?: BassPartChoice | "off";
  style?: StyleId;
  energy?: Energy;
  busy?: Energy;
  loud?: Energy;
  notes?: string;
}

/** A bass note the performer sets by hand. `pc` is the pitch class (0 C to 11 B). `octave` nudges it down (-1), up (1) or leaves it (none). */
export interface SongMapBassNote {
  start: number;
  end: number;
  pc: number;
  octave?: OverrideOctave;
}

/** The key of the song: the tonic pitch class, the mode, and the name as written, such as `F# minor`. */
export interface SongMapKey {
  tonic: number;
  mode: "major" | "minor";
  name: string;
}

/** Everything a song map can hold. Only `sections` and `bassNotes` are always present (they may be empty). */
export interface SongMap {
  title?: string;
  artist?: string;
  duration?: number;
  key?: SongMapKey;
  bpm?: number;
  beatsPerBar?: number;
  meterText?: string;
  firstBeat?: number;
  style?: StyleId;
  sections: SongMapSection[];
  bassNotes: SongMapBassNote[];
  /** The chart text, verbatim, in the app's chart format. */
  chart?: string;
  notes?: string;
  /** Front matter keys this version does not know. They are kept, so a newer file loses nothing when read here. */
  extra: Record<string, string>;
  /** The titles of `##` sections this version does not read. */
  ignored: string[];
}

/** A line the map could not use, written for the performer. `line` is 1-based. */
export interface SongMapProblem {
  line: number;
  message: string;
}

/** The result of reading a map. `map` is null only when the text has no `songmap: 1` line. */
export interface SongMapResult {
  map: SongMap | null;
  problems: SongMapProblem[];
}

/** A line of the source text, with its 1-based number. */
interface SourceLine {
  number: number;
  text: string;
}

/** One table row, with the line it is on. `cells` are in column order. */
interface TableRow {
  line: number;
  cells: string[];
}

/** A parsed table: its lowercased header names and its data rows. `headerLine` is the line of the header. */
interface Table {
  headerLine: number;
  columns: Map<string, number>;
  rows: TableRow[];
}

/** A `## Heading` and the lines under it. The lines before the first heading have an empty heading. */
interface Block {
  heading: string;
  lines: SourceLine[];
}

/** A value that is either read, possibly as nothing, or refused with the reason written for the performer. */
type Read<T> = { ok: true; value: T | undefined } | { ok: false; message: string };

/** A section row before its End is settled. `end` is undefined when the row leaves End blank. */
interface SectionDraft {
  line: number;
  start: number;
  end?: number;
  fields: Omit<SongMapSection, "start" | "end">;
}

/** A bass note row once it is read. */
interface BassDraft {
  line: number;
  start: number;
  end: number;
  fields: Omit<SongMapBassNote, "start" | "end">;
}

/**
 * Reads a song map. Returns the map and the problems found. A row with a problem is skipped and the rest is kept, so a map with a slip
 * in one line still imports. Never throws.
 */
export function parseSongMap(text: string): SongMapResult {
  const problems: SongMapProblem[] = [];
  try {
    return parseLines(text.split(/\r?\n/), problems);
  } catch (error) {
    // The reader is written not to throw. This is a last guard, so a bug never reaches the import dialog as a crash.
    const reason = error instanceof Error ? error.message : String(error);
    problems.push({ line: 1, message: `Line 1: the song map could not be read (${reason}).` });
    return { map: null, problems };
  }
}

/** Reads the whole text: the front matter first, then the `##` sections. */
function parseLines(rawLines: string[], problems: SongMapProblem[]): SongMapResult {
  const lines = rawLines.map((text, index) => ({ number: index + 1, text }));
  const { fields, bodyStart } = readFrontMatter(lines, problems);
  const songmap = fields.find((field) => field.key.toLowerCase() === "songmap");
  if (!songmap) {
    problems.push({ line: 1, message: `Line 1: the song map has no "songmap: 1" line in its front matter.` });
    return { map: null, problems };
  }
  if (songmap.value.trim() !== String(SONGMAP_VERSION)) {
    problems.push({ line: songmap.line, message: `Line ${songmap.line}: "songmap" must be ${SONGMAP_VERSION}.` });
    return { map: null, problems };
  }

  const map: SongMap = { sections: [], bassNotes: [], extra: {}, ignored: [] };
  for (const field of fields) readHeaderField(map, field, problems);
  readBody(map, lines.slice(bodyStart), problems);
  return { map, problems };
}

/** A `key: value` line of the front matter. */
interface FrontField {
  key: string;
  value: string;
  line: number;
}

/**
 * Reads the front matter between the two `---` lines. Returns its fields, and the index where the body starts. A file without a front
 * matter block has no fields, and the body starts at the top.
 */
function readFrontMatter(lines: SourceLine[], problems: SongMapProblem[]): { fields: FrontField[]; bodyStart: number } {
  if (lines[0]?.text.trim() !== "---") {
    return { fields: [], bodyStart: 0 };
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.text.trim() === "---");
  if (closing < 0) {
    problems.push({ line: 1, message: `Line 1: the front matter block is never closed with a --- line.` });
    return { fields: [], bodyStart: lines.length };
  }
  const fields: FrontField[] = [];
  for (const line of lines.slice(1, closing)) {
    if (!line.text.trim()) continue;
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.text.trim());
    if (!match) {
      problems.push({ line: line.number, message: `Line ${line.number}: front matter lines should look like "key: value".` });
      continue;
    }
    fields.push({ key: match[1].trim(), value: match[2].trim(), line: line.number });
  }
  return { fields, bodyStart: closing + 1 };
}

/** Sets one front matter field on the map. A value that does not read is a problem, and the field is left unset. */
function readHeaderField(map: SongMap, field: FrontField, problems: SongMapProblem[]): void {
  const key = field.key.toLowerCase();
  const fail = (message: string): void => {
    problems.push({ line: field.line, message: `Line ${field.line}: ${message}` });
  };
  switch (key) {
    case "songmap":
      return;
    case "title":
      if (field.value) map.title = field.value;
      return;
    case "artist":
      if (field.value) map.artist = field.value;
      return;
    case "duration": {
      const seconds = parseTime(field.value);
      if (seconds === null) fail(`"duration" must be a time such as 3:52.0.`);
      else map.duration = seconds;
      return;
    }
    case "key": {
      const songKey = parseSongKey(field.value);
      if (songKey === null) fail(`"${field.value}" is not a key. Write a note and major or minor, such as A major or F# minor.`);
      else map.key = songKey;
      return;
    }
    case "bpm": {
      const bpm = Number(field.value);
      if (!field.value || !Number.isFinite(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) fail(`"bpm" must be a number from ${BPM_MIN} to ${BPM_MAX}.`);
      else map.bpm = bpm;
      return;
    }
    case "meter":
      readMeter(map, field.value, (message) => fail(message));
      return;
    case "first_beat": {
      const seconds = parseTime(field.value);
      if (seconds === null) fail(`"first_beat" must be a time such as 0:00.42.`);
      else map.firstBeat = seconds;
      return;
    }
    case "style": {
      const style = readChoice(field.value, STYLE_IDS, "style");
      if (!style.ok) fail(style.message);
      else if (style.value !== undefined) map.style = style.value;
      return;
    }
    default:
      map.extra[key] = field.value;
  }
}

/** Reads a meter such as `6/8`. The top number is 1 to 12. */
function readMeter(map: SongMap, text: string, fail: (message: string) => void): void {
  const match = METER_TEXT.exec(text);
  const top = match ? Number(match[1]) : NaN;
  const bottom = match ? Number(match[2]) : NaN;
  if (!match || top < 1 || top > MAX_BEATS_PER_BAR || bottom < 1) {
    fail(`"meter" must look like 4/4, with the top number from 1 to ${MAX_BEATS_PER_BAR}.`);
    return;
  }
  map.beatsPerBar = top;
  map.meterText = `${top}/${bottom}`;
}

/**
 * Reads a key name such as `A major`, `F#m` or `Bb`. A note with no mode is major. Returns null for anything else.
 * The name is kept as written, with the sign spelled `#` or `b`.
 */
export function parseSongKey(text: string): SongMapKey | null {
  const cleaned = text.trim().replace(/♭/g, "b").replace(/♯/g, "#");
  const match = KEY_TEXT.exec(cleaned);
  if (!match) return null;
  const suffix = match[2].toLowerCase();
  if (suffix !== "" && !["major", "maj", "minor", "min", "m"].includes(suffix)) return null;
  const mode = suffix === "minor" || suffix === "min" || suffix === "m" ? "minor" : "major";
  const name = `${match[1]} ${mode}`;
  const parsed = parseKey(name);
  return parsed ? { tonic: parsed.tonic, mode: parsed.mode, name } : null;
}

/**
 * Reads a time: `m:ss.s`, `h:mm:ss.s` or plain seconds such as `42.5`. Returns null for anything else, including minutes or seconds of
 * 60 or more in a clock time.
 */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || !parts[0]) return null;
  const seconds = parts[parts.length - 1];
  if (!/^\d+(\.\d+)?$/.test(seconds)) return null;
  if (parts.length === 1) return Number(seconds);
  const minutes = parts[parts.length - 2];
  if (!/^\d+$/.test(minutes) || Number(seconds) >= 60) return null;
  if (parts.length === 2) return Number(minutes) * 60 + Number(seconds);
  const hours = parts[0];
  if (!/^\d+$/.test(hours) || Number(minutes) >= 60) return null;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** Writes a time as `m:ss.ss`, or `h:mm:ss.ss` past an hour. Two decimals, so the time reads back to the hundredth. */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 100)) : 0;
  const hours = Math.floor(total / 360000);
  const minutes = Math.floor((total % 360000) / 6000);
  const whole = Math.floor((total % 6000) / 100);
  const hundredths = total % 100;
  const clock = `${String(whole).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${clock}` : `${minutes}:${clock}`;
}

/** Splits the body into `##` blocks. A heading inside a code fence is text, not a heading. */
function splitBlocks(lines: SourceLine[]): Block[] {
  const blocks: Block[] = [{ heading: "", lines: [] }];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.text.trim();
    if (trimmed.startsWith("```")) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(trimmed);
    if (heading) blocks.push({ heading: heading[1].trim(), lines: [] });
    else blocks[blocks.length - 1].lines.push(line);
  }
  return blocks;
}

/** Reads each `##` section by its title. The first section with a known title is used. Later repeats, and unknown titles, are ignored. */
function readBody(map: SongMap, lines: SourceLine[], problems: SongMapProblem[]): void {
  const seen = new Set<string>();
  for (const block of splitBlocks(lines)) {
    const title = block.heading.toLowerCase();
    if (!title) continue;
    if (!["sections", "bass notes", "chart", "notes"].includes(title) || seen.has(title)) {
      map.ignored.push(block.heading);
      continue;
    }
    seen.add(title);
    if (title === "sections") map.sections = readSectionsBlock(block.lines, map.duration, problems);
    else if (title === "bass notes") map.bassNotes = readBassBlock(block.lines, problems);
    else if (title === "chart") setChart(map, block.lines, problems);
    else setNotes(map, block.lines, problems);
  }
}

/** The first table in the lines, read as a header and rows. Null when the lines hold no table. */
function readTable(lines: SourceLine[]): Table | null {
  const start = lines.findIndex((line) => line.text.trim().startsWith("|"));
  if (start < 0) return null;
  const block: SourceLine[] = [];
  for (let index = start; index < lines.length && lines[index].text.trim().startsWith("|"); index++) block.push(lines[index]);
  const parsed = block.map((line) => ({ line: line.number, cells: splitRow(line.text) }));
  const [header, ...rest] = parsed;
  const columns = new Map(header.cells.map((cell, index) => [cell.trim().toLowerCase(), index] as const));
  const rows = rest.filter((row) => !row.cells.every((cell) => SEPARATOR_CELL.test(cell)));
  return { headerLine: header.line, columns, rows };
}

/** Splits a table line into cells. An escaped `\|` stays inside its cell. */
function splitRow(text: string): string[] {
  let body = text.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/** The text of one cell, found by its column name. Empty when the table has no such column. */
function cell(row: TableRow, table: Table, name: string): string {
  const index = table.columns.get(name);
  return index === undefined ? "" : (row.cells[index] ?? "");
}

/** Whether a row has no text in any cell. Such rows are blank lines in a table, and are skipped without a problem. */
function isBlankRow(row: TableRow): boolean {
  return row.cells.every((cell) => cell === "");
}

/** Reads a set of choices. An empty cell reads as nothing, and anything else must be one of the choices, ignoring case. */
function readChoice<T extends string>(raw: string, choices: readonly T[], label: string): Read<T> {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: undefined };
  const match = choices.find((choice) => choice === value);
  return match === undefined ? { ok: false, message: `"${raw.trim()}" is not a ${label}.` } : { ok: true, value: match };
}

/** Reads `on` or `off`, with the words `yes`, `no`, `y`, `n`, `✓` and `-` also accepted. */
function readDrums(raw: string): Read<boolean> {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: undefined };
  if (DRUMS_ON.includes(value)) return { ok: true, value: true };
  if (DRUMS_OFF.includes(value)) return { ok: true, value: false };
  return { ok: false, message: `"${raw.trim()}" is not a drums setting. Use on or off.` };
}

/** Reads an energy, busy or loud level from 1 to 5. */
function readLevel(raw: string, label: string): Read<Energy> {
  const value = raw.trim();
  if (!value) return { ok: true, value: undefined };
  const match = ENERGIES.find((level) => String(level) === value);
  return match === undefined ? { ok: false, message: `"${label}" must be a number from 1 to 5, not "${value}".` } : { ok: true, value: match };
}

/** Reads a time cell. Empty reads as nothing, and anything else must parse as a time. */
function readTimeCell(raw: string): Read<number> {
  const value = raw.trim();
  if (!value) return { ok: true, value: undefined };
  const seconds = parseTime(value);
  return seconds === null ? { ok: false, message: `"${value}" is not a time. Write it like 1:02.5.` } : { ok: true, value: seconds };
}

/** Reads an octave column: `up`, `down`, or empty. */
function readOctave(raw: string): Read<OverrideOctave> {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: undefined };
  if (value === "up") return { ok: true, value: 1 };
  if (value === "down") return { ok: true, value: -1 };
  return { ok: false, message: `"${raw.trim()}" is not an octave. Use up, down, or leave it empty.` };
}

/** Drops the fields that are unset, so a read object holds only what the map said. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

/** Reads the Sections table. Rows that break a rule are skipped with a problem. The rest are kept in time order. */
function readSectionsBlock(lines: SourceLine[], duration: number | undefined, problems: SongMapProblem[]): SongMapSection[] {
  const table = readTable(lines);
  if (!table) return [];
  if (!table.columns.has("start") || !table.columns.has("section")) {
    problems.push({ line: table.headerLine, message: `Line ${table.headerLine}: the Sections table needs Start and Section columns.` });
    return [];
  }
  const drafts: SectionDraft[] = [];
  for (const row of table.rows) {
    if (isBlankRow(row)) continue;
    const draft = readSectionRow(row, table, problems);
    if (draft) drafts.push(draft);
  }
  return resolveSections(drafts, duration, problems);
}

/** Reads one section row. Returns null, with a problem, when a cell does not read. */
function readSectionRow(row: TableRow, table: Table, problems: SongMapProblem[]): SectionDraft | null {
  const reads = {
    start: readTimeCell(cell(row, table, "start")),
    end: readTimeCell(cell(row, table, "end")),
    drums: readDrums(cell(row, table, "drums")),
    bass: readChoice<BassFieldChoice>(cell(row, table, "bass"), BASS_FIELD_CHOICES, "bass part"),
    style: readChoice(cell(row, table, "style"), STYLE_IDS, "style"),
    energy: readLevel(cell(row, table, "energy"), "Energy"),
    busy: readLevel(cell(row, table, "busy"), "Busy"),
    loud: readLevel(cell(row, table, "loud"), "Loud"),
  };
  const failed = Object.values(reads).find((read) => !read.ok);
  if (failed && !failed.ok) {
    problems.push({ line: row.line, message: `Line ${row.line}: ${failed.message}` });
    return null;
  }
  const name = cell(row, table, "section").trim();
  if (!name) {
    problems.push({ line: row.line, message: `Line ${row.line}: the section has no name, so the row is skipped.` });
    return null;
  }
  if (reads.start.ok && reads.start.value === undefined) {
    problems.push({ line: row.line, message: `Line ${row.line}: "${name}" has no Start time, so the row is skipped.` });
    return null;
  }
  const notes = cell(row, table, "notes").trim();
  const fields = withoutUndefined({
    name: name.slice(0, MAX_SECTION_NAME),
    drums: reads.drums.ok ? reads.drums.value : undefined,
    bass: reads.bass.ok ? reads.bass.value : undefined,
    style: reads.style.ok ? reads.style.value : undefined,
    energy: reads.energy.ok ? reads.energy.value : undefined,
    busy: reads.busy.ok ? reads.busy.value : undefined,
    loud: reads.loud.ok ? reads.loud.value : undefined,
    notes: notes || undefined,
  });
  const start = reads.start.ok ? reads.start.value : undefined;
  const end = reads.end.ok ? reads.end.value : undefined;
  return start === undefined ? null : { line: row.line, start, end, fields };
}

/** Settles each section's end, then checks the order and length. A blank End runs to the next row's start, or to the song's duration. */
function resolveSections(drafts: SectionDraft[], duration: number | undefined, problems: SongMapProblem[]): SongMapSection[] {
  const sections: SongMapSection[] = [];
  for (const [index, draft] of drafts.entries()) {
    if (sections.length === MAX_SECTIONS) {
      problems.push({
        line: draft.line,
        message: `Line ${draft.line}: a song map keeps at most ${MAX_SECTIONS} sections, so this row and the rest are skipped.`,
      });
      break;
    }
    const end = draft.end ?? drafts[index + 1]?.start ?? duration;
    const name = draft.fields.name;
    if (end === undefined) {
      problems.push({ line: draft.line, message: `Line ${draft.line}: "${name}" has no End time, and the song has no duration to end it at.` });
      continue;
    }
    const message = sectionProblem(draft.start, end, name, sections[sections.length - 1]);
    if (message) {
      problems.push({ line: draft.line, message: `Line ${draft.line}: ${message}` });
      continue;
    }
    sections.push(withoutUndefined({ start: draft.start, end, ...draft.fields }));
  }
  return sections;
}

/** The reason a section cannot follow the one before it, or null when it can. */
function sectionProblem(start: number, end: number, name: string, previous: SongMapSection | undefined): string | null {
  if (end <= start) return `"${name}" ends before it starts.`;
  if (end - start < MIN_SECTION_S) return `"${name}" is shorter than ${MIN_SECTION_S} s.`;
  if (previous && start < previous.start) return `"${name}" starts before the section above it.`;
  if (previous && start < previous.end) return `"${name}" overlaps the section above it.`;
  return null;
}

/** Reads the Bass notes table. Rows must be in time order and must not overlap. */
function readBassBlock(lines: SourceLine[], problems: SongMapProblem[]): SongMapBassNote[] {
  const table = readTable(lines);
  if (!table) return [];
  if (!table.columns.has("start") || !table.columns.has("end") || !table.columns.has("note")) {
    problems.push({ line: table.headerLine, message: `Line ${table.headerLine}: the Bass notes table needs Start, End and Note columns.` });
    return [];
  }
  const drafts: BassDraft[] = [];
  for (const row of table.rows) {
    if (isBlankRow(row)) continue;
    const draft = readBassRow(row, table, problems);
    if (draft) drafts.push(draft);
  }
  return resolveBassNotes(drafts, problems);
}

/** Reads one bass note row. Returns null, with a problem, when a cell does not read. */
function readBassRow(row: TableRow, table: Table, problems: SongMapProblem[]): BassDraft | null {
  const start = readTimeCell(cell(row, table, "start"));
  const end = readTimeCell(cell(row, table, "end"));
  const octave = readOctave(cell(row, table, "octave"));
  const noteText = normaliseAccidentals(cell(row, table, "note"));
  const fail = (message: string): null => {
    problems.push({ line: row.line, message: `Line ${row.line}: ${message}` });
    return null;
  };
  if (!start.ok) return fail(start.message);
  if (!end.ok) return fail(end.message);
  if (!octave.ok) return fail(octave.message);
  if (start.value === undefined) return fail(`a bass note has no Start time, so the row is skipped.`);
  if (end.value === undefined) return fail(`the bass note at ${start.value} s has no End time, so the row is skipped.`);
  if (!NOTE_TEXT.test(noteText)) return fail(`"${noteText}" is not a note name. Use a letter, with # or b, such as F# or Bb.`);
  const parsed = parseChordName(noteText);
  if (!parsed) return fail(`"${noteText}" is not a note name. Use a letter, with # or b, such as F# or Bb.`);
  return { line: row.line, start: start.value, end: end.value, fields: withoutUndefined({ pc: parsed.root, octave: octave.value }) };
}

/** Writes the sharp and flat signs as `#` and `b`, so `E♭` reads as `Eb`. */
function normaliseAccidentals(text: string): string {
  return text.trim().replace(/♭/g, "b").replace(/♯/g, "#");
}

/** Settles the bass notes, checking the order and overlaps. */
function resolveBassNotes(drafts: BassDraft[], problems: SongMapProblem[]): SongMapBassNote[] {
  const notes: SongMapBassNote[] = [];
  for (const draft of drafts) {
    if (notes.length === MAX_BASS_OVERRIDES) {
      problems.push({
        line: draft.line,
        message: `Line ${draft.line}: a song map keeps at most ${MAX_BASS_OVERRIDES} bass notes, so this row and the rest are skipped.`,
      });
      break;
    }
    const previous = notes[notes.length - 1];
    if (draft.end <= draft.start) {
      problems.push({ line: draft.line, message: `Line ${draft.line}: the bass note at ${draft.start} s ends before it starts.` });
    } else if (previous && draft.start < previous.start) {
      problems.push({ line: draft.line, message: `Line ${draft.line}: the bass note at ${draft.start} s starts before the note above it.` });
    } else if (previous && draft.start < previous.end) {
      problems.push({ line: draft.line, message: `Line ${draft.line}: the bass note at ${draft.start} s overlaps the note above it.` });
    } else {
      notes.push(withoutUndefined({ start: draft.start, end: draft.end, ...draft.fields }));
    }
  }
  return notes;
}

/**
 * Reads the chart: the first fenced block under the heading whose info text is empty or `chart`. A chart that does not parse is a
 * problem, and it is dropped, so the song still loads without it.
 */
function setChart(map: SongMap, lines: SourceLine[], problems: SongMapProblem[]): void {
  for (let index = 0; index < lines.length; index++) {
    const open = FENCE.exec(lines[index].text.trim());
    if (!open) continue;
    const close = closingFence(lines, index + 1);
    if (open[1] !== "" && open[1] !== "chart") {
      index = close;
      continue;
    }
    const text = lines
      .slice(index + 1, close)
      .map((line) => line.text)
      .join("\n");
    const message = chartProblem(text);
    if (message)
      problems.push({ line: lines[index].number, message: `Line ${lines[index].number}: the chart does not parse (${message}). The chart is dropped.` });
    else map.chart = text;
    return;
  }
}

/** The index of the line that closes a fence, or the end of the lines when it never closes. */
function closingFence(lines: SourceLine[], from: number): number {
  const close = lines.findIndex((line, index) => index >= from && line.text.trim().startsWith("```"));
  return close < 0 ? lines.length : close;
}

/** Why a chart does not parse, or null when it does. The chart parser throws on a bad command, so the error is caught here. */
function chartProblem(text: string): string | null {
  try {
    parseChart(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Reads the notes text: everything under the heading, trimmed, and cut to the limit. */
function setNotes(map: SongMap, lines: SourceLine[], problems: SongMapProblem[]): void {
  const text = lines
    .map((line) => line.text)
    .join("\n")
    .trim();
  if (!text) return;
  if (text.length > MAX_NOTES_LENGTH) {
    problems.push({ line: lines[0].number, message: `Line ${lines[0].number}: the notes are longer than ${MAX_NOTES_LENGTH} characters, so they are cut.` });
    map.notes = text.slice(0, MAX_NOTES_LENGTH);
    return;
  }
  map.notes = text;
}

/**
 * Writes a song map as Markdown. `parseSongMap(writeSongMap(map))` gives back the same map, with times to the hundredth of a second.
 * Pipes in names and notes are escaped, so they stay in their cells.
 */
export function writeSongMap(map: SongMap): string {
  const blocks = [
    frontMatter(map),
    `# ${map.title ?? "Song map"}`,
    sectionsBlock(map.sections),
    bassBlock(map.bassNotes),
    map.chart === undefined ? "" : chartBlock(map.chart),
    map.notes ? `## Notes\n\n${map.notes}` : "",
  ];
  return `${blocks.filter((block) => block !== "").join("\n\n")}\n`;
}

/** The front matter: `songmap: 1`, the known keys that are set, then any extra keys. */
function frontMatter(map: SongMap): string {
  const lines = [`songmap: ${SONGMAP_VERSION}`];
  const add = (key: string, value: string | undefined): void => {
    if (value !== undefined && value !== "") lines.push(`${key}: ${oneLine(value)}`);
  };
  add("title", map.title);
  add("artist", map.artist);
  add("duration", map.duration === undefined ? undefined : formatTime(map.duration));
  add("key", map.key?.name);
  add("bpm", map.bpm === undefined ? undefined : String(map.bpm));
  add("meter", map.meterText ?? (map.beatsPerBar === undefined ? undefined : `${map.beatsPerBar}/4`));
  add("first_beat", map.firstBeat === undefined ? undefined : formatTime(map.firstBeat));
  add("style", map.style);
  for (const [key, value] of Object.entries(map.extra)) add(key, value);
  return `---\n${lines.join("\n")}\n---`;
}

/** Removes line breaks, so a value stays on its own line. */
function oneLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** Escapes a value for a table cell: pipes are escaped, and line breaks become spaces. */
function cellText(value: string | undefined): string {
  return value === undefined ? "" : oneLine(value).replace(/\|/g, "\\|");
}

/** Writes a table: the header, the separator, then one line per row. */
function tableBlock(heading: string, header: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  const separator = line(header.map(() => "---"));
  return [`## ${heading}`, "", line(header), separator, ...rows.map(line)].join("\n");
}

/** The Sections table. Each row is one section; its End is always written. */
function sectionsBlock(sections: SongMapSection[]): string {
  const rows = sections.map((section) => [
    formatTime(section.start),
    formatTime(section.end),
    cellText(section.name),
    section.drums === undefined ? "" : section.drums ? "on" : "off",
    section.bass ?? "",
    section.style ?? "",
    section.energy === undefined ? "" : String(section.energy),
    section.busy === undefined ? "" : String(section.busy),
    section.loud === undefined ? "" : String(section.loud),
    cellText(section.notes),
  ]);
  return tableBlock("Sections", ["Start", "End", "Section", "Drums", "Bass", "Style", "Energy", "Busy", "Loud", "Notes"], rows);
}

/** The Bass notes table. The note is written with sharps, and the octave as up, down or nothing. */
function bassBlock(notes: SongMapBassNote[]): string {
  const rows = notes.map((note) => [
    formatTime(note.start),
    formatTime(note.end),
    NOTE_NAMES[note.pc] ?? "C",
    note.octave === 1 ? "up" : note.octave === -1 ? "down" : "",
  ]);
  return tableBlock("Bass notes", ["Start", "End", "Note", "Octave"], rows);
}

/** The chart, in a fence with the `chart` info text. */
function chartBlock(chart: string): string {
  return `## Chart\n\n\`\`\`chart\n${chart}\n\`\`\``;
}
