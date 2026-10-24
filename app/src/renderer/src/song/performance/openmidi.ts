import licenseText from './openmidi-LICENSE.txt?raw';
import { parsePedalProfile, type MidiAction, type PedalProfile } from './pedal-profiles';

export const OPENMIDI_REVISION = '839e8612d311a88beb0041dd704bdcecfc13e26e';
const base = `https://raw.githubusercontent.com/Morningstar-Engineering/openmidi/${OPENMIDI_REVISION}/data`;
export interface OpenMidiDevice { brand: string; model: string; name: string; data: Record<string, unknown> }
const record = (v: unknown): v is Record<string,unknown> => v!==null && typeof v==='object' && !Array.isArray(v);
const text = (v: unknown) => typeof v==='string' ? v.trim() : '';
const int = (v: unknown): number => typeof v==='number' ? v : typeof v==='string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
export function openMidiDevices(mapping:unknown, data:unknown): OpenMidiDevice[] {
  if(!record(mapping)||!Array.isArray(mapping.brands)||!record(data))throw new Error('Unrecognised OpenMIDI catalogue format.');
  const devices:OpenMidiDevice[]=[];
  for(const brand of mapping.brands){
    if(!record(brand)||!Array.isArray(brand.models)||typeof brand.value!=='string'||!Object.hasOwn(data,brand.value))continue;
    const models=data[brand.value]; if(!record(models))continue;
    for(const model of brand.models){
      if(!record(model)||typeof model.value!=='string'||!Object.hasOwn(models,model.value)||!record(models[model.value]))continue;
      devices.push({brand:brand.value,model:model.value,name:`${text(brand.name)||brand.value} ${text(model.name)||model.value}`.slice(0,100),data:models[model.value] as Record<string,unknown>});
    }
  }
  return devices.sort((a,b)=>a.name.localeCompare(b.name));
}
export function convertOpenMidi(device:OpenMidiDevice): {profile:PedalProfile; skipped:number} {
  if(!Array.isArray(device.data.cc))throw new Error('This entry has no CC commands. Use its documentation with a custom profile.');
  const actions:MidiAction[]=[]; let skipped=0;
  for(const [i,raw] of device.data.cc.entries()){
    if(!record(raw)){skipped++;continue;}
    const controller=int(raw.value),min=int(raw.min),max=int(raw.max),name=text(raw.name);
    if(!name||![controller,min,max].every(n=>Number.isInteger(n)&&n>=0&&n<=127)||min>max||actions.length>=1000){skipped++;continue;}
    actions.push({id:`cc-${controller}-${i}`,label:name.slice(0,160),commands:[`cc $channel ${controller} ${min===max?min:'$value'}`],...(text(raw.description)?{description:text(raw.description).slice(0,1000)}:{}),...(min!==max?{value:{label:'MIDI value',min,max,default:min}}:{})});
  }
  if(!actions.length)throw new Error('This entry has no CC commands with explicit valid numbers and ranges. No values were guessed.');
  const instructions=record(device.data.midi_channel)?text(device.data.midi_channel.instructions):'';
  const mapping=record(device.data.midi_mapping)?text(device.data.midi_mapping.description):text(device.data.midi_mapping);
  const pc=record(device.data.pc)?text(device.data.pc.description):'';
  const slug=`${device.brand}-${device.model}`.toLowerCase().replace(/[^a-z0-9-]/g,'-');
  let hash=2166136261;for(const c of slug)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  const profile:PedalProfile={version:1,id:`openmidi-${slug.slice(0,58)}-${(hash>>>0).toString(16)}`,name:`OpenMIDI · ${device.name}`.slice(0,100),source:`Morningstar Engineering / OpenMIDI (Apache-2.0), revision ${OPENMIDI_REVISION}: https://github.com/Morningstar-Engineering/openmidi`,notes:[
    'Community CC definitions. Verify command numbers, assignments and firmware against your pedal. Suggested/default mappings may need configuration on the physical device. Only explicit CC ranges are imported; PC/bank sequences are not inferred.',
    instructions,mapping,pc?`Program change reference (not imported as actions): ${pc}`:'',skipped?`${skipped} incomplete/unsupported entries were skipped.`:'',
  ].filter(Boolean).join('\n').slice(0,4000),actions,license:{name:'Apache-2.0',url:`https://github.com/Morningstar-Engineering/openmidi/blob/${OPENMIDI_REVISION}/LICENSE`,text:licenseText}};
  return {profile:parsePedalProfile(JSON.stringify(profile)),skipped};
}
let cached:Promise<OpenMidiDevice[]>|undefined;
export function loadOpenMidi():Promise<OpenMidiDevice[]> {
  if(!cached)cached=Promise.all(['mapping.json','all.json'].map(async file=>{
    const response=await fetch(`${base}/${file}`,{credentials:'omit',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`OpenMIDI download failed (${response.status}).`);
    const body=await response.text();if(body.length>10_000_000)throw new Error('OpenMIDI download exceeds the supported size.');return JSON.parse(body) as unknown;
  })).then(([mapping,data])=>openMidiDevices(mapping,data)).catch(error=>{cached=undefined;throw error;});
  return cached;
}
