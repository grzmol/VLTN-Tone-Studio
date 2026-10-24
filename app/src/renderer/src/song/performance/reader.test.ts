import { expect, it } from 'vitest';
import { performanceLines } from './reader';

it('merges chords by lyric intervals, preserving intro and uncertain passages', () => {
  const lines = performanceLines('', '[00:05] First line\n[00:10] Second line', [
    { time: 0, name: 'C', confidence: 1 }, { time: 6, name: 'Am', confidence: 1 },
    { time: 8, name: 'N', confidence: 0 }, { time: 11, name: 'F', confidence: 1 },
  ]);
  expect(lines.map(l => [l.time, l.text, l.chords.map(c => c.name)])).toEqual([
    [0, '', ['C']], [5, 'First line', ['C', 'Am', 'N']], [10, 'Second line', ['F']],
  ]);
});
it('uses chart chords and lyrics instead of automatic drafts without showing MIDI', () => {
  const lines = performanceLines('[00:02] [C/G] My **words** {midi:pc 1 3}', '[00:02] Misheard', [{ time: 2, name: 'D', confidence: 1 }]);
  expect(lines).toEqual([{ time: 2, text: '[C/G] My **words**', chords: [{ time: 2, name: 'C/G' }] }]);
});
it('combines a chord-only chart with separate lyrics and ignores MIDI-only rows', () => {
  expect(performanceLines('[00:01] {midi:pc 1 2}\n[00:04] [Am]', '[00:03] Words', [])[0]).toEqual({ time: 3, text: 'Words', chords: [{ time: 4, name: 'Am' }] });
});
it('preserves untimed reading text and tolerates invalid MIDI edits', () => {
  expect(performanceLines('', 'Plain lyrics', [])[0].text).toBe('Plain lyrics');
  expect(() => performanceLines('[00:01] {midi:wrong}', '[00:02] Words', [])).not.toThrow();
});
