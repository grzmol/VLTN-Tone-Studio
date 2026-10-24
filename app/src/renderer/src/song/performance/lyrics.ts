import { lrcTime } from './chart';
export interface LyricSegment { time: number; text: string }
export function transcriptSegments(chunks: { text: string; timestamp: [number | null, number | null] }[], duration: number): LyricSegment[] {
  const segments = chunks.flatMap(chunk => {
    const time = chunk.timestamp[0];
    // Keep generated text inert when copied into the chart's MIDI-aware syntax.
    const text = chunk.text.replace(/[\r\n]+/g, ' ').replace(/\{midi:/gi, '{midi :').trim();
    return time !== null && Number.isFinite(time) && time >= 0 && time < duration && text ? [{ time, text }] : [];
  }).sort((a, b) => a.time - b.time);
  // Remove duplicate overlapping-window output, while preserving repeated lyrics in later verses.
  return segments.filter((segment, i) => !segments.slice(Math.max(0, i - 3), i).some(previous => previous.text === segment.text && Math.abs(previous.time - segment.time) < 0.5));
}
export function lyricsLrc(segments: LyricSegment[]): string {
  return segments.map(s => `${lrcTime(s.time)} ${s.text}`).join('\n');
}
