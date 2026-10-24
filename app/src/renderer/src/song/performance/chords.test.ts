import { expect, it } from 'vitest';
import { detectChords, smoothChordFrames } from './chords';

it('rejects silence and recognises an opposite-phase stereo major chord', () => {
  const sampleRate = 44100;
  const channel = Float32Array.from({ length: sampleRate * 2 }, (_, i) => [261.626, 329.628, 391.995].reduce((s,f) => s + 0.1 * Math.sin(2 * Math.PI * f * i / sampleRate), 0));
  expect(detectChords({ sampleRate, channels: [new Float32Array(sampleRate)] })[0].name).toBe('N');
  const stereo = detectChords({ sampleRate, channels: [channel, channel.map(n => -n)] });
  expect(stereo[0].name).toBe('C');
});
it('removes isolated flicker while preserving sustained changes and silence', () => {
  const frames = ['C','Am','C','G','G','N','C'].map((name,i) => ({ time: i / 2, name, confidence: 0.8 }));
  expect(smoothChordFrames(frames).map(c => [c.time,c.name])).toEqual([[0,'C'],[1.5,'G'],[2.5,'N'],[3,'C']]);
});
