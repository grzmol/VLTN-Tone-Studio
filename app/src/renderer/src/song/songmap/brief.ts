// The song brief (spec 95): what the app found about a song, written as Markdown for an assistant to work from, with a draft song map
// that the assistant corrects and the performer imports (spec 94). This file is pure: it reads the saved song and writes text. The
// draft is built from the song's current state, so importing it unchanged gives the song back (see `brief.test.ts`).

import { parseBandSettings } from "../band/arrangement";
import { BASS_PART_CHOICES } from "../band/bass-parts";
import { parseBeatGrid, type BeatGrid } from "../band/beat-grid";
import { STYLE_IDS } from "../band/styles/types";
import { barStarts } from "../band/timing";
import { BASS_LINE_CONFIDENT, type BassLineBeat } from "../analysis/bass-line";
import { NOTE_NAMES } from "../analysis/chord-templates";
import type { DetectedSection } from "../analysis/sections";
import { METER_CERTAIN, parseAnalysis } from "../analysis/song-analysis";
import type { Chord } from "../performance/chords";
import { parseSections, type Section } from "../performance/sections";
import { formatTime, parseSongKey, writeSongMap, type SongMap, type SongMapBassNote, type SongMapMark, type SongMapSection } from "./songmap";

/** What the brief is written from: the song's title and length, its saved tempo, options and chart, and its lyrics chart. */
export interface BriefInput {
  title: string;
  durationSeconds: number;
  /** The saved tempo, as the song stores it (`:bpm`). Empty when the song has none. */
  bpm: string;
  /** The song's saved options (`:options`), already parsed. */
  options: Record<string, unknown>;
  /** The song's chart (the empty suffix). */
  chart: string;
  /** The song's lyrics chart (`:lyrics`), from the lyrics track. */
  lyrics: string;
}

/** Bars per line in the Bars list, so a long song stays readable. */
const BARS_PER_LINE = 8;
/** A four-backtick fence holds the map's own three-backtick chart fence. */
const OUTER_FENCE = "````";

/** The text the brief opens with: what it is, and what the assistant should do with it. */
const INTRO = [
  "This is what VLTN Tone Studio found in this song. Listen to the song, or study its stems, and correct anything that is wrong.",
  "Reply with a song map: the draft at the end of this brief, edited. Keep its format exactly. The app reads it through This song → Song map.",
  "",
  "The format, in short:",
  "- Front matter between `---` lines: `songmap: 1`, then `key`, `bpm`, `meter` (such as 4/4), `first_beat` and `style` when they are known.",
  "- Times are `m:ss.xx`, such as `1:02.50`, or plain seconds.",
  "- `## Sections`: a table with the columns Start, End, Section, Drums (on or off), Bass, Style, Energy, Busy, Loud and Notes. Bass is off, " +
    `or one of ${BASS_PART_CHOICES.join(", ")}. Style is one of ${STYLE_IDS.join(", ")}. Energy, Busy and Loud are 1 to 5. Leave a cell empty to keep the default. ` +
    "An optional Fill column sets the drum fill at the end of a section: auto (sized to the change into the next section), none, short (the last beat), half (half a bar) or whole (the whole bar). " +
    "An optional Shape column says how a section's drums move: steady, build (rising into the next section), drop (kick and hats only) or half (half-time).",
  "- `## Bass notes`: a table with the columns Start, End, Note (C, C#, D … B) and Octave (up, down or empty).",
  "- `## Marks`: a table with the columns Bar, Time, Mark and Beats. Put a mark on one bar: Bar is the section and the bar counted from the section's " +
    "start, such as `Chorus 2:8`, or leave it empty and give the bar's Time. Mark is fill, no-fill, stop, crash, no-crash, drums-out, bass-out or hit. " +
    "Beats is 1, 2 or 4 for a fill and 1 to 4 for a stop. Leave the table out when the band plays straight through.",
  "- `## Chart`: a ```chart fence of lines such as `[1:02.50] [Am]Lyric line`. Chords go in square brackets.",
  "- `## Notes`: free text, for the performer.",
].join("\n");

/** One line of the bars list: a bar's index in the grid, its first beat, and the beat index that ends it. */
interface Bar {
  number: number;
  start: number;
  next: number;
  beats: number[];
}

/** The bars of a grid, from the first downbeat on. A bar ends at the next bar's first beat, or at the last beat. */
function barsOf(grid: BeatGrid): Bar[] {
  const starts = barStarts(grid);
  return starts.map((beat, index) => {
    const next = starts[index + 1] ?? grid.beats.length;
    const beats: number[] = [];
    for (let i = beat; i < next; i++) beats.push(i);
    return { number: index + 1, start: beat, next, beats };
  });
}

/** A time in the grid: the time of its beat, in seconds. Beats outside the grid have no time. */
function beatTime(grid: BeatGrid, beat: number): number | null {
  return grid.beats[beat] ?? null;
}

/** One line for each run of eight bars: the time each bar starts at. */
function barLines(grid: BeatGrid): string[] {
  const bars = barsOf(grid);
  const lines: string[] = [];
  for (let first = 0; first < bars.length; first += BARS_PER_LINE) {
    const group = bars.slice(first, first + BARS_PER_LINE);
    const times = group.map((bar) => formatTime(beatTime(grid, bar.start) ?? 0));
    lines.push(`Bars ${group[0].number}–${group[group.length - 1].number}: ${times.join(" ")}`);
  }
  return lines;
}

/** The chords, one line per bar with the grid, or one line per chord without one. */
function chordLines(chords: readonly Chord[], grid: BeatGrid | null): string[] {
  const label = (chord: Chord) => `${chord.name} ${formatTime(chord.time)}`;
  if (!grid) return chords.map((chord) => `- ${label(chord)}`);
  return barsOf(grid).map((bar) => {
    const start = beatTime(grid, bar.start) ?? 0;
    const end = beatTime(grid, bar.next) ?? Infinity;
    const inBar = chords.filter((chord) => chord.time >= start && chord.time < end);
    return `Bar ${bar.number} ${formatTime(start)}: ${inBar.length ? inBar.map(label).join(", ") : "-"}`;
  });
}

/** The bass notes the app heard, one line per bar, one note per beat. A beat with no sure note shows `-`. Needs the beat grid for the times. */
function bassLines(beats: readonly BassLineBeat[], grid: BeatGrid): string[] {
  const note = (entry: BassLineBeat | undefined) => (entry && entry.pc !== null && entry.confidence >= BASS_LINE_CONFIDENT ? NOTE_NAMES[entry.pc] : "-");
  const byBeat = new Map(beats.map((entry) => [entry.beat, entry]));
  return barsOf(grid).map((bar) => {
    const start = beatTime(grid, bar.start) ?? 0;
    return `Bar ${bar.number} ${formatTime(start)}: ${bar.beats.map((beat) => note(byBeat.get(beat))).join(" ")}`;
  });
}

/** The sections the analysis suggested, as a table. Drums and bass are shown as off where the stems are silent. */
function detectedTable(sections: readonly DetectedSection[]): string {
  const rows = sections.map((section) => {
    const drums = section.drumsOff ? "off" : "";
    const bass = section.bassOff ? "off" : "";
    const level = section.levelDb === undefined ? "" : `${section.levelDb.toFixed(1)} dB`;
    return `| ${formatTime(section.start)} | ${formatTime(section.end)} | ${section.name} | ${drums} | ${bass} | ${level} |`;
  });
  return ["| Start | End | Section | Drums off | Bass off | Level |", "| --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}

/** The found values, one per line. Missing values are left out. */
function foundLines(input: BriefInput, grid: BeatGrid | null): string[] {
  const analysis = parseAnalysis(input.options.analysis);
  const lines: string[] = [];
  if (input.durationSeconds > 0) lines.push(`- Length: ${formatTime(input.durationSeconds)}`);
  const bpm = Number(input.bpm);
  if (input.bpm.trim() && Number.isFinite(bpm)) lines.push(`- Tempo: ${bpm} BPM`);
  else if (analysis?.tempo) lines.push(`- Tempo found: ${analysis.tempo.bpm} BPM${analysis.tempo.steady ? "" : " (the tempo varies)"}`);
  if (typeof input.options.beats === "number") lines.push(`- Meter: ${input.options.beats}/4`);
  else if (analysis?.meter) lines.push(`- Meter found: ${analysis.meter.beatsPerBar}/4${analysis.meter.confidence < METER_CERTAIN ? " (not certain)" : ""}`);
  const firstBeat = typeof input.options.firstBeat === "number" ? input.options.firstBeat : analysis?.tempo?.firstBeat;
  if (firstBeat !== undefined) lines.push(`- First beat: ${formatTime(firstBeat)}`);
  if (typeof input.options.songKey === "string" && input.options.songKey) lines.push(`- Key: ${input.options.songKey}`);
  else if (analysis?.key) lines.push(`- Key found: ${analysis.key.estimate.name}`);
  if (analysis?.loudness) lines.push(`- Loudness: ${analysis.loudness.lufs.toFixed(1)} LUFS`);
  if (grid && !barStarts(grid).length) lines.push("- Bars: none found");
  return lines;
}

/** One block of the brief: a heading and its body, or nothing when the body is empty. */
function block(heading: string, body: string[]): string {
  return body.length ? [`## ${heading}`, "", ...body].join("\n") : "";
}

/**
 * The song brief as Markdown: the intro, what the app found (length, tempo, meter, key, loudness), the bars, the sections the analysis
 * suggested, the chords, the bass notes it heard, the lyrics as transcribed, and the draft song map. A part the song does not have is left
 * out. Pure: the same input always gives the same text.
 */
export function songBrief(input: BriefInput): string {
  const analysis = parseAnalysis(input.options.analysis);
  const grid = parseBeatGrid(input.options.beatGrid);
  const lyrics = input.lyrics.trim();
  const blocks = [
    `# Song brief: ${input.title.trim() || "Untitled"}`,
    INTRO,
    block("What the app found", foundLines(input, grid)),
    block("Bars", grid ? barLines(grid) : []),
    block("Detected sections", analysis?.sections?.length ? [detectedTable(analysis.sections)] : []),
    block("Chords", analysis?.chords?.chords.length ? chordLines(analysis.chords.chords, grid) : []),
    block("Bass notes heard", grid && analysis?.bassLine?.beats.length ? bassLines(analysis.bassLine.beats, grid) : []),
    block("Lyrics as transcribed", lyrics ? [`${OUTER_FENCE}\n${lyrics}\n${OUTER_FENCE}`] : []),
    block("Draft song map", [`${OUTER_FENCE}markdown\n${writeSongMap(draftSongMap(input))}${OUTER_FENCE}`]),
  ];
  return `${blocks.filter((part) => part !== "").join("\n\n")}\n`;
}

/** A saved section as the map writes it: its times and name, and the band's own choices for it, when it has any. */
function sectionOf(section: Section, band: ReturnType<typeof parseBandSettings>): SongMapSection {
  const override = band.sections[section.id] ?? {};
  const play = override.play;
  const bass = play?.bass === false ? "off" : play && override.bassPart ? override.bassPart : undefined;
  return {
    start: section.start,
    end: section.end,
    name: section.name,
    ...(play ? { drums: play.drums } : {}),
    ...(bass ? { bass } : {}),
    ...(override.style ? { style: override.style } : {}),
    ...(override.energy ? { energy: override.energy } : {}),
    ...(override.busy ? { busy: override.busy } : {}),
    ...(override.loud ? { loud: override.loud } : {}),
    ...(override.fill !== undefined ? { fill: override.fill } : {}),
    ...(override.shape !== undefined ? { shape: override.shape } : {}),
  };
}

/** A section the analysis suggested. It says drums or bass are off only where the stems are silent. */
function detectedSectionOf(section: DetectedSection): SongMapSection {
  return {
    start: section.start,
    end: section.end,
    name: section.name,
    ...(section.drumsOff ? { drums: false } : {}),
    ...(section.bassOff ? { bass: "off" as const } : {}),
  };
}

/**
 * The song's current state as a song map: the tempo and key, the sections with the band's choices for each, the bass notes, the chart
 * and the notes. The saved sections are used; when there are none, the sections the analysis suggested are. Importing this map unchanged
 * writes the same values back (see `planSongMap`).
 */
export function draftSongMap(input: BriefInput): SongMap {
  const options = input.options;
  const band = parseBandSettings(options.band);
  const saved = parseSections(options.sections);
  const detected = parseAnalysis(options.analysis)?.sections ?? [];
  const bpm = Number(input.bpm);
  const key = typeof options.songKey === "string" ? parseSongKey(options.songKey) : null;
  const notes = typeof options.songMapNotes === "string" ? options.songMapNotes.trim() : "";
  const chart = input.chart.trim() ? input.chart : input.lyrics.trim() ? input.lyrics : undefined;
  const map: SongMap = {
    title: input.title.trim() || undefined,
    sections: saved.length ? saved.map((section) => sectionOf(section, band)) : detected.map(detectedSectionOf),
    bassNotes: band.bassOverrides.map((note): SongMapBassNote =>
      note.octave === undefined ? { start: note.start, end: note.end, pc: note.pc } : { ...note, octave: note.octave },
    ),
    ...(band.marks.length > 0 ? { marks: band.marks.map((mark): SongMapMark => (mark.beats === undefined ? { time: mark.time, kind: mark.kind } : { time: mark.time, kind: mark.kind, beats: mark.beats })) } : {}),
    style: band.style,
    chart,
    notes: notes || undefined,
    extra: {},
    ignored: [],
  };
  if (input.durationSeconds > 0) map.duration = input.durationSeconds;
  if (input.bpm.trim() && Number.isFinite(bpm)) map.bpm = bpm;
  if (typeof options.beats === "number") map.beatsPerBar = options.beats;
  if (typeof options.firstBeat === "number") map.firstBeat = options.firstBeat;
  if (key) map.key = key;
  return map;
}
