import type { Cue } from './chart';

export interface ScheduledMessage { bytes: number[]; due: number; label: string }
export interface SchedulerConfig {
  cues: Cue[]; position: number; duration: number; origin: number;
  bpm: number; clock: boolean; tempo: number[][] | null;
}
export type SchedulerReply = { type: 'batch'; messages: ScheduledMessage[] } | { type: 'fault'; error: string } | { type: 'ready' } | { type: 'started' } | { type: 'heartbeat' };
export type SchedulerRequest = { type: 'start'; config: SchedulerConfig } | { type: 'sync'; position: number; at: number } | { type: 'stop' };

/** Independent of React and audio analysis. All times are epoch milliseconds. */
export class MidiSchedule {
  private next = 0;
  private pulse: number;
  private lastTick: number;
  private heartbeat: number;
  private stopped = false;
  private tempo: number[][] | null;
  private cues: Cue[];
  constructor(private config: SchedulerConfig, now: number, private emit: (reply: SchedulerReply) => void) {
    this.cues = config.cues.filter(c => c.messages.length && c.time <= config.duration).sort((a,b)=>a.time-b.time);
    while (this.next < this.cues.length && this.cues[this.next].time < config.position - .001) this.next++;
    this.pulse = Math.ceil(Math.max(0,config.position)*config.bpm/60*24);
    this.lastTick = now; this.heartbeat = config.origin+config.position*1000; this.tempo = config.tempo;
  }
  stop() { this.stopped = true; }
  sync(position: number, at: number, now: number) {
    if (this.stopped) return;
    if (!Number.isFinite(position) || !Number.isFinite(at) || now-at > 250 || Math.abs(at-(this.config.origin+position*1000))>250) this.fault();
    else this.heartbeat = at;
  }
  private fault() {
    if (this.stopped) return;
    this.stopped = true;
    this.emit({type:'fault',error:'MIDI timing interrupted: cues disarmed and pending commands cleared. Audio continues. Pause and check the pedal state before rearming.'});
  }
  tick(now: number) {
    if (this.stopped) return;
    const position = (now-this.config.origin)/1000;
    if (now-this.lastTick>250 || now-this.heartbeat>250 || (this.cues[this.next] && this.cues[this.next].time<position-.25)) { this.fault();return; }
    this.lastTick = now;
    const until = Math.min(this.config.duration, position+.05), messages:ScheduledMessage[]=[];
    while (this.next<this.cues.length && this.cues[this.next].time<=until) {
      const cue=this.cues[this.next++];
      for(const bytes of cue.messages) messages.push({bytes,due:this.config.origin+cue.time*1000,label:cue.label || 'Song cue'});
    }
    if(this.tempo) {
      for(const bytes of this.tempo) messages.push({bytes,due:Math.max(now,this.config.origin+Math.max(0,this.config.position)*1000),label:'Song tempo'});
      this.tempo=null;
    }
    if(this.config.clock) while(this.pulse/24*60/this.config.bpm<until) {
      messages.push({bytes:[248],due:this.config.origin+this.pulse++/24*60/this.config.bpm*1000,label:'MIDI clock'});
    }
    if(messages.length) this.emit({type:'batch',messages});
  }
}
