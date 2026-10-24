import { midiCommand } from './chart';

export interface MidiAction {
  id: string; label: string; commands: string[]; description?: string;
  value?: { label: string; min: number; max: number; default: number };
  assignment?: string;
}
export interface PedalProfile { version: 1; id: string; name: string; source: string; notes: string; actions: MidiAction[]; license?: { name: string; url: string; text: string } }
const cc = (id: string, label: string, number: number, value: number): MidiAction => ({ id, label, commands: [`cc $channel ${number} ${value}`] });
const continuous = (id: string, label: string, number: number, max = 127): MidiAction => ({ id, label, commands: [`cc $channel ${number} $value`], value: { label: 'MIDI value', min: 0, max, default: Math.min(64,max) } });
const toggle = (id: string, label: string, number: number, on = 127): MidiAction[] => [cc(id+'-on', 'Enable '+label, number, on), cc(id+'-off', 'Disable '+label, number, 0)];
function memories(count: number, banked: boolean, label: (n:number) => string = n => String(n+1).padStart(3,'0')): MidiAction[] {
  return Array.from({length:count}, (_,n) => ({ id: `memory-${n+1}`, label: `Recall memory ${label(n)}`, commands: [...(banked ? [`cc $channel 0 ${Math.floor(n/128)}`] : []), `pc $channel ${n%128}`] }));
}
function assigned(id: string, label: string, setting: string, switchControl = false): MidiAction {
  return { id, label, assignment: setting, description: `On the pedal, assign ${setting} to the same CC number selected here. This is a configurable control, not a fixed CC mapping.${switchControl ? ' Press and release values are sent in order; test the configured switch behaviour on your pedal.' : ''}`, commands: switchControl ? ['cc $channel $cc 127','cc $channel $cc 0'] : ['cc $channel $cc $value'], ...(!switchControl ? { value: { label: 'MIDI value', min: 0, max: 127, default: 64 } } : {}) };
}

export const PEDAL_PROFILES: PedalProfile[] = [
  { version: 1, id:'strymon-timeline', name:'Strymon TimeLine', source:'TimeLine User Manual Rev H, pp. 21, 25–26', notes:'Set MIDI CH to the selected channel and enable MIDI CC / MIDI Patch Change. MIDI bank selection is included with every memory recall. Memory labels are bank A/B; saved sound names are not read from the pedal.', actions:[
    ...memories(200,true,n => `${String(Math.floor(n/2)).padStart(2,'0')}${n%2 ? 'B':'A'}`),
    cc('engage','Engage delay',102,127),cc('bypass','Bypass delay',102,0),
    ...toggle('infinite','infinite repeats',97),cc('tap','Tap tempo',93,127),cc('phase','Reset phase',125,127),
    ...[['record','Record loop',87],['play','Play loop',86],['stop','Stop loop',85],['reverse','Toggle loop reverse',94],['speed','Toggle half/full loop speed',95],['undo','Undo to initial loop',89],['redo','Redo loop',90],['placement','Toggle loop pre/post',96]].map(([id,label,n])=>cc(String(id),String(label),Number(n),127)),
    ...toggle('clock','MIDI clock reception',63,1),...toggle('persist','delay trails (Persist)',22,1),...toggle('expression','expression control',60,1),
    ...[['time','Delay time',3,127],['repeats','Repeats',9,127],['mix','Delay mix',14,127],['filter','Filter',15,127],['grit','Grit',16,127],['speed-knob','Modulation speed',17,127],['depth','Modulation depth',18,127],['type','Delay type index',19,11],['division','Tap division index',21,4],['boost','Boost',23,60],['looper-level','Looper level',98,127],['expression-value','Expression position',100,127]].map(([id,label,n,max])=>continuous(String(id),String(label),Number(n),Number(max))),
    ...[['smear','Smear',38,18],['highpass','High pass',47,20],['tape-speed','dTAPE speed index',58,1],['tape-low','dTAPE low end',59,20],['bucket-range','dBUCKET range index',45,1],['dynamics','DIGITAL repeat dynamics',56,1],['dual-time','DUAL time 2',32,26],['dual-repeats','DUAL repeats 2',34,18],['dual-mix','DUAL mix 2',33,18],['dual-config','DUAL configuration index',36,1],['pattern','PATTERN index',39,15],['rise','SWELL rise time',44,27],['trem-speed','TREM speed',61,34],['trem-depth','TREM depth',57,18],['trem-lfo','TREM LFO index',29,4],['filter-q','FILTER Q',40,11],['filter-lfo','FILTER LFO index',28,10],['filter-depth','FILTER depth',41,18],['filter-speed','FILTER speed',42,34],['filter-location','FILTER location index',43,1],['lofi-mix','LO-FI mix',51,20],['lofi-vinyl','LO-FI vinyl',52,18],['lofi-rate','LO-FI sample rate',49,20],['lofi-bits','LO-FI bit depth',50,20],['lofi-filter','LO-FI filter index',53,8],['ice-interval','ICE interval index',30,29],['ice-slice','ICE slice index',46,2],['ice-blend','ICE blend',25,20],['duck-sense','DUCK sensitivity',37,17],['duck-release','DUCK release',55,20],['duck-feedback','DUCK feedback index',54,1]].map(([id,label,n,max])=>continuous(String(id),String(label),Number(n),Number(max))),
    {id:'footswitch-a',label:'Press and release A footswitch',commands:['cc $channel 80 0','cc $channel 80 127']},
    {id:'footswitch-b',label:'Press and release B footswitch',commands:['cc $channel 82 0','cc $channel 82 127']},
  ] },
  { version:1, id:'boss-rc10r', name:'BOSS RC-10R', source:'RC-10R MIDI Implementation v1.00, pp. 2–3; BOSS RC-10R Parameter Guide, pp. 9–11', notes:'Use RX CONTROL CH for memories and assigned controls. Memory numbers 1–99 correspond to wire PC 0–98; bank select is ignored. Set each chosen CC assignment on the pedal. RX NOTE CH is a separate channel for rhythm notes/kit changes, not this control profile.', actions:[
    ...memories(99,false),
    ...[['rhythm-start','Start rhythm','RHY START CC'],['rhythm-stop','Stop rhythm','RHY STOP CC'],['rhythm-division','Switch rhythm PTN1 / PTN2','RHY DIVISION CC'],['fill','Insert rhythm fill','RHY FILLIN CC'],['break','Rhythm break','RHY BREAK CC'],['loop-start','Start looper','LOOP START CC'],['loop-stop','Stop looper','LOOP STOP CC'],['undo','Loop undo / redo','LOOP UnRedo CC'],['track1-start','Start track 1','TRK1 START CC'],['track1-stop','Stop track 1','TRK1 STOP CC'],['track1-undo','Track 1 undo / redo','TRK1 UnRedo CC'],['track2-start','Start track 2','TRK2 START CC'],['track2-stop','Stop track 2','TRK2 STOP CC'],['track2-undo','Track 2 undo / redo','TRK2 UnRedo CC'],['all-break','Break rhythm and looper','ALL BREAK CC']].map(([id,label,setting])=>assigned(id,label,setting,true)),
    ...[['rhythm-level','Set rhythm level','RHY LEVEL CC'],['loop-level','Set loop level','LOOP LEVEL CC'],['total-level','Set total level','TOTAL LEVEL CC']].map(([id,label,setting])=>assigned(id,label,setting)),
  ] },
  { version:1, id:'boss-ir200', name:'BOSS IR-200', source:'IR-200 Owner’s Manual eng02, pp. 20–21', notes:'Set Rx CH and enable PC IN / CC IN. Memory recalls assume an identity MIDI PC MAP: PC#1 → memory 1. A customised PC map can recall a different memory. CC numbers must match the pedal’s MIDI settings.', actions:[
    ...memories(128,false),
    ...[['gain','Set amp gain','GAIN CC'],['level','Set amp level','LEVEL CC'],['solo-level','Set solo level','SOLO LV CC'],['expression','Set expression position','EXP CC'],['solo','Press solo switch','SOLO SW CC'],['down','Press memory down switch','DOWN SW CC'],['up','Press memory up switch','UP SW CC'],['ctl1','Press CTL 1','CTL 1 CC'],['ctl2','Press CTL 2','CTL 2 CC'],['bypass','Press bypass control','BYPASS ON/OFF CC']].map(([id,label,setting],i)=>assigned(id,label,setting,i>=4)),
  ] },
  { version:1, id:'boss-sy200', name:'BOSS SY-200', source:'SY-200 Owner’s Manual eng03, pp. 13–14', notes:'Set RX CH and enable PC IN / CC IN. Memory recalls assume an identity MIDI PC MAP; a custom map changes the recalled memory (or switches the effect off). Assign the CC number on the pedal before using a named control. Use SYNC AUTO for incoming MIDI clock.', actions:[
    ...memories(128,false),
    ...[['param1','Set parameter 1','PARAM1 CC'],['param2','Set parameter 2','PARAM2 CC'],['param3','Set parameter 3','PARAM3 CC'],['direct','Set direct level','D. LEVEL CC'],['effect-level','Set effect level','E. LEVEL CC'],['expression','Set expression position','EXP CC'],['switch','Press ON/OFF switch','ON/OFF SW CC'],['ctl1','Press CTL 1','CTL1 CC'],['ctl2','Press CTL 2','CTL2 CC'],['ctl3','Press CTL 3','CTL3 CC'],['effect','Effect control value','EFFECT CC']].map(([id,label,setting],i)=>assigned(id,label,setting,i>=6 && i<=9)),
  ] },
  { version:1, id:'valeton-gp180', name:'Valeton GP-180', source:'GP-180 User Manual firmware v1.0.0, printed pp. 75–77 (PDF pp. 78–80)', notes:'Configure Bluetooth MIDI input and its receive channel on the GP-180. These are standard performance MIDI commands, independent of the USB editor write lock. Forwarding to other pedals still depends on the hardware’s routing. Commands without documented on/off semantics are labelled as control values.', actions:[
    ...memories(200,true),
    ...['NR','PRE','WAH','DST','N→S','AMP','CAB','EQ','MOD','DLY','RVB','VOL'].flatMap((name,i)=>toggle('module-'+i,name+' module',48+i)),
    cc('patch-mode','Switch to Patch mode',28,0),cc('stomp-mode','Switch to Stomp mode',28,127),cc('previous','Previous patch',24,127),cc('next','Next patch',25,127),
    cc('loop-play','Play loop',64,127),cc('loop-stop','Stop loop',64,0),cc('loop-front','Place looper at front',68,127),cc('loop-rear','Place looper at rear',68,0),cc('drums-play','Start drum machine',93,127),cc('drums-stop','Stop drum machine',93,0),cc('tap','Tap tempo',75,127),
    { id:'tempo',label:'Set tempo (BPM)',commands:['cc $channel 73 $msb','cc $channel 74 $lsb'],value:{label:'BPM',min:40,max:300,default:120} },
    ...Array.from({length:129},(_,n)=>({id:`drum-pattern-${n+1}`,label:`Select drum pattern ${String(n+1).padStart(3,'0')}`,commands:[`cc $channel 94 ${Math.floor(n/128)}`,`cc $channel 95 ${n%128}`]})),
    ...[17,19,21].flatMap((n,i)=>[cc(`quick-${i}-down`,`Decrease quick access knob ${i+1} by one step`,n,0),cc(`quick-${i}-up`,`Increase quick access knob ${i+1} by one step`,n,127)]),
    ...[['patch-volume','Patch volume',7,100],['expression','Expression parameter',11,100],['exp-switch','EXP A/B control value',13,127],['quick1','Quick access parameter 1',16,100],['quick2','Quick access parameter 2',18,100],['quick3','Quick access parameter 3',20,100],['record-level','Loop recording level',66,100],['play-level','Loop playback level',67,100],['drums-level','Drum machine level',96,100],['tuner','Tuner control value',60,127],['loop-menu','Looper control value',61,127],['loop-record','Looper record control value',62,127],['auto-record','Looper auto-record control value',63,127],['delete-loop','Delete loop control value',65,127],['ctrl-a','CTRL A control value',69,127],['ctrl-b','CTRL B control value',70,127],['ctrl-c','CTRL C control value',71,127],['analog','Analog bypass control value',115,127],['dsp','DSP bypass control value',116,127]].map(([id,label,n,max])=>continuous(String(id),String(label),Number(n),Number(max))),
  ] },
];

// Keep the existing GP-180 ID and labels so saved channels and chart cues remain valid.
// Both models use the same performance MIDI implementation.
const gp180Profile = PEDAL_PROFILES.find(profile => profile.id === 'valeton-gp180')!;
PEDAL_PROFILES.push({ ...gp180Profile, id: 'valeton-gp150', name: 'Valeton GP-150', notes: gp180Profile.notes.replaceAll('GP-180', 'GP-150') + ' Shared GP-150/GP-180 command set; physical validation to date used GP-180.' });

export function actionCommands(action: MidiAction, channel: number, value = action.value?.default ?? 0, assignedCC?: number): string[] {
  if (!Number.isInteger(channel) || channel<1 || channel>16) throw new Error('Choose a MIDI channel from 1 to 16.');
  if (action.value && (!Number.isInteger(value) || value<action.value.min || value>action.value.max)) throw new Error(`Choose ${action.value.label} from ${action.value.min} to ${action.value.max}.`);
  if (action.assignment && (!Number.isInteger(assignedCC) || !((assignedCC!>=1 && assignedCC!<=31) || (assignedCC!>=64 && assignedCC!<=95)))) throw new Error('Set the assigned CC number to 1–31 or 64–95, matching the pedal.');
  return action.commands.map(command => {
    const text = command.replace(/\$(channel|value|cc|msb|lsb)\b/g, (_,key:string) => String(({ channel, value, cc: assignedCC, msb: Math.floor(value/128), lsb: value%128 } as Record<string,number|undefined>)[key]));
    midiCommand(text); return text;
  });
}

/** Profiles are inert data, bounded and fully validated before storage or use. */
export function parsePedalProfile(text: string): PedalProfile {
  if (text.length>500_000) throw new Error('Pedal definition is too large (maximum 500 KB).');
  const p = JSON.parse(text) as PedalProfile;
  const string = (s: unknown, max:number) => typeof s==='string' && s.trim().length>0 && s.length<=max;
  if (!p || p.version!==1 || !string(p.id,80) || !/^[a-z0-9-]+$/.test(p.id) || ['constructor','prototype','__proto__'].includes(p.id) || !string(p.name,100) || !string(p.source,500) || typeof p.notes!=='string' || p.notes.length>4000 || !Array.isArray(p.actions) || !p.actions.length || p.actions.length>1000) throw new Error('Invalid pedal definition. Use the version 1 template.');
  const ids = new Set<string>();
  if (p.license && (!string(p.license.name,100) || !string(p.license.url,500) || !string(p.license.text,20000))) throw new Error('Invalid profile license metadata.');
  for (const a of p.actions) {
    if (!a || !string(a.id,100) || ids.has(a.id) || !string(a.label,160) || !Array.isArray(a.commands) || !a.commands.length || a.commands.length>16 || a.commands.some(c=>typeof c!=='string'||c.length>300) || (a.assignment!==undefined && !string(a.assignment,300)) || (a.description!==undefined && !string(a.description,1000))) throw new Error('Invalid or duplicate action in pedal definition.');
    ids.add(a.id);
    if (a.value && (!string(a.value.label,80) || ![a.value.min,a.value.max,a.value.default].every(Number.isInteger) || a.value.min<0 || a.value.max>16383 || a.value.min>a.value.max || a.value.default<a.value.min || a.value.default>a.value.max)) throw new Error('Invalid action value range.');
    for (const c of a.commands) {
      if (c.includes('$cc') && !a.assignment) throw new Error('An assigned CC requires a named pedal setting.');
      if (/\$(value|msb|lsb)\b/.test(c) && !a.value) throw new Error('A variable command requires a value range.');
    }
    for (const value of a.value ? [a.value.min,a.value.max,a.value.default] : [0]) actionCommands(a,16,value,a.assignment ? 95 : undefined);
  }
  return p;
}

export const CUSTOM_PEDAL_TEMPLATE: PedalProfile = { version:1,id:'my-midi-pedal',name:'My MIDI pedal',source:'Your pedal manual and page number',notes:'Set the pedal receive channel to match the channel selected in Performance.',actions:[{id:'memory-1',label:'Recall memory 1',commands:['pc $channel 0']},{id:'effect-on',label:'Enable effect (example CC — replace from manual)',commands:['cc $channel 20 127']},{id:'level',label:'Set level (example CC — replace from manual)',commands:['cc $channel 21 $value'],value:{label:'MIDI value',min:0,max:127,default:64}}] };
