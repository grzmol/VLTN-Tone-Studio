import { describe, expect, it } from 'vitest';
import { defaultChordSource } from './sources';
import { lyricsLrc, transcriptSegments } from './lyrics';
import { parseChart } from './chart';

const sound = { sampleRate: 44100, channels: [new Float32Array(1000).fill(0.1)] };
const silence = { sampleRate: 44100, channels: [new Float32Array(1000)] };
describe('chord source selection', () => {
  it('prefers guitar and falls back when absent or silent', () => {
    expect(defaultChordSource({ guitar: sound, piano: sound, other: sound })).toBe('guitar');
    expect(defaultChordSource({ guitar: silence, piano: sound, other: sound })).toBe('piano');
    expect(defaultChordSource({ other: sound, vocals: sound })).toBe('other');
    expect(defaultChordSource({ guitar: silence })).toBe('');
    expect(defaultChordSource(null)).toBe('');
  });
});
describe('lyrics track', () => {
  it('removes overlapping transcription duplicates while preserving later repeated lines', () => {
    expect(transcriptSegments([0, 0.2, 20].map(time => ({ text: 'Sing again', timestamp: [time, time + 1] as [number, number] })), 30).map(s => s.time)).toEqual([0, 20]);
  });
  it('rejects unusable timestamps and keeps transcription from becoming MIDI commands', () => {
    const result = transcriptSegments([
      { text: 'Second\nline', timestamp: [2, 3] },
      { text: '{midi:pc 1 5}', timestamp: [0, 1] },
      { text: 'unknown', timestamp: [null, null] },
      { text: 'past end', timestamp: [10, 11] },
      { text: 'invalid', timestamp: [NaN, 1] },
    ], 10);
    expect(result).toEqual([{ time: 0, text: '{midi :pc 1 5}' }, { time: 2, text: 'Second line' }]);
    expect(parseChart(lyricsLrc(result)).every(c => c.messages.length === 0)).toBe(true);
  });
  it('exports timestamps across minute boundaries without invalid seconds', () => {
    const output = lyricsLrc([{ time: 59.999, text: 'Next minute' }]);
    expect(output).toBe('[01:00.00] Next minute');
    expect(parseChart(output)[0].time).toBe(60);
  });
});
