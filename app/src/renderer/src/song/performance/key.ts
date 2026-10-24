import { fft } from '../tonematch/fft';
import type { PcmAudio, Stems } from '../types';
import { hasSignal } from './sources';

export const KEY_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
export const SONG_KEYS = KEY_NAMES.flatMap(root => [`${root} major`, `${root} minor`]);
export interface KeyEstimate {
  name: string; tonic: number; mode: 'major' | 'minor';
  correlation: number; margin: number; confidence: 'tentative' | 'strong'; alternatives: string[];
}
// Krumhansl-Kessler tonal profiles; correlation approach documented at
// https://music21.org/music21docs/moduleReference/moduleAnalysisDiscrete.html
const profiles = {
  major: [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
  minor: [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17],
};
export function keyAudio(stems: Stems | null, original?: PcmAudio): { name: string; audio: PcmAudio } | null {
  for (const name of ['guitar','piano','other','bass','vocals'] as const) {
    if (hasSignal(stems?.[name])) return { name, audio: stems![name]! };
  }
  return hasSignal(original) ? { name: 'original mix', audio: original! } : null;
}
export function keyFromChroma(chroma: ArrayLike<number>): KeyEstimate | null {
  const values = Array.from(chroma);
  if (values.length !== 12 || values.some(n => !Number.isFinite(n) || n < 0)) return null;
  const max = Math.max(...values), mean = values.reduce((a,b) => a+b,0)/12;
  if (!max || values.filter(n => n > max * 0.1).length < 3) return null;
  const centered = values.map(n => n-mean), variance = centered.reduce((a,b) => a+b*b,0);
  if (Math.sqrt(variance/12) < mean*0.12) return null;
  const scores: { tonic: number; mode: 'major' | 'minor'; score: number; name: string }[] = [];
  for (const mode of ['major','minor'] as const) {
    const profile = profiles[mode], average = profile.reduce((a,b) => a+b,0)/12;
    const norm = Math.sqrt(variance * profile.reduce((a,b) => a+(b-average)**2,0));
    for (let tonic=0; tonic<12; tonic++) {
      const score = centered.reduce((sum,value,i) => sum+value*(profile[(i-tonic+12)%12]-average),0)/norm;
      scores.push({tonic,mode,score,name:`${KEY_NAMES[tonic]} ${mode}`});
    }
  }
  scores.sort((a,b) => b.score-a.score);
  const first = scores[0], margin = first.score-scores[1].score;
  if (first.score < 0.55) return null;
  return { name:first.name, tonic:first.tonic, mode:first.mode, correlation:first.score, margin,
    confidence:first.score>=0.75 && margin>=0.12 ? 'strong' : 'tentative', alternatives:scores.slice(1,3).map(s=>s.name) };
}
/** Whole-song spectral estimate, bounded to 600 windows. No model download or audio upload. */
export function detectKey(audio: PcmAudio): KeyEstimate | null {
  if (!hasSignal(audio) || !Number.isFinite(audio.sampleRate) || audio.sampleRate<=0) return null;
  const n=16384, length=audio.channels[0].length;
  const windows=Math.min(600,Math.max(1,Math.ceil(length/(audio.sampleRate*0.5))));
  const chroma=new Float64Array(12);
  for (let window=0; window<windows; window++) {
    const start=windows===1 ? 0 : Math.floor(window*Math.max(0,length-n)/(windows-1));
    let channel=audio.channels[0], loudest=-1;
    for (const candidate of audio.channels) {
      let energy=0;
      for(let i=start;i<Math.min(length,start+n);i++) energy+=candidate[i]**2;
      if(energy>loudest) {loudest=energy;channel=candidate;}
    }
    if(loudest/Math.min(n,length)<1e-7) continue;
    const re=new Float64Array(n), im=new Float64Array(n), frame=new Float64Array(12);
    for(let i=0;i<n;i++) re[i]=(channel[start+i]??0)*(0.5-0.5*Math.cos(2*Math.PI*i/(n-1)));
    fft(re,im);
    const power=(k:number)=>re[k]**2+im[k]**2;
    for(let k=2;k<n/2-1;k++) {
      const hz=k*audio.sampleRate/n;
      if(hz<55||hz>2000) continue;
      const peak=power(k), left=power(k-1), right=power(k+1);
      if(peak<=left||peak<right) continue;
      const offset=0.5*(Math.log(left+1e-20)-Math.log(right+1e-20))/(Math.log(left+1e-20)-2*Math.log(peak+1e-20)+Math.log(right+1e-20));
      const midi=69+12*Math.log2((k+Math.max(-0.5,Math.min(0.5,offset)))*audio.sampleRate/n/440);
      if(Math.abs(midi-Math.round(midi))>0.35) continue;
      frame[((Math.round(midi)%12)+12)%12]+=Math.sqrt(peak);
    }
    const total=frame.reduce((a,b)=>a+b,0);
    if(total) for(let i=0;i<12;i++) chroma[i]+=frame[i]/total;
  }
  return keyFromChroma(chroma);
}
