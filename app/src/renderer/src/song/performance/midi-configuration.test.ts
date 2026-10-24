import { afterEach, expect, it } from 'vitest';
import { MIDI_CONFIG_KEY, readMidiConfiguration, rememberedPort, useMidiConfiguration } from './midi-configuration';
afterEach(()=>{localStorage.clear();useMidiConfiguration.setState(readMidiConfiguration());});
it('persists configuration without restoring session arming or accepting invalid channels',()=>{
  useMidiConfiguration.getState().update({preset:'gp180-usb',tempoOnStart:true,tempoChannel:16,showCommands:false,output:{id:'a',name:'GP-180',transport:'system'}});
  expect(readMidiConfiguration()).toMatchObject({preset:'gp180-usb',tempoOnStart:true,tempoChannel:16,showCommands:false,output:{id:'a'}});
  localStorage.setItem(MIDI_CONFIG_KEY,JSON.stringify({tempoChannel:19,armed:true,output:{id:2}}));
  expect(readMidiConfiguration()).toMatchObject({tempoChannel:16,output:null});
  expect(readMidiConfiguration()).not.toHaveProperty('armed');
});
it('restores exact IDs or unique matching names, never an ambiguous replacement',()=>{
  const saved={id:'old',name:'GP-180',transport:'system' as const};
  const port={id:'new',name:'GP-180',state:'connected'};
  expect(rememberedPort([port],saved)).toBe(port);
  expect(rememberedPort([port,{...port,id:'other'}],saved)).toBeUndefined();
  expect(rememberedPort([{...port,state:'disconnected'}],saved)).toBeUndefined();
});
