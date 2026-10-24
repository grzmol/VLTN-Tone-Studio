import { useEffect, useRef, useState } from 'react';
import { host } from '@/host';
import { Button } from '@/components/ui/button';
import { useMidiConfiguration } from '@/song/performance/midi-configuration';
import { DEFAULT_PEDAL_CHANNELS, usePedalLibrary } from '@/song/performance/pedal-library';
import { PEDAL_PROFILES } from '@/song/performance/pedal-profiles';
import { playlistPreflight, type PlaylistCheck } from '@/song/performance/playlist-preflight';
export function PlaylistPreflight({ids,disabled,revision}:{ids:string[];disabled:boolean;revision:unknown}) {
  const config=useMidiConfiguration(),pedals=usePedalLibrary();
  const [report,setReport]=useState<PlaylistCheck[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  const order=JSON.stringify(ids);
  useEffect(()=>{generation.current++;setReport(null);setError('');setBusy(false);return()=>{generation.current++;};},[order,revision,config.tempoOnStart,config.tempoChannel,config.output,pedals.channels,pedals.profiles]);
  const check=async()=>{
    const request=++generation.current;setBusy(true);setReport(null);setError('');
    try {
      const snapshot=await host.song.library!.preflight(ids);
      if(request!==generation.current)return;
      setReport(playlistPreflight(ids,snapshot,{tempoOnStart:config.tempoOnStart,tempoChannel:config.tempoChannel,outputName:config.output?.name,pedals:[...PEDAL_PROFILES,...pedals.profiles].map(p=>({name:p.name,channel:pedals.channels[p.id]??DEFAULT_PEDAL_CHANNELS[p.id]??1}))}));
    }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(request===generation.current)setBusy(false);}
  };
  return <section aria-label="Playlist preflight" className="my-3 space-y-2 rounded border border-seam p-3">
    <Button variant="outline" disabled={disabled||busy||!ids.length} onClick={()=>void check()}>{busy?'Checking playlist…':'Check playlist'}</Button>
    <p className="text-xs text-silkscreen-3">Checks saved audio files, charts, MIDI channels and tempo for every entry. Save song changes first. No playback or MIDI is sent. Output preferences do not confirm a connected pedal.</p>
    {busy&&<p role="status">Checking saved files without loading audio into memory…</p>}
    {error&&<p role="alert">{error}</p>}
    {report&&<><p role="status">{report.length} entries checked · {report.reduce((n,r)=>n+r.errors.length,0)} errors · {report.reduce((n,r)=>n+r.warnings.length,0)} warnings</p>
      <p className="text-xs">Snapshot of saved files and current MIDI preferences. Recheck after external file changes. File presence and size are checked, not audio contents or physical pedal response. Warnings are advisory.</p>
      <ol className="max-h-80 space-y-2 overflow-auto">{report.map(r=><li key={r.entry} className="rounded border border-seam p-2"><strong>{r.entry}. {r.title}</strong>{!r.errors.length&&!r.warnings.length?<p>No static issues found.</p>:<ul>{r.errors.map((s,i)=><li key={'e'+i} className="text-red-400">Error: {s}</li>)}{r.warnings.map((s,i)=><li key={'w'+i}>Warning: {s}</li>)}</ul>}</li>)}</ol></>}
  </section>;
}
