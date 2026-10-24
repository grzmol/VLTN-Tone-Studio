import { expect, it } from 'vitest';
import { useMidiDiagnostics } from './midi-diagnostics';
it('bounds recent cue history without clock flooding and accumulates late dispatches/failures until reset',()=>{
  const state=useMidiDiagnostics.getState();state.reset();
  for(let i=0;i<100;i++)state.record({label:'Cue '+i,intended:0,queued:i,lateMs:i,bytes:[192,i%128]});
  state.record({label:'Clock',intended:100,queued:100,lateMs:0,bytes:[248]});state.fault('Port lost');
  expect(useMidiDiagnostics.getState()).toMatchObject({queued:101,late:94,maxLateMs:99,failures:1,lastFailure:'Port lost'});
  expect(useMidiDiagnostics.getState().recent).toHaveLength(30);expect(useMidiDiagnostics.getState().recent[0].label).toBe('Cue 99');
  state.reset();expect(useMidiDiagnostics.getState()).toMatchObject({queued:0,recent:[],failures:0});
});
