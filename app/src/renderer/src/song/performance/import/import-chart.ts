/*
 * Chooses the importer for a pasted or opened text, and checks the result parses as a chart before it is offered for saving. Text that is
 * already in the app's format (timed lines, `[C]` chords, MIDI and LRC) is passed through unchanged.
 */
import { parseChart } from "../chart";
import type { MidiMacro } from "../midi-macros";
import { chordColumns, parseChordOverLyrics } from "./chord-over-lyrics";
import { parseChordPro } from "./chordpro";
import type { ImportResult } from "./import-result";

/** A ChordPro directive such as `{title: …}` or `{soc}`. The app's own braces (MIDI, labels, colour, chase) are not directives. */
const CHORDPRO_DIRECTIVE = /\{(?!(?:midi|label|color|\/color|chase|nochase)(?![a-z]))[a-z_]+[^{}]*\}/i;

/** Which importer reads the text: ChordPro when it has a directive, chord-over-lyrics when a line holds only chords, else the app's format. */
export function detectFormat(text: string): ImportResult["format"] {
  if (CHORDPRO_DIRECTIVE.test(text)) return "chordpro";
  if (text.split(/\r?\n/).some((line) => line.trim() && chordColumns(line))) return "chord-over-lyrics";
  return "app";
}

/**
 * Imports any supported text. Never throws: a chart that does not parse comes back with `error` set. `macros` are the MIDI macros the
 * chart may use, so a `$CODE` reference is checked the way the chart will be read.
 */
export function importChart(text: string, macros: readonly MidiMacro[] = []): ImportResult {
  const format = detectFormat(text);
  const result: ImportResult =
    format === "chordpro"
      ? parseChordPro(text)
      : format === "chord-over-lyrics"
        ? parseChordOverLyrics(text)
        : { format, chart: text.replace(/\r\n?/g, "\n").trimEnd(), metadata: {}, notes: [] };
  try {
    parseChart(result.chart, macros);
    return result;
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : String(error) };
  }
}
