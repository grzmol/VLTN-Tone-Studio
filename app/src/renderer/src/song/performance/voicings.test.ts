import { expect, it } from 'vitest';
import { chordVoicings, voicingTab } from './voicings';

it.each(['C', 'F', 'G', 'Am', 'Bbm', 'F#7', 'Cmaj7', 'Dm7', 'Dsus2', 'Gsus4', 'A5', 'Bdim', 'Cdim7', 'Caug'])('offers multiple playable positions for %s with barre shapes first', chord => {
  const voicings = chordVoicings(chord);
  expect(voicings.length).toBeGreaterThanOrEqual(2);
  expect(voicings[0].barre).toBe(true);
  expect(new Set(voicings.map(v => v.frets.join())).size).toBe(voicings.length);
  for (const v of voicings) expect(v.frets.every(f => f === null || (f >= 0 && f <= 17))).toBe(true);
});
it('uses the requested bass for slash chords', () => {
  const voicings = chordVoicings('C/G');
  expect(voicings.length).toBeGreaterThan(1);
  for (const v of voicings) {
    const notes = v.frets.flatMap((f,i) => f === null ? [] : [[40,45,50,55,59,64][i] + f]);
    expect(Math.min(...notes) % 12).toBe(7);
    expect(notes.every(n => [0,4,7].includes(n % 12))).toBe(true);
  }
});
it('does not invent voicings for unsupported symbols and prints tab high to low', () => {
  expect(chordVoicings('N')).toEqual([]);
  expect(chordVoicings('C13#11')).toEqual([]);
  expect(voicingTab([null,3,2,0,1,0])).toBe('e|--0--|\nB|--1--|\nG|--0--|\nD|--2--|\nA|--3--|\nE|--x--|');
});
