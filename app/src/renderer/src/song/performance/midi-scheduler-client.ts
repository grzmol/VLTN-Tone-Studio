import type { ScheduledMessage, SchedulerConfig, SchedulerReply } from './midi-scheduler';
const failedWorkers = new WeakMap<Worker, Error>();
export const midiNow=()=>performance.timeOrigin+performance.now();
/** Warm an idle worker before starting audio, with a bounded startup wait. */
export function prepareMidiScheduler() {
  const worker=new Worker(new URL('./midi-scheduler-worker.ts',import.meta.url),{type:'module'});
  let rejectReady:(error:Error)=>void=()=>{};
  const ready=new Promise<void>((resolve,reject)=>{
    rejectReady=reject;
    const timer=setTimeout(()=>{const error=new Error('MIDI scheduler did not become ready. Reconnect or rearm before playing.');failedWorkers.set(worker,error);worker.terminate();reject(error);},2000);
    worker.onmessage=(event:MessageEvent<SchedulerReply>)=>{if(event.data.type==='ready'){clearTimeout(timer);resolve();}};
    worker.onerror=()=>{clearTimeout(timer);const error=new Error('MIDI scheduling worker failed before playback. Rearm before playing.');failedWorkers.set(worker,error);worker.terminate();reject(error);};
    rejectReady=error=>{clearTimeout(timer);reject(error);};
  });
  void ready.catch(()=>{});
  return {worker, get ready(){const error=failedWorkers.get(worker);return error?Promise.reject(error):ready;},cancel(){const error=new Error('MIDI scheduler preparation cancelled.');failedWorkers.set(worker,error);worker.terminate();rejectReady(error);}};
}
/** The worker owns cue selection/timers. Window-only MIDI/Bluetooth APIs stay here. */
export function startMidiScheduler(config:SchedulerConfig,onSend:(message:ScheduledMessage)=>void,onFault:(error:string)=>void,prepared?:Worker) {
  const worker=prepared??new Worker(new URL('./midi-scheduler-worker.ts',import.meta.url),{type:'module'});
  const failed=failedWorkers.get(worker);
  if(failed)throw failed;
  const requestedAt=midiNow();
  let active=true, started=false, lastResponse=requestedAt;
  let watchdog:ReturnType<typeof setInterval>|undefined;
  const stop=()=>{active=false;clearInterval(watchdog);worker.terminate();};
  const fault=(message:string)=>{if(!active)return;stop();onFault(message);};
  worker.onerror=()=>fault('MIDI scheduling worker failed. Cues disarmed; check the pedal state before rearming.');
  worker.onmessage=(event:MessageEvent<SchedulerReply>)=>{
    if(!active)return;
    const reply=event.data;
    if(reply.type==='ready')return;
    lastResponse=midiNow();
    if(reply.type==='started'){started=true;return;}
    if(reply.type==='heartbeat')return;
    if(reply.type==='fault') {fault(reply.error);return;}
    // Reject a delayed bridge batch before sending any part of it.
    if(reply.messages.some(message=>midiNow()-message.due>250)) {fault('MIDI dispatch interrupted: delayed commands discarded and cues disarmed.');return;}
    try {for(const message of reply.messages) {if(!active)return;if(midiNow()-message.due>250){fault('MIDI dispatch interrupted: delayed commands discarded and cues disarmed.');return;}onSend(message);}}
    catch(error) {fault(error instanceof Error?error.message:String(error));}
  };
  watchdog=setInterval(()=>{if(midiNow()-(started?lastResponse:requestedAt)>250)fault(started?'MIDI scheduler stopped responding. Cues disarmed.':'MIDI scheduler did not acknowledge playback. Cues disarmed.');},50);
  try {worker.postMessage({type:'start',config:{...config,cues:config.cues.filter(c=>c.messages.length).map(c=>({...c,text:''}))}});} catch(error){stop();throw error;}
  return {stop,sync(position:number){if(active)try{worker.postMessage({type:'sync',position,at:midiNow()});}catch(error){fault(String(error));}}};
}
