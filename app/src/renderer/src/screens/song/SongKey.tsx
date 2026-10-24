import { useEffect, useMemo, useState } from 'react';
import type { PcmAudio, Stems } from '@/song/types';
import { KEY_NAMES, SONG_KEYS, keyAudio, type KeyEstimate } from '@/song/performance/key';
import { readOptions } from '@/song/performance/settings';

interface KeySettings { songKey: string; detectedKey: KeyEstimate | null; keyAudioSource: string }
export function SongKey({ stems, original, storageKey, shift=0 }: { stems: Stems | null; original?: PcmAudio; storageKey: string; shift?: number }) {
  const [saved]=useState(()=>readOptions<KeySettings>(storageKey,{songKey:'',detectedKey:null,keyAudioSource:''}));
  const [override,setOverride]=useState(SONG_KEYS.includes(saved.songKey)?saved.songKey:'');
  const [estimate,setEstimate]=useState<KeyEstimate|null>(saved.detectedKey && SONG_KEYS.includes(saved.detectedKey.name)?saved.detectedKey:null);
  const [analysisSource,setAnalysisSource]=useState(saved.keyAudioSource);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useMemo(()=>keyAudio(stems,original),[stems,original]);
  useEffect(()=>{
    // Preserve a saved result while the same source is reanalysed. Switching
    // tabs must not replace useful saved metadata with a temporary null.
    if (!input || input.name !== analysisSource) setEstimate(null);
    setAnalysisSource(input?.name ?? ''); setError('');
    if(!input) {setBusy(false);return;}
    let active=true, worker:Worker|undefined;
    setBusy(true);
    try {
      worker=new Worker(new URL('../../song/performance/key-worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=(event:MessageEvent<{estimate?:KeyEstimate|null;error?:string}>)=>{
        if(!active)return;
        setEstimate(event.data.estimate ?? null);setError(event.data.error ?? '');setBusy(false);worker?.terminate();
      };
      worker.onerror=()=>{if(active){setBusy(false);setError('Key analysis could not finish. You can choose the key manually.');worker?.terminate();}};
      worker.postMessage(input.audio);
    }catch(e){setBusy(false);setError(String(e));worker?.terminate();}
    return ()=>{active=false;worker?.terminate();};
  },[input]);
  useEffect(()=>{
    try {localStorage.setItem(storageKey+':options',JSON.stringify({...readOptions(storageKey,{}),songKey:override,detectedKey:estimate,keyAudioSource:analysisSource}));}
    catch {setError('Could not save the song key.');}
  },[storageKey,override,estimate,analysisSource]);
  const name=override || estimate?.name;
  const root=name ? KEY_NAMES.indexOf(name.split(' ')[0]) : -1;
  const displayed=root<0 ? '' : `${KEY_NAMES[((root+shift)%12+12)%12]} ${name!.split(' ')[1]}`;
  return <section aria-label="Song key" className="flex flex-wrap items-center gap-3 rounded-lg border border-seam px-3 py-2 text-sm">
    <strong>Song key: {name || (busy?'Analysing…':'Unknown')}</strong>
    <label>Key override <select aria-label="Song key override" className="rounded border border-seam bg-background p-2" value={override} onChange={e=>setOverride(e.target.value)}><option value="">Automatic estimate</option>{SONG_KEYS.map(key=><option key={key}>{key}</option>)}</select></label>
    {name && shift!==0 && <span>Displayed chords: {displayed} ({shift>0?'+':''}{shift} semitones)</span>}
    <span role="status" className="text-silkscreen-3">{busy?`Analysing ${analysisSource}…`:estimate?`Estimated ${estimate.name} from ${analysisSource} · ${estimate.confidence==='strong'?'clearer match':'tentative match'} · alternatives: ${estimate.alternatives.join(', ')}`:input?`No reliable major/minor key found in ${analysisSource}.`:'Open audio or split the song to analyse its key.'}</span>
    <p className="w-full text-xs text-silkscreen-3">Guitar is preferred, then piano, other, bass, vocals or the original mix. This estimates the recording’s overall major/minor key; relative keys, modes and key changes can be ambiguous. A manual choice is saved with the song. Key and chord transposition do not change audio or MIDI.</p>
    {error && <p role="alert" className="w-full text-red-400">{error}</p>}
  </section>;
}
