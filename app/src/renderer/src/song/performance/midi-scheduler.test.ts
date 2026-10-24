import { expect, it } from 'vitest';
import { MidiSchedule, type SchedulerConfig, type SchedulerReply } from './midi-scheduler';
import { parseChart } from './chart';
const config=(patch:Partial<SchedulerConfig>={}):SchedulerConfig=>({cues:parseChart('[00:00] {midi:pc 1 1}\n[00:01] {midi:cc 2 12 127}'),position:0,duration:2,origin:1000,bpm:120,clock:false,tempo:null,...patch});
function fixture(patch:Partial<SchedulerConfig>={}) {const replies:SchedulerReply[]=[];const schedule=new MidiSchedule(config(patch),1000,r=>replies.push(r));return {schedule,replies,messages:()=>replies.flatMap(r=>r.type==='batch'?r.messages:[])};}
it('queues each cue once on the fixed grid, preserves message order and applies start tempo after patch recall',()=>{
  const f=fixture({tempo:[[191,73,0],[191,74,120]]});
  f.schedule.tick(1000);f.schedule.sync(.98,1980,1980);f.schedule.tick(1980); // long poll deliberately faults
  expect(f.messages().map(m=>m.bytes)).toEqual([[192,1],[191,73,0],[191,74,120]]);
  expect(f.replies.at(-1)?.type).toBe('fault');
});
it('fills on-time cues without duplication and never emits after stop',()=>{
  const f=fixture();
  for(let t=1000;t<=2020;t+=20){f.schedule.sync((t-1000)/1000,t,t);f.schedule.tick(t);}
  expect(f.messages().map(m=>[m.bytes,m.due])).toEqual([[[192,1],1000],[[177,12,127],2000]]);
  f.schedule.stop();f.schedule.tick(2040);expect(f.messages()).toHaveLength(2);
});
it('does not replay cues before a seek or beyond the song end',()=>{
  const f=fixture({position:.5,origin:500,duration:.9});f.schedule.tick(1000);
  expect(f.messages()).toEqual([]);
});
it.each([90,120,180])('keeps 24 PPQN at %i BPM despite checkpoint jitter',bpm=>{
  const f=fixture({bpm,clock:true,cues:[],duration:10});
  for(let t=1000;t<11000;t+=20){f.schedule.sync((t-1000)/1000+.002,t,t);f.schedule.tick(t);}
  const pulses=f.messages().filter(m=>m.bytes[0]===248);
  expect(pulses).toHaveLength(bpm/60*24*10);
  pulses.forEach((p,i)=>expect(p.due).toBeCloseTo(1000+i*60000/bpm/24,6));
});
it('faults only once if audio freezes or checkpoints disappear and never produces catch-up commands',()=>{
  const f=fixture({cues:parseChart('[00:00.50] {midi:pc 1 2}')});
  for(let t=1000;t<=1300;t+=20){f.schedule.sync(0,t,t);f.schedule.tick(t);}
  f.schedule.tick(2000);expect(f.replies).toHaveLength(1);expect(f.replies[0].type).toBe('fault');
  const g=fixture({cues:[]});for(let t=1000;t<=1300;t+=20)g.schedule.tick(t);
  expect(g.replies.at(-1)?.type).toBe('fault');
});
it('rejects an old startup anchor instead of applying late start tempo',()=>{
  const replies:SchedulerReply[]=[];
  const schedule=new MidiSchedule(config({cues:[],tempo:[[191,74,120]]}),1500,r=>replies.push(r));schedule.tick(1500);
  expect(replies).toHaveLength(1);expect(replies[0].type).toBe('fault');
});
