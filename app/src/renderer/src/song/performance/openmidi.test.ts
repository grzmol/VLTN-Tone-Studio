import { expect, it, vi } from 'vitest';
import { convertOpenMidi, openMidiDevices, loadOpenMidi, type OpenMidiDevice } from './openmidi';
import { actionCommands, parsePedalProfile } from './pedal-profiles';
const device:OpenMidiDevice={brand:'strymon',model:'test',name:'Strymon Test',data:{midi_channel:{instructions:'Set receive channel.'},pc:{description:'Consult preset mapping.'},cc:[
  {name:'Bypass',value:'102',min:'0',max:'0',type:'fixed'},
  {name:'Mix',value:14,min:0,max:127,description:'Adjust mix.'},
  {name:'Incomplete',value:15},
  {name:'Bad range',value:16,min:127,max:0},
  {name:'Out of range',value:128,min:0,max:127},
]}};
it('imports fixed/ranged CCs, keeps licensing, and skips incomplete entries',()=>{
  const {profile,skipped}=convertOpenMidi(device);
  expect(skipped).toBe(3);expect(profile.actions).toHaveLength(2);
  expect(actionCommands(profile.actions[0],3)).toEqual(['cc 3 102 0']);
  expect(actionCommands(profile.actions[1],3,64)).toEqual(['cc 3 14 64']);
  expect(profile.actions.every(a=>a.commands[0].startsWith('cc '))).toBe(true);
  expect(profile.license?.text).toContain('Apache License');
  expect(parsePedalProfile(JSON.stringify(profile)).license).toEqual(profile.license);
});
it('uses catalogue display names and ignores missing models',()=>{
  const result=openMidiDevices({brands:[{name:'Strymon',value:'strymon',models:[{name:'TimeLine',value:'test'},{name:'Missing',value:'none'}]}]}, {strymon:{test:device.data}});
  expect(result.map(d=>d.name)).toEqual(['Strymon TimeLine']);
});
it('does not guess controllers when a device has no valid entries',()=>{
  expect(()=>convertOpenMidi({...device,data:{cc:[{name:'Unknown',value:'assign',min:0,max:127}]}})).toThrow('No values were guessed');
});
it('loads pinned data without credentials and caches the successful download',async()=>{
  const fetch=vi.fn(async(url:string)=>({ok:true,text:async()=>JSON.stringify(url.endsWith('mapping.json')?{brands:[{name:'Strymon',value:'strymon',models:[{name:'Test',value:'test'}]}]}:{strymon:{test:device.data}})}));
  vi.stubGlobal('fetch',fetch);
  try{expect(await loadOpenMidi()).toHaveLength(1);await loadOpenMidi();expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[0][0]).toContain('/839e8612d311a88beb0041dd704bdcecfc13e26e/');}finally{vi.unstubAllGlobals();}
});
