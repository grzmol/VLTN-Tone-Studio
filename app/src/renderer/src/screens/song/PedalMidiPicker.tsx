import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { host } from '@/host';
import { lrcTime, midiCommand } from '@/song/performance/chart';
import { PEDAL_PROFILES, CUSTOM_PEDAL_TEMPLATE, actionCommands } from '@/song/performance/pedal-profiles';
import { OpenMidiBrowser } from './OpenMidiBrowser';
import { DEFAULT_PEDAL_CHANNELS, usePedalLibrary } from '@/song/performance/pedal-library';
import { useMidiConfiguration } from '@/song/performance/midi-configuration';

export function PedalMidiPicker({time,onAdd,onTest,canTest}:{time:number;onAdd:(line:string)=>void;onTest:(bytes:number[])=>void;canTest:boolean}) {
  const library=usePedalLibrary();
  const config=useMidiConfiguration();
  const profiles=[...PEDAL_PROFILES,...library.profiles];
  const [pedal,setPedal]=useState(config.pedal),[actionId,setActionId]=useState(config.commands[config.pedal]?.action ?? ''),[query,setQuery]=useState(''),[value,setValue]=useState(config.commands[config.pedal]?.value ?? 0),[assignedCC,setAssignedCC]=useState(String(library.assignments[config.pedal+':'+(config.commands[config.pedal]?.action ?? '')]??'')),[error,setError]=useState(''),[definition,setDefinition]=useState(JSON.stringify(CUSTOM_PEDAL_TEMPLATE,null,2));
  const [customName,setCustomName]=useState(''),[customSource,setCustomSource]=useState(''),[customLabel,setCustomLabel]=useState(''),[customType,setCustomType]=useState('pc'),[customNumber,setCustomNumber]=useState(0),[customValue,setCustomValue]=useState(127);
  const profile=profiles.find(p=>p.id===pedal), action=profile?.actions.find(a=>a.id===actionId);
  const channel=library.channels[pedal] ?? DEFAULT_PEDAL_CHANNELS[pedal] ?? 1;
  const field='rounded border border-seam bg-background p-2';
  const chooseAction=(id:string)=>{ const next=profile?.actions.find(a=>a.id===id);setActionId(id);setValue(config.commands[pedal]?.action===id ? config.commands[pedal].value : next?.value?.default??0);setAssignedCC(String(library.assignments[pedal+':'+id]??''));setError(''); };
  useEffect(()=>{
    if(!Number.isFinite(value))return;
    const current=useMidiConfiguration.getState();
    current.update({pedal,commands:{...current.commands,...(pedal ? {[pedal]:{action:actionId,value}} : {})}});
  },[pedal,actionId,value]);
  const run=(send:boolean)=>{try {
    if(!Number.isFinite(time)||time<0)throw new Error('Cue time must be zero or more seconds.');
    if(!profile||!action)throw new Error('Choose a pedal and a named command.');
    const commands=actionCommands(action,channel,value,assignedCC===''?undefined:Number(assignedCC));
    const messages=commands.map(midiCommand);
    if(send) messages.forEach(onTest);
    else {const label=`${profile.name}: ${action.label}${action.value?` — ${action.value.label} ${value}`:''} (ch ${channel})`.replace(/[{}\r\n]/g,' ');onAdd(`${lrcTime(time)} {label:${label}} ${commands.map(c=>`{midi:${c}}`).join(' ')}`);}
    setError('');
  }catch(e){setError(e instanceof Error?e.message:String(e));}};
  const exportText=(text:string,name:string)=>void host.song.saveFiles([{name,bytes:new TextEncoder().encode(text)}],'Export MIDI pedal definition').catch(e=>setError(String(e)));
  const importText=(text:string)=>{try{const p=library.importProfile(text);setPedal(p.id);setActionId('');setError('');}catch(e){setError(String(e));}};
  const saveNamedCommand=()=>{try{
    if(!customName.trim()||!customLabel.trim()||!customSource.trim())throw new Error('Enter the pedal name, command label and manual reference.');
    const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65);
    const id='custom-'+slug(customName),actionId='action-'+slug(customLabel);
    if(!slug(customName)||!slug(customLabel))throw new Error('Use at least one letter or number in each name.');
    const command=`${customType} $channel ${customNumber}${customType==='cc'?` ${customValue}`:''}`;
    const existing=library.profiles.find(p=>p.id===id);
    const next={version:1,id,name:customName.trim(),source:customSource.trim(),notes:existing?.notes??'Configure the pedal receive channel and verify this custom command against its manual.',actions:[...(existing?.actions.filter(a=>a.id!==actionId)??[]),{id:actionId,label:customLabel.trim(),commands:[command]}]};
    const saved=library.importProfile(JSON.stringify(next));setPedal(saved.id);setActionId(actionId);setQuery('');setError('');
  }catch(e){setError(String(e));}};
  return <div className="space-y-3" aria-label="Named pedal commands">
    <div className="flex flex-wrap items-center gap-3">
      <label>Pedal <select aria-label="MIDI pedal" className={field} value={pedal} onChange={e=>{const saved=config.commands[e.target.value];setPedal(e.target.value);setActionId(saved?.action ?? '');setValue(saved?.value ?? 0);setAssignedCC(String(library.assignments[e.target.value+':'+(saved?.action ?? '')]??''));setQuery('');setError('');}}><option value="">Choose a pedal…</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {profile&&<><label>MIDI channel <select aria-label="Pedal MIDI channel" className={field} value={channel} onChange={e=>{try{library.setChannel(pedal,Number(e.target.value));}catch(err){setError(String(err));}}}>{Array.from({length:16},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label><span className="text-xs text-silkscreen-3">Match this to the pedal’s receive channel. Choices apply to new cues; existing cues keep their saved channel and values.</span></>}
    </div>
    {profile&&<><details><summary className="cursor-pointer text-sm">Pedal setup and MIDI mapping</summary><p className="py-2 text-sm text-silkscreen-3 whitespace-pre-wrap">{profile.notes}</p></details><div className="flex flex-wrap items-center gap-3">
      <input aria-label="Find pedal command" className={field} placeholder="Find memory, bypass, loop…" value={query} onChange={e=>setQuery(e.target.value)} />
      <label>Command <select aria-label="Pedal command preset" className={field+' max-w-full'} value={actionId} onChange={e=>chooseAction(e.target.value)}><option value="">Choose a command…</option>{profile.actions.filter(a=>a.id===actionId||a.label.toLowerCase().includes(query.toLowerCase())).map(a=><option key={a.id} value={a.id}>{a.label}{a.assignment?' · assign CC':''}</option>)}</select></label>
      {action?.assignment&&<label>Assigned CC <input aria-label="Assigned pedal CC" className={field+' w-20'} type="number" min="1" max="95" placeholder="CC" value={assignedCC} onChange={e=>{setAssignedCC(e.target.value);const n=Number(e.target.value);if((n>=1&&n<=31)||(n>=64&&n<=95)){try{library.setAssignment(pedal,action.id,n);}catch(err){setError(String(err));}}}} /></label>}
      {action?.value&&<label>{action.value.label} <input aria-label="Pedal command value" className={field+' w-24'} type="number" min={action.value.min} max={action.value.max} value={value} onChange={e=>setValue(e.target.valueAsNumber)} /></label>}
      <Button disabled={!action} onClick={()=>run(false)}>Add pedal command</Button><Button variant="outline" disabled={!action||!canTest} onClick={()=>run(true)}>Send pedal command now</Button>
    </div>{action?.description&&<p className="text-sm text-silkscreen-3">{action.description}</p>}<p className="text-xs text-silkscreen-3">Reference: {profile.id.startsWith('openmidi-') ? 'OpenMIDI community data (Apache-2.0)' : profile.source}. Verify your pedal’s assignments and firmware before a performance.</p></>}
    <OpenMidiBrowser onImport={profile=>importText(JSON.stringify(profile))} />
    <details><summary className="cursor-pointer text-sm">Add or share pedal definitions</summary><div className="mt-3 space-y-3">
      <h4 className="font-semibold">Create a custom pedal command</h4>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input aria-label="Custom pedal name" className={field} placeholder="Pedal name" value={customName} onChange={e=>setCustomName(e.target.value)} />
        <input aria-label="Custom command label" className={field} placeholder="e.g. Enable chorus" value={customLabel} onChange={e=>setCustomLabel(e.target.value)} />
        <input aria-label="Custom command reference" className={field} placeholder="Manual / page / firmware" value={customSource} onChange={e=>setCustomSource(e.target.value)} />
        <select aria-label="Custom command type" className={field} value={customType} onChange={e=>setCustomType(e.target.value)}><option value="pc">Program Change</option><option value="cc">Control Change</option></select>
        <label>{customType==='pc'?'Program':'CC number'} <input aria-label="Custom command number" className={field+' w-20'} type="number" min="0" max="127" value={customNumber} onChange={e=>setCustomNumber(e.target.valueAsNumber)} /></label>
        {customType==='cc'&&<label>Value <input aria-label="Custom CC value" className={field+' w-20'} type="number" min="0" max="127" value={customValue} onChange={e=>setCustomValue(e.target.valueAsNumber)} /></label>}
        <Button onClick={saveNamedCommand}>Save named custom command</Button>
      </div><p className="text-xs text-silkscreen-3">Use numbers from the pedal manual. Reuse the same pedal name to add more commands; the same command label updates that command. Saving a definition does not send MIDI.</p>
      <p className="text-sm text-silkscreen-3">Import a version 1 JSON profile, or edit the template below and save it. Profiles and channel/CC assignments stay on this computer; exported song charts retain the actual MIDI commands and labels.</p>
      <div className="flex flex-wrap gap-3"><label className="cursor-pointer underline">Import pedal JSON<input aria-label="Import pedal JSON" type="file" accept=".json,application/json" hidden onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>500000)setError('Pedal definition is too large (maximum 500 KB).');else void file.text().then(importText).catch(err=>setError(String(err)));}e.target.value='';}} /></label><Button variant="outline" onClick={()=>exportText(JSON.stringify(CUSTOM_PEDAL_TEMPLATE,null,2),'midi-pedal-template.json')}>Download template</Button>{profile&&<Button variant="outline" onClick={()=>exportText(JSON.stringify(profile,null,2),profile.id+'.json')}>Export selected pedal</Button>}</div>
      <textarea aria-label="Custom pedal definition" className={field+' min-h-56 w-full font-mono text-xs'} value={definition} onChange={e=>setDefinition(e.target.value)} /><Button onClick={()=>importText(definition)}>Save custom pedal</Button>
    </div></details>
    {error&&<p role="alert" className="text-red-400">{error}</p>}
  </div>;
}
