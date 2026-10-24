import { expect, it } from 'vitest';
import { detectKey, keyAudio, keyFromChroma, KEY_NAMES } from './key';
import type { PcmAudio } from '../types';
const major=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const minor=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
it.each(KEY_NAMES.map((name,i)=>[name,i] as const))('matches both tonal profiles rooted on %s', (name,root)=>{
  for(const [mode,profile] of [['major',major],['minor',minor]] as const) {
    const chroma=Array.from({length:12},(_,i)=>profile[(i-root+12)%12]);
    expect(keyFromChroma(chroma)?.name).toBe(`${name} ${mode}`);
  }
});
const signal: PcmAudio={sampleRate:44100,channels:[new Float32Array(44100).fill(0.1)]};
const silent: PcmAudio={sampleRate:44100,channels:[new Float32Array(44100)]};
it('prefers usable guitar then harmonic stems and finally the original mix',()=>{
  expect(keyAudio({guitar:signal,piano:signal},signal)?.name).toBe('guitar');
  expect(keyAudio({guitar:silent,piano:signal},signal)?.name).toBe('piano');
  expect(keyAudio({other:signal,bass:signal},signal)?.name).toBe('other');
  expect(keyAudio({bass:signal,vocals:signal},signal)?.name).toBe('bass');
  expect(keyAudio({drums:signal},signal)?.name).toBe('original mix');
  expect(keyAudio(null,signal)?.name).toBe('original mix');
  expect(keyAudio({guitar:silent},silent)).toBeNull();
});
it('does not assign a key to silence, flat chroma, a single pitch or invalid data',()=>{
  expect(detectKey(silent)).toBeNull();
  expect(keyFromChroma(new Float64Array(12).fill(1))).toBeNull();
  expect(keyFromChroma([1,...Array(11).fill(0)])).toBeNull();
  expect(keyFromChroma([NaN,...Array(11).fill(1)])).toBeNull();
});
function progression(chords:number[][]):PcmAudio {
  const sampleRate=22050, seconds=2;
  const pcm=Float32Array.from({length:chords.length*sampleRate*seconds},(_,i)=>{
    const notes=chords[Math.floor(i/(sampleRate*seconds))];
    return notes.reduce((sum,midi)=>sum+0.12*Math.sin(2*Math.PI*440*2**((midi-69)/12)*i/sampleRate),0);
  });
  return {sampleRate,channels:[pcm,pcm.map(n=>-n)]};
}
it('estimates major and minor progressions from audio without stereo cancellation',()=>{
  expect(detectKey(progression([[60,64,67],[65,69,72],[67,71,74],[60,64,67]]))?.name).toBe('C major');
  expect(detectKey(progression([[57,60,64],[62,65,69],[64,68,71],[57,60,64]]))?.name).toBe('A minor');
});

it('does not report a key for broadband noise',()=>{
  let state=12345;
  const channel=Float32Array.from({length:44100*3},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state/2**32-.5)*.1;});
  expect(detectKey({sampleRate:44100,channels:[channel]})).toBeNull();
});
