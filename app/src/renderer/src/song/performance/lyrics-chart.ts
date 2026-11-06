// Where a song's lyrics chart came from, and what it replaced. The chart is the `:lyrics` text track. Its source and the model that
// made it live in the song's `:options`, so a bulk run can tell a chart it may replace from one the performer wrote.

import { readOptions, getSetting, setSetting } from "./settings";
import type { LyricsOptions } from "./lyrics-options";

/**
 * `transcribed`: made by the transcriber and not touched since. `aligned`: the performer's own words, timed by the transcriber.
 * `user`: typed, imported or edited by hand. `unknown`: a chart made before 0.9.2, when the source was not recorded. Tone Studio cannot tell
 * whether the performer typed it, so it is protected unless the performer says otherwise.
 */
export type ChartSource = "transcribed" | "aligned" | "user" | "unknown";

export interface LyricsMade {
  model: string;
  quality: string;
  language: string;
  at: string;
}

/** The chart a save replaced, kept once so the performer can restore it. */
export interface PreviousChart {
  text: string;
  source: ChartSource;
}

/** The recorded source of a chart. Anything other than a recorded source (including none) is `unknown`, never `user` by default. */
export function chartSourceOf(options: Record<string, unknown>): ChartSource {
  const source = options.chartSource;
  return source === "transcribed" || source === "aligned" || source === "user" ? source : "unknown";
}

export function lyricsMadeOf(options: Record<string, unknown>): LyricsMade | null {
  const made = options.lyricsMade as Partial<LyricsMade> | undefined;
  return made && typeof made.model === "string" && typeof made.quality === "string" && typeof made.language === "string" ? (made as LyricsMade) : null;
}

export function previousChartOf(options: Record<string, unknown>): PreviousChart | null {
  const previous = options.previousChart as Partial<PreviousChart> | undefined;
  return previous && typeof previous.text === "string" && previous.text.trim() ? { text: previous.text, source: chartSourceOf({ chartSource: previous.source }) } : null;
}

export function lyricsMadeRecord(options: LyricsOptions, at: string): LyricsMade {
  return { model: options.model, quality: options.quality, language: options.language, at };
}

/**
 * The lines of an LRC chart, in order, without their times. Blank lines (section breaks) stay, as empty strings, so the chart can be
 * timed again with the same breaks. Trailing breaks are dropped.
 */
export function lrcTexts(lrc: string): string[] {
  const lines = lrc.split(/\r?\n/).flatMap((line) => {
    const match = /^\[\d+:[0-5]\d(?:\.\d+)?\]\s?(.*)$/.exec(line.trim());
    return match ? [match[1].trim()] : [];
  });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The options of a song after a new chart is saved: the chart's source, the model that made it, and the chart it replaces, kept once. `previous`
 * is the chart being replaced, or null when there was none.
 */
export function withLyricsChart(
  options: Record<string, unknown>,
  previous: PreviousChart | null,
  chart: { source: ChartSource; made?: LyricsMade },
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...options, chartSource: chart.source };
  if (chart.made) next.lyricsMade = chart.made;
  if (previous && previous.text.trim()) next.previousChart = previous;
  return next;
}

/** Settings to write for a new chart: the text, and the options with its source, the model that made it, and the chart it replaces. */
export function lyricsSaveValues(
  options: Record<string, unknown>,
  previousText: string,
  chart: { text: string; source: ChartSource; made?: LyricsMade },
): Record<string, string> {
  const replaced = previousText.trim() && previousText !== chart.text ? { text: previousText, source: chartSourceOf(options) } : null;
  return { ":lyrics": chart.text, ":options": JSON.stringify(withLyricsChart(options, replaced, chart)) };
}

/** Saves a new lyrics chart on a song, keeping the chart it replaces. */
export function saveLyricsChart(songKey: string, chart: { text: string; source: ChartSource; made?: LyricsMade }): void {
  const values = lyricsSaveValues(readOptions<Record<string, unknown>>(songKey, {}), getSetting(songKey, ":lyrics"), chart);
  setSetting(songKey, ":lyrics", values[":lyrics"]);
  setSetting(songKey, ":options", values[":options"]);
}

/** Records that the performer edited the chart. Any chart but a `user` one becomes `user`; the chart it replaced is not touched. */
export function markLyricsEdited(songKey: string): void {
  const options = readOptions<Record<string, unknown>>(songKey, {});
  if (chartSourceOf(options) === "user") return;
  setSetting(songKey, ":options", JSON.stringify({ ...options, chartSource: "user" }));
}

/** Puts the chart that the last save replaced back, once. Returns false when there is none to restore. */
export function restoreLyricsChart(songKey: string): boolean {
  const options = readOptions<Record<string, unknown>>(songKey, {});
  const previous = previousChartOf(options);
  if (!previous) return false;
  const next: Record<string, unknown> = { ...options, chartSource: previous.source };
  delete next.previousChart;
  delete next.lyricsMade;
  setSetting(songKey, ":lyrics", previous.text);
  setSetting(songKey, ":options", JSON.stringify(next));
  return true;
}
