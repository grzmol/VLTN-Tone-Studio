import { expect, it } from 'vitest';
import { parseChart } from './chart';
import { midiPreflight } from './midi-preflight';
const options={duration:10,clock:false,pedals:[],outputName:'Test MIDI'};
it('identifies past-end cues and missing note-offs, accepting velocity-zero note releases',()=>{
  const report=midiPreflight(parseChart('[00:00] {midi:note 2 60 100}\n[00:01] {midi:note 2 60 0}\n[00:02] {midi:note 3 61 100}\n[00:11] {midi:off 3 61 0}'),options);
  expect(report.issues.map(i=>i.code)).toEqual(['past-end','note-off']);
  expect(report.channels).toEqual([[2,2],[3,2]]);
});
it('reports simultaneous conflicts/duplicates without rewriting intentional command order',()=>{
  const cues=parseChart('[00:00] {midi:cc 1 0 0} {midi:pc 1 1} {midi:pc 1 2} {midi:cc 1 12 5} {midi:cc 1 12 5}');
  const before=JSON.stringify(cues),report=midiPreflight(cues,options);
  expect(report.issues.map(i=>i.code)).toEqual(['conflict','duplicate']);expect(JSON.stringify(cues)).toBe(before);
});
it('finds configured pedal-channel collisions, saved-channel mismatches and automatic tempo conflicts',()=>{
  const cues=parseChart('[00:00] {label:Pedal A: recall} {midi:pc 1 1}\n[00:01] {label:Pedal B: recall} {midi:pc 2 1}\n[00:02] {midi:cc 1 74 90}');
  const report=midiPreflight(cues,{...options,tempoChannel:1,pedals:[{name:'Pedal A',channel:1},{name:'Pedal B',channel:1}]});
  expect(report.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['channel-collision','saved-channel','tempo-channel','tempo-conflict']));
});
it('warns about dense wire traffic and known GP-180 continuous clock limitations',()=>{
  const cues=parseChart('[00:00] '+Array.from({length:30},(_,i)=>`{midi:cc 1 ${i} 127}`).join(' '));
  expect(midiPreflight(cues,{...options,clock:true,outputName:'Bluetooth GP-180'}).issues.map(i=>i.code)).toEqual(expect.arrayContaining(['burst','clock']));
});
it('does not invent warnings for a simple complete chart',()=>{
  expect(midiPreflight(parseChart('[00:00] {midi:pc 1 1}\n[00:01] {midi:note 2 60 100}\n[00:02] {midi:off 2 60 0}'),options).issues).toEqual([]);
});

it.each(['GP-150','GP-180'])('recognizes %s for shared tempo and clock advice', model => {
  const cues=parseChart(`[00:00] {label:Valeton ${model}: Recall memory 001} {midi:pc 16 0}`);
  const result=midiPreflight(cues,{...options,tempoChannel:16,clock:true,outputName:model,pedals:[{name:`Valeton ${model}`,channel:16}]});
  expect(result.issues.some(i=>i.code==='tempo-channel')).toBe(false);
  expect(result.issues.some(i=>i.code==='clock')).toBe(true);
});
