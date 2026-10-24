import { create } from 'zustand';
export interface MidiTimingEvent { label:string; intended:number; queued:number; lateMs:number; bytes:number[]; byteCount?:number }
const empty=()=>({queued:0,late:0,maxLateMs:0,failures:0,lastFailure:'',recent:[] as MidiTimingEvent[]});
export const useMidiDiagnostics=create<ReturnType<typeof empty>&{record:(event:MidiTimingEvent)=>void;fault:(error:string)=>void;reset:()=>void}>((set)=>({
  ...empty(),
  record(event){set(s=>({queued:s.queued+1,late:s.late+(event.lateMs>5?1:0),maxLateMs:Math.max(s.maxLateMs,event.lateMs),recent:event.bytes[0]===248?s.recent:[{...event,bytes:event.bytes.slice(0,32),byteCount:event.bytes.length},...s.recent].slice(0,30)}));},
  fault(error){set(s=>({failures:s.failures+1,lastFailure:error}));},
  reset(){set(empty());},
}));
