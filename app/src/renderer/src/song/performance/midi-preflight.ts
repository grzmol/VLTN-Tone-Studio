import type { Cue } from './chart';
export interface PreflightOptions { duration:number; tempoChannel?:number; clock:boolean; outputName?:string; pedals:{name:string;channel:number}[] }
export interface PreflightIssue { code:string; text:string }
export function midiPreflight(cues:Cue[],options:PreflightOptions) {
  const issues:PreflightIssue[]=[],channels=new Map<number,number>(),notes=new Map<string,number>();
  const add=(code:string,text:string)=>{if(issues.length<100)issues.push({code,text});};
  const events=cues.filter(c=>c.messages.length).slice().sort((a,b)=>a.time-b.time);
  if(events.length && !options.outputName)add('output','No MIDI output selected. Connect the intended output and explicitly enable Send cues before performing.');
  const referenced=options.pedals.filter(p=>events.some(c=>c.label?.startsWith(p.name+':')));
  const labels=new Map<number,string[]>();
  for(const pedal of referenced) {const names=labels.get(pedal.channel)||[];names.push(pedal.name);labels.set(pedal.channel,names);}
  for(const [channel,names] of labels) if(names.length>1)add('channel-collision',`Configured channel ${channel} is shared by ${names.join(', ')}. Verify physical receive settings.`);
  if(options.tempoChannel && referenced.some(p=>p.channel===options.tempoChannel && !/GP-?(150|180)/i.test(p.name)))add('tempo-channel','Automatic GP-150 / GP-180 tempo shares a configured downstream pedal channel. Its CC73/74 may affect that pedal.');
  if(options.clock && /GP.?(150|180)/i.test(options.outputName||''))add('clock','Continuous app clock failed the GP-180 hardware test. Use one-time tempo with the pedal’s internal clock.');
  let windowStart=0,windowBytes=0,dense=false;
  const conflicts=new Map<string,string>();
  for(let i=0;i<events.length;i++) {
    const cue=events[i];
    if(!Number.isFinite(cue.time)||cue.time<0)add('time','A MIDI cue has an invalid timestamp.');
    if(cue.time>options.duration)add('past-end',`Cue at ${cue.time.toFixed(2)} s is beyond the ${options.duration.toFixed(2)} s audio and will not play.`);
    windowBytes+=cue.messages.reduce((sum,b)=>sum+b.length,0);
    while(events[windowStart].time<cue.time-.02) {windowBytes-=events[windowStart++].messages.reduce((sum,b)=>sum+b.length,0);}
    if(windowBytes>62 && !dense){add('burst','A 20 ms cue window exceeds 62 MIDI bytes. Physical DIN serialization or BLE queueing may delay this burst.');dense=true;}
    for(const bytes of cue.messages) {
      const kind=bytes[0]&240,channel=(bytes[0]&15)+1;
      if(bytes[0]<240)channels.set(channel,(channels.get(channel)||0)+1);
      if(bytes.length>256)add('sysex','A long SysEx command can delay subsequent commands. Rehearse it with the actual device.');
      if(cue.time>options.duration)continue;
      if(kind===144 && bytes[2]>0) {
        if(notes.has(`${channel}:${bytes[1]}`))add('retrigger',`Note ${bytes[1]} on channel ${channel} is retriggered before its previous note-off. Verify the receiver’s behavior.`);
        notes.set(`${channel}:${bytes[1]}`,cue.time);
      }
      if(kind===128 || (kind===144 && bytes[2]===0))notes.delete(`${channel}:${bytes[1]}`);
      if(options.tempoChannel===channel && kind===176 && [73,74].includes(bytes[1]))add('tempo-conflict',`Saved CC${bytes[1]} on channel ${channel} can override automatic song tempo. Verify its value and ordering.`);
      if(kind===192 || (kind===176 && ![0,32].includes(bytes[1]))) {
        const id=`${cue.time}:${channel}:${kind}:${kind===176?bytes[1]:''}`,value=bytes.join(',');
        const previous=conflicts.get(id);
        if(previous)add(previous===value?'duplicate':'conflict',`${previous===value?'Repeated':'Conflicting'} ${kind===192?'program change':'CC'+bytes[1]} on channel ${channel} at ${cue.time.toFixed(2)} s. Verify intentional trigger/order.`);
        conflicts.set(id,value);
      }
      if(cue.label) {
        const pedal=options.pedals.find(p=>cue.label!.startsWith(p.name+':'));
        if(pedal && bytes[0]<240 && pedal.channel!==channel)add('saved-channel',`${pedal.name} cue uses channel ${channel}; its current profile is channel ${pedal.channel}. Existing cue bytes are unchanged.`);
      }
    }
  }
  for(const [note,time] of notes)add('note-off',`Note ${note.split(':')[1]} on channel ${note.split(':')[0]} at ${time.toFixed(2)} s has no later note-off before the audio ends.`);
  return {issues,channels:[...channels].sort((a,b)=>a[0]-b[0]),commands:events.reduce((n,c)=>n+c.messages.length,0)};
}
