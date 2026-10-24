import { MidiSchedule, type SchedulerRequest } from './midi-scheduler';
let schedule:MidiSchedule|null=null,timer:ReturnType<typeof setInterval>|undefined;
const now=()=>performance.timeOrigin+performance.now();
self.onmessage=(event:MessageEvent<SchedulerRequest>)=>{
  const request=event.data;
  if(request.type==='stop' || request.type==='start') { if(timer!==undefined)clearInterval(timer);schedule?.stop();schedule=null; }
  if(request.type==='start') {
    schedule=new MidiSchedule(request.config,now(),reply=>self.postMessage(reply));
    self.postMessage({type:'started'});
    schedule.tick(now());timer=setInterval(()=>schedule?.tick(now()),20);
  } else if(request.type==='sync') {schedule?.sync(request.position,request.at,now());self.postMessage({type:'heartbeat'});}
};
self.postMessage({type:'ready'});
