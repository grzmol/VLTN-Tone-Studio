import { parseChart, type Cue } from './chart';
import type { Chord } from './chords';

export interface ReaderLine { time: number; text: string; chords: { time: number; name: string }[] }
const chordPattern = /\[([A-G][#b]?[^\]\s]*|N)\]/g;
/** Merge by time interval, without inventing word-level chord alignment or changing MIDI cues. */
export function performanceLines(chart: string, lyrics: string, estimates: Chord[]): ReaderLine[] {
  const safeParse = (text: string): Cue[] => { try { return parseChart(text); } catch { return []; } };
  const cues = safeParse(chart);
  const words = (text: string) => text.replace(chordPattern, '').trim();
  const chartWords = cues.filter(c => words(c.text));
  let lines: ReaderLine[] = (chartWords.length ? chartWords : safeParse(lyrics)).map(c => ({ time: c.time, text: c.text, chords: [] }));
  const manual = cues.flatMap(c => [...c.text.matchAll(chordPattern)].map(m => ({ time: c.time, name: m[1] })));
  const changes = manual.length ? manual : estimates;
  if (!lines.length) {
    const plain = (lyrics || chart).split(/\r?\n/).filter(line => !/^\[[\w]+:/.test(line)).map(line => line.replace(/\{(?:midi|label):[^}]*\}/g, '').replace(/\[\d+:[0-5]\d(?:\.\d+)?\]/g, '').trim()).filter(Boolean);
    lines = plain.map(text => ({ time: NaN, text, chords: [...text.matchAll(chordPattern)].map(match => ({ time: NaN, name: match[1] })) }));
  }
  const timed = lines.filter(line => Number.isFinite(line.time));
  if (changes.length && (!timed.length || changes[0].time < timed[0].time)) {
    lines.unshift({ time: changes[0].time, text: '', chords: [] });
  }
  for (const chord of [...changes].sort((a, b) => a.time - b.time)) {
    const index = lines.findLastIndex(line => line.time <= chord.time);
    if (index >= 0) lines[index].chords.push({ time: chord.time, name: chord.name });
  }
  // Carry a sustained chord onto the next lyric line, until silence or another change.
  const sorted = [...changes].sort((a, b) => a.time - b.time);
  for (const line of lines) {
    const held = sorted.findLast(chord => chord.time < line.time);
    if (held && held.name !== 'N' && line.chords[0]?.time !== line.time)
      line.chords.unshift({ time: line.time, name: held.name });
  }
  return lines;
}
