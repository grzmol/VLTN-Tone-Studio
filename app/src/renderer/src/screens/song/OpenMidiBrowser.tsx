import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { loadOpenMidi, convertOpenMidi, type OpenMidiDevice } from '@/song/performance/openmidi';
import type { PedalProfile } from '@/song/performance/pedal-profiles';

export function OpenMidiBrowser({onImport}:{onImport:(profile:PedalProfile)=>void}) {
  const [devices,setDevices]=useState<OpenMidiDevice[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState(''),[choice,setChoice]=useState('');
  const selected=devices.find(d=>d.brand+'/'+d.model===choice);
  const load=async()=>{setBusy(true);setError('');try{setDevices(await loadOpenMidi());}catch(e){setError(String(e));}finally{setBusy(false);}};
  const add=()=>{try{if(!selected)return;onImport(convertOpenMidi(selected).profile);setError('');}catch(e){setError(String(e));}};
  return <details><summary className="cursor-pointer text-sm">Browse OpenMIDI community pedals</summary><div className="mt-3 space-y-3">
    <p className="text-sm text-silkscreen-3">Download the community catalogue from Morningstar Engineering’s OpenMIDI repository. Imported CC profiles are saved locally and remain available offline. Manual-checked built-ins stay separate.</p>
    <Button variant="outline" disabled={busy||devices.length>0} onClick={()=>void load()}>{busy?'Loading OpenMIDI…':devices.length?'OpenMIDI catalogue loaded':'Load OpenMIDI catalogue'}</Button>
    {!!devices.length&&<><p role="status" className="text-sm">{devices.length} community devices available.</p><div className="flex flex-wrap items-center gap-3">
      <input aria-label="Search OpenMIDI" className="rounded border border-seam bg-background p-2" placeholder="Search brand or pedal…" value={query} onChange={e=>setQuery(e.target.value)} />
      <select aria-label="OpenMIDI pedal" className="max-w-full rounded border border-seam bg-background p-2" value={choice} onChange={e=>{setChoice(e.target.value);setError('');}}><option value="">Choose a community pedal…</option>{devices.filter(d=>d.brand+'/'+d.model===choice||d.name.toLowerCase().includes(query.toLowerCase())).map(d=><option key={d.brand+'/'+d.model} value={d.brand+'/'+d.model}>{d.name}</option>)}</select>
    </div>{selected&&<><p className="text-sm text-silkscreen-3 whitespace-pre-wrap">{(()=>{try{const result=convertOpenMidi(selected);return `${result.profile.actions.length} CC actions ready; ${result.skipped} unsupported entries skipped. Community/default CC mappings must match the pedal’s settings. Full setup notes are retained in the imported profile.`;}catch(e){return String(e);}})()}</p><Button onClick={add}>Import OpenMIDI pedal</Button></>}</>}
    <p className="text-xs text-silkscreen-3">Data: Morningstar Engineering / OpenMIDI, Apache-2.0. Attribution and the full licence are retained in imported/exported profiles. Importing does not send MIDI.</p>
    {error&&<p role="alert" className="text-red-400">{error}</p>}
  </div></details>;
}
