// The fill-in rules for a finished analysis (spec 80). One set of rules writes a song's analysis back, whether the Library batch or the
// song runner does it: a tempo the performer chose is kept unless they asked to replace it, a 3 is never applied, and loudness only fills
// in a song that has none. This file is pure, so the rules are tested without the library or the screen.

import type { BeatGrid } from "../band/beat-grid";
import { needsTempoDetection, readTempoSource, type TempoSource } from "../performance/tempo-source";
import { parseSections } from "../performance/sections";
import { chartSourceOf, withLyricsChart, type ChartSource, type LyricsMade, type PreviousChart } from "../performance/lyrics-chart";
import { sectionsToApply } from "./sections";
import { METER_CERTAIN, type SongAnalysis } from "./song-analysis";

/** A saved song as the batch reads it: its id, its title, and its saved settings (the tempo, the options and the chart). */
export interface BatchSong {
  id: string;
  title: string;
  settings: Record<string, string>;
}

/** The options of a saved song, read from its `:options` entry. A damaged entry reads as no options. */
export function parseOptions(json: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Whether the saved tempo may be changed by the analysis. A manual, tap or chart tempo is kept, unless the performer asked to replace it. */
export function tempoMayChange(song: BatchSong, replaceManual: boolean): boolean {
  const source: TempoSource | null = readTempoSource(parseOptions(song.settings[":options"]));
  return replaceManual || source === "detected" || needsTempoDetection(song.settings[":bpm"] ?? "", source);
}

/** What a finished analysis changes in a saved song, as the settings the library writes. `tempoChange` is set when the tempo changed. */
export interface WriteBack {
  values: Record<string, string>;
  tempoChange: { from: number; to: number } | null;
}

/**
 * The settings a finished analysis writes to a saved song. The tempo, first beat, meter (4 only, when certain) and beat grid are applied
 * under the same rules as the Performance screen: a grid the performer made is kept unless the performer asked to replace the tempo. A 3
 * is not applied, since the Performance screen only offers it. Loudness fills in only a song that has none.
 */
export function planWriteBack(
  song: BatchSong,
  analysis: SongAnalysis | null,
  grid: BeatGrid | null,
  replaceManual: boolean,
  lyrics: LyricsWrite | null = null,
): WriteBack {
  const options = parseOptions(song.settings[":options"]);
  const values: Record<string, string> = {};
  const next: Record<string, unknown> = analysis ? { ...options, analysis } : { ...options };
  const tempoChange = analysis ? applyAnalysis(song, analysis, grid, replaceManual, options, next, values) : null;
  if (lyrics) {
    const previousText = song.settings[":lyrics"] ?? "";
    const replaced: PreviousChart | null = previousText.trim() && previousText !== lyrics.text ? { text: previousText, source: chartSourceOf(options) } : null;
    values[":lyrics"] = lyrics.text;
    Object.assign(next, withLyricsChart(next, replaced, { source: lyrics.source, made: lyrics.made }));
  }
  values[":options"] = JSON.stringify(next);
  return { values, tempoChange };
}

/** A lyrics chart the lyrics step made for a song, with its source and the model that made it. */
export interface LyricsWrite {
  text: string;
  source: ChartSource;
  made: LyricsMade;
}

/** The analysis's part of a write-back: the tempo, the sections and the loudness, under the rules planWriteBack describes. */
function applyAnalysis(
  song: BatchSong,
  analysis: SongAnalysis,
  grid: BeatGrid | null,
  replaceManual: boolean,
  options: Record<string, unknown>,
  next: Record<string, unknown>,
  values: Record<string, string>,
): WriteBack["tempoChange"] {
  let tempoChange: WriteBack["tempoChange"] = null;
  // Detected sections fill in a song with none. A song's own sections, and the suggestion kept in the analysis, are left as they are.
  const sections = sectionsToApply(parseSections(options.sections), analysis.sections);
  if (sections) next.sections = sections;
  if (analysis.tempo && tempoMayChange(song, replaceManual)) {
    const from = Number(song.settings[":bpm"]) || 0;
    values[":bpm"] = String(analysis.tempo.bpm);
    tempoChange = from === analysis.tempo.bpm ? null : { from, to: analysis.tempo.bpm };
    next.tempoSource = "detected";
    next.firstBeat = analysis.tempo.firstBeat;
    if (grid && (replaceManual || !options.beatGrid || options.beatGridSource === "analysis")) {
      next.beatGrid = grid;
      next.beatGridSource = "analysis";
    }
    const meter = analysis.meter;
    if (meter && meter.confidence >= METER_CERTAIN && meter.beatsPerBar === 4 && (replaceManual || options.beatsSource !== "manual")) {
      next.beats = 4;
      next.beatsSource = "detected";
    }
  }
  if (analysis.loudness && typeof options.songLufs !== "number") {
    next.songLufs = analysis.loudness.lufs;
    next.songPeakDb = analysis.loudness.peakDb;
  }
  return tempoChange;
}
