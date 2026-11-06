import { parseChart, type Cue } from "./chart";
import type { Chord } from "./chords";
import type { MidiMacro } from "./midi-macros";

export interface ReaderLine {
  time: number;
  text: string;
  chords: { time: number; name: string }[];
}
/** A chord token in a chart line, such as `[Am7]` or `[N]`. The first group is the chord name. */
export const chordPattern = /\[([A-G][#b]?[^\]\s]*|N)\]/g;
/**
 * The untimed text of a chart: its lines with directives, timestamps and MIDI removed. Comments and headings are kept, since the reader and
 * the editor decide how to show them.
 */
export function untimedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\[[\w]+:/.test(line))
    .map((line) =>
      line
        .replace(/\{(?:midi(?:@\w+)?|label):[^}]*\}/g, "")
        .replace(/\[\d+:[0-5]\d(?:\.\d+)?\]/g, "")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Merge by time interval, without inventing word-level chord alignment or changing MIDI cues. A chart with no timed lines, such as an
 * imported ChordPro song, is read as it is written, and the lyrics draft and the audio chord estimates do not replace it.
 */
export function performanceLines(chart: string, lyrics: string, estimates: Chord[], macros: readonly MidiMacro[] = []): ReaderLine[] {
  const safeParse = (text: string): Cue[] => {
    try {
      return parseChart(text, macros);
    } catch {
      return [];
    }
  };
  const cues = safeParse(chart);
  const words = (text: string) => text.replace(chordPattern, "").trim();
  const chartWords = cues.filter((c) => words(c.text));
  const untimedChart = !cues.length && untimedLines(chart).length > 0;
  let lines: ReaderLine[] = (chartWords.length ? chartWords : untimedChart ? [] : safeParse(lyrics)).map((c) => ({ time: c.time, text: c.text, chords: [] }));
  const manual = cues.flatMap((c) => [...c.text.matchAll(chordPattern)].map((m) => ({ time: c.time, name: m[1] })));
  const changes = manual.length ? manual : untimedChart ? [] : estimates;
  if (!lines.length) {
    const plain = untimedChart ? untimedLines(chart) : untimedLines(lyrics || chart);
    lines = plain.map((text) => ({ time: NaN, text, chords: [...text.matchAll(chordPattern)].map((match) => ({ time: NaN, name: match[1] })) }));
  }
  const timed = lines.filter((line) => Number.isFinite(line.time));
  if (changes.length && (!timed.length || changes[0].time < timed[0].time)) {
    lines.unshift({ time: changes[0].time, text: "", chords: [] });
  }
  for (const chord of [...changes].sort((a, b) => a.time - b.time)) {
    const index = lines.findLastIndex((line) => line.time <= chord.time);
    if (index >= 0) lines[index].chords.push({ time: chord.time, name: chord.name });
  }
  // Carry a sustained chord onto the next lyric line, until silence or another change.
  const sorted = [...changes].sort((a, b) => a.time - b.time);
  for (const line of lines) {
    const held = sorted.findLast((chord) => chord.time < line.time);
    if (held && held.name !== "N" && line.chords[0]?.time !== line.time) line.chords.unshift({ time: line.time, name: held.name });
  }
  return lines;
}
