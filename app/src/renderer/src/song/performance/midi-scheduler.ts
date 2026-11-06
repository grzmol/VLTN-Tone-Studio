import type { Cue } from "./chart";
import { CHASE_LEAD_MS, chaseTriggerSet, computeChaseState, settledAt, type TriggerCc } from "./midi-chase";
import { orderForPedal } from "./midi-pedal-order";
import { clampRate } from "./speed";
import { cycleFrames, framesAt, fullFrame, quarterFrame, type TimecodeRate } from "./timecode";

export interface ScheduledMessage {
  bytes: number[];
  due: number;
  label: string;
  /** Song position in seconds the message belongs to. Unlike `due`, it is unaffected by a resync. */
  time?: number;
}
/**
 * A quarter-frame stream: quarter frame `next` is due at `anchor.time` plus its share of a quarter at `rate`, and carries the frame
 * count of its cycle. The worker reports the stream it is sending, so a hand-over can carry it on.
 */
export interface TimecodeStream {
  anchor: { time: number; frames: number };
  next: number;
  fps: TimecodeRate;
  rate: number;
}
/** The outgoing song's stream, carried into the incoming song's schedule up to the join at clock time `end`. */
export type TimecodeTail = TimecodeStream & { end: number };

export interface SchedulerConfig {
  cues: Cue[];
  position: number;
  duration: number;
  origin: number;
  /** The song's written tempo. The clock and the start tempo use it times `rate`. */
  bpm: number;
  /** Playback rate (see speed.ts). A song second takes 1 / rate of clock time. Defaults to 1. */
  rate?: number;
  clock: boolean;
  tempo: number[][] | null;
  /**
   * Clock time (the same clock as `origin`) the start tempo and play trigger are due: the start of the count-in. A start from the middle of a
   * song is due at its position's clock time less the count-in, not at song position zero, which is long past by then. Defaults to the start position's clock time.
   */
  tempoAt?: number;
  /** Seconds of cues to emit ahead of the audio position. Defaults to the Bluetooth value. */
  lookahead?: number;
  /** The GP-150 / GP-180 receive channel. Messages due together go to other channels first (see midi-pedal-order.ts). Missing keeps chart order. */
  pedalChannel?: number;
  /**
   * The trigger controllers the pedal profiles assign, as (channel, CC) with the channel 1–16 as the pedal is set. A chase never
   * replays them unless the cue says `{chase}`. Built on the main thread, so the worker needs no profile data.
   */
  chaseTriggers?: TriggerCc[];
  /** The `{midi@play}` trigger messages. They are sent once, with the start tempo, and never again on a jump or loop. */
  playTriggers?: number[][];
  /**
   * MIDI Time Code. `offset` is the frame count at song position zero (see timecode.ts). Quarter frames follow song time, and a
   * jump, seek or rate change restarts them with a full frame. Nothing is sent before song position zero, so a count-in is silent.
   */
  timecode?: { fps: TimecodeRate; offset: number };
  /** The outgoing song's quarter frames, sent until its join before this schedule's own timecode starts. See `TimecodeTail`. */
  timecodeTail?: TimecodeTail;
}
/** A planned jump: from clock time `at` the song is at `position`. */
export interface SchedulerJump {
  at: number;
  position: number;
  /** The rate from the jump on, when it changes (a speed swap). Missing keeps the current rate. */
  rate?: number;
  /**
   * The song position does not change (a speed swap at the position the audio is already at). The pedals already have that state, so
   * the jump sends no chase and keeps the cue cursor.
   */
  keepsPosition?: boolean;
}
export type SchedulerReply =
  | { type: "batch"; messages: ScheduledMessage[]; dropped?: ScheduledMessage[]; timecode?: TimecodeStream | null }
  | { type: "resync"; position: number }
  | { type: "fault"; error: string }
  | { type: "ready" }
  | { type: "started" }
  | { type: "heartbeat" };
/**
 * The worker's clock on the renderer's timeline. `at` is the renderer's clock (`midiNow`) when playback was requested, and `perfNow` is the
 * worker's own monotonic clock. Only the difference between them is kept, so the worker's time origin plays no part: a worker created before
 * a sleep, or after the wall clock moved, reads the same time as the renderer. Reading `timeOrigin + now` directly would put it hours away.
 */
export function alignedClock(at: number, perfNow: () => number): () => number {
  const offset = at - perfNow();
  return () => perfNow() + offset;
}

export type SchedulerRequest =
  | { type: "start"; config: SchedulerConfig; at: number }
  | { type: "sync"; position: number; at: number }
  | { type: "plan"; cap: number | null; jump: SchedulerJump | null }
  | { type: "timecode-end"; at: number | null }
  | { type: "stop" };

/**
 * USB / system MIDI: Web MIDI queues timestamped messages on the browser's MIDI thread, so renderer jank cannot delay them. 0.2 s covers
 * ten worker ticks (20 ms each), enough for a short renderer stall, and is short enough that a Pause (which Chromium cannot recall from
 * the OS) leaves at most 0.2 s of queued cues to fire.
 */
export const SYSTEM_LOOKAHEAD = 0.2;
/** Bluetooth MIDI has no receiver-side timestamping, so cues are held in renderer timers and must stay close to their due time. */
export const BLUETOOTH_LOOKAHEAD = 0.12;
/** A message later than this is dropped instead of sent out of place. */
export const STALE_MS = 250;
/**
 * A steady audio offset larger than this is followed by moving the origin. Below STALE_MS it is never a resync, so without this it would
 * stay in place for the whole song and eat the resync margin for later hitches.
 */
const DRIFT_MS = 30;
/** Consecutive checkpoints that must show the same offset before it is followed. One jittery checkpoint does not move the clock. */
const DRIFT_CHECKPOINTS = 3;
/** This many resyncs inside RESYNC_WINDOW_MS means timing is not recovering and the session is faulted. */
const MAX_RESYNCS = 3;
const RESYNC_WINDOW_MS = 5000;
/** The audio position must advance at least this often while playing. */
const AUDIO_STALL_MS = 1000;
/**
 * Time allowed after the planned audio start for the audio to begin. A Mac output can take about two seconds to wake, and
 * `AudioContext.resume` adds more, so the stall rule only applies once the audio has advanced at least once.
 */
const START_GRACE_MS = 5000;
const START_FAULT = "The audio did not start. Cues disarmed.";

/**
 * Reorders each run of messages due at the same moment for the pedal. Runs are not merged across times, so a message is never sent
 * ahead of an earlier one that is due later.
 */
function orderSameTime(messages: ScheduledMessage[], pedalChannel: number | undefined): ScheduledMessage[] {
  const ordered: ScheduledMessage[] = [];
  for (let start = 0; start < messages.length; ) {
    let end = start + 1;
    while (end < messages.length && messages[end].due === messages[start].due) end++;
    ordered.push(...orderForPedal(messages.slice(start, end), pedalChannel, (m) => m.bytes));
    start = end;
  }
  return ordered;
}

/** A full-frame timecode SysEx: the only timecode message worth sending late, since it is what sets the receiver's position. */
export function isFullFrame(bytes: number[]): boolean {
  return bytes[0] === 240 && bytes[1] === 127 && bytes[2] === 127 && bytes[3] === 1 && bytes[4] === 1;
}

/**
 * What to do with a message that is already past STALE_MS. Note-offs are always sent so notes cannot hang. A late full frame is sent,
 * because it is one message that sets the position. Late quarter frames are dropped, never sent in a burst: the next piece is due a
 * fraction of a frame later and carries the current value.
 */
export function lateAction(bytes: number[]): "send" | "drop" | "ignore" {
  const status = bytes[0] & 240;
  if (bytes[0] === 248) return "ignore";
  if (bytes[0] === 241) return "drop";
  if (isFullFrame(bytes)) return "send";
  if (status === 128 || (status === 144 && bytes[2] === 0)) return "send";
  return "drop";
}

/** Independent of React and audio analysis. All times are epoch milliseconds. */
export class MidiSchedule {
  private next: number;
  private pulse: number;
  /**
   * Where the clock pulses are anchored: pulse `index` is due at `time`. It stays put across a jump, so the 24-pulse clock never gaps
   * or bursts. A jump that changes the rate re-anchors it at the swap, so the spacing changes there and nowhere else.
   */
  private pulseAnchor: { time: number; index: number };
  private lastTick: number;
  private heartbeat: number;
  private config: SchedulerConfig;
  /** The rate the song plays at. Song time runs at this multiple of clock time. */
  private rate: number;
  private resyncs: number[] = [];
  /** How many consecutive advancing checkpoints have shown an offset above DRIFT_MS, all with the sign in `driftSign`. */
  private driftChecks = 0;
  private driftSign = 0;
  private lastPosition: number;
  private lastAdvance: number;
  /** A checkpoint has arrived since this start. */
  private audioReported = false;
  /** The audio position has advanced at least once since this start. Until then the stall rule does not apply. */
  private started = false;
  /** Clock time by which the audio must have advanced once. Set from the planned start, not from the Play request. */
  private startDeadline: number;
  private stopped = false;
  private tempo: number[][] | null;
  private playTriggers: number[][];
  private cues: Cue[];
  private chaseTriggers: ReadonlySet<string>;
  /** Starting after the first cue means the pedals have to be brought to the state they would be in. */
  private chasePending = true;
  /** Cues from this song time on are held back. A planned jump sets it so the old passage stops at the boundary. */
  private cap = Infinity;
  private pendingJump: SchedulerJump | null = null;
  /** Checkpoints taken before this clock time were taken before the last jump, so they describe the old passage. */
  private jumpAt = -Infinity;
  /** The timecode stream: quarter frame `next` is due at `anchor.time` plus its share of a quarter at the current rate. */
  private timecode: { anchor: { time: number; frames: number }; next: number; fullPending: boolean } | null = null;
  /** Quarter frames stop at this clock time. A hand-over ends the outgoing song's timecode where the next song's begins. */
  private timecodeEnd = Infinity;
  /** The outgoing song's quarter frames, until its join. They come before this schedule's own full frame. */
  private tail: TimecodeTail | null = null;
  constructor(
    config: SchedulerConfig,
    now: number,
    private emit: (reply: SchedulerReply) => void,
  ) {
    // A resync moves the origin, so keep the caller's object untouched.
    this.config = { ...config };
    this.rate = clampRate(config.rate ?? 1);
    this.cues = config.cues
      .filter((c) => c.messages.length && !c.trigger && c.time <= config.duration)
      .sort((a, b) => a.time - b.time);
    this.playTriggers = config.playTriggers ?? [];
    this.chaseTriggers = chaseTriggerSet(config.chaseTriggers);
    this.next = this.cursorAt(config.position);
    this.pulse = Math.ceil(((Math.max(0, config.position) * config.bpm) / 60) * 24);
    this.pulseAnchor = { time: config.origin, index: 0 };
    this.lastTick = now;
    this.heartbeat = this.clockAt(config.position);
    this.lastPosition = config.position;
    this.lastAdvance = now;
    this.startDeadline = this.clockAt(config.position) + START_GRACE_MS;
    this.tempo = config.tempo;
    if (config.timecode) this.restartTimecode(this.clockAt(Math.max(0, config.position)), config.position);
    if (config.timecodeTail) this.tail = { ...config.timecodeTail, anchor: { ...config.timecodeTail.anchor } };
  }
  /** Starts the timecode from a song position at a clock time: a full frame there, then quarter frames from piece 0. */
  private restartTimecode(at: number, position: number) {
    if (!this.config.timecode) return;
    const { fps, offset } = this.config.timecode;
    this.timecode = { anchor: { time: at, frames: framesAt(position, offset, fps) }, next: 0, fullPending: true };
  }
  stop() {
    this.stopped = true;
  }
  /** Stops quarter frames at clock time `at`, or lifts the stop with null. Cues and clock are not affected. */
  endTimecode(at: number | null) {
    if (!this.stopped) this.timecodeEnd = at ?? Infinity;
  }
  /** Index of the first cue at or after `position`. */
  private cursorAt(position: number): number {
    let next = 0;
    while (next < this.cues.length && this.cues[next].time < position - 0.001) next++;
    return next;
  }
  /**
   * Holds cues at or after song time `cap` (null lifts the hold). With a `jump`, the schedule moves to `jump.position` at clock time
   * `jump.at`. Cues in the skipped span are never sent; the pedals get the state they would have had at the new position.
   * Setting a new plan replaces the old one, so a cancelled jump is a plan with no jump. A jump already due at `now` is carried out
   * first: the session clears its plan once the audio passes the boundary, and a clear that arrives before the next tick must not drop it.
   */
  plan(cap: number | null, jump: SchedulerJump | null, now: number) {
    if (this.stopped) return;
    if (this.pendingJump && now >= this.pendingJump.at) this.jump();
    this.cap = cap ?? Infinity;
    this.pendingJump = jump;
  }
  /** The audio position is a checkpoint. A frozen audio clock is fatal; a drifted or late one re-anchors the schedule. */
  sync(position: number, at: number, now: number) {
    if (this.stopped) return;
    if (!Number.isFinite(position) || !Number.isFinite(at)) {
      this.fault("MIDI timing interrupted: invalid audio checkpoint.");
      return;
    }
    if (at < this.jumpAt) return;
    this.audioReported = true;
    const advanced = position > this.lastPosition + 0.001;
    if (advanced) {
      this.started = true;
      this.lastPosition = position;
      this.lastAdvance = at;
    } else if (!this.started) {
      // Before the first advance the audio may still be waking up, so only the start-up grace applies.
      if (at > this.startDeadline) {
        this.fault(START_FAULT);
        return;
      }
    } else if (at - this.lastAdvance > AUDIO_STALL_MS) {
      this.fault("MIDI timing interrupted: the audio clock stopped advancing.");
      return;
    }
    this.heartbeat = Math.max(this.heartbeat, at);
    // A late checkpoint is still a consistent (position, time) pair, so it can re-anchor the origin.
    // A frozen position can't anchor anything; it is judged by the stall check above instead.
    if (advanced) {
      const drift = at - this.clockAt(position);
      if (Math.abs(drift) > STALE_MS) {
        this.driftChecks = 0;
        this.shiftOrigin(drift);
        this.resync(now, position);
      } else this.followDrift(drift);
    }
  }
  /**
   * Follows a steady offset between DRIFT_MS and STALE_MS without counting it as a resync. The offset must hold for DRIFT_CHECKPOINTS
   * checkpoints in a row with the same sign. A checkpoint inside DRIFT_MS, or one with the other sign, starts the count again.
   */
  private followDrift(drift: number) {
    if (Math.abs(drift) <= DRIFT_MS) {
      this.driftChecks = 0;
      return;
    }
    if (Math.sign(drift) !== this.driftSign) {
      this.driftSign = Math.sign(drift);
      this.driftChecks = 0;
    }
    this.driftChecks++;
    if (this.driftChecks < DRIFT_CHECKPOINTS) return;
    this.driftChecks = 0;
    this.shiftOrigin(drift);
  }
  /**
   * Moves the origin and everything anchored to it by the same amount, so the clock, the pulse grid and the timecode stay in step with
   * the audio. Nothing is re-sent; later messages are simply due at the new times.
   */
  private shiftOrigin(shift: number) {
    this.config.origin += shift;
    this.pulseAnchor.time += shift;
    if (this.timecode) this.timecode.anchor.time += shift;
  }
  private resync(now: number, position: number) {
    this.resyncs = this.resyncs.filter((t) => now - t < RESYNC_WINDOW_MS);
    this.resyncs.push(now);
    this.lastTick = now;
    this.heartbeat = Math.max(this.heartbeat, now);
    if (this.resyncs.length >= MAX_RESYNCS) {
      this.fault("MIDI timing could not recover after repeated stalls: cues disarmed. Check the pedal state before rearming.");
      return;
    }
    this.emit({ type: "resync", position });
  }
  private fault(
    error = "MIDI timing interrupted: cues disarmed and pending commands cleared. Audio continues. Pause and check the pedal state before rearming.",
  ) {
    if (this.stopped) return;
    this.stopped = true;
    this.emit({ type: "fault", error });
  }
  /** Moves the schedule to the planned position. The audio jumped at the same boundary, so the audio checkpoint restarts here too. */
  private jump() {
    const jump = this.pendingJump!;
    this.pendingJump = null;
    // A new rate re-anchors the clock on the last pulse already sent, so the spacing changes after it. Pulses sent in the lookahead
    // keep the old spacing, and none is sent twice or bunched up.
    if (jump.rate !== undefined && clampRate(jump.rate) !== this.rate) {
      const last = this.pulseDue(this.pulse - 1);
      this.rate = clampRate(jump.rate);
      this.pulseAnchor = { time: last, index: this.pulse - 1 };
    }
    this.config.origin = jump.at - (jump.position * 1000) / this.rate;
    this.config.position = jump.position;
    // Keeping the position keeps the cursor too: a cue on the swap's own beat was already sent before the swap, and must not go out twice.
    if (!jump.keepsPosition) this.next = this.cursorAt(jump.position);
    this.cap = Infinity;
    this.lastPosition = jump.position;
    this.lastAdvance = jump.at;
    this.jumpAt = jump.at;
    this.driftChecks = 0;
    this.driftSign = 0;
    // A jump that moves the song chases the state at its new position. A speed swap at the same position does not.
    if (!jump.keepsPosition) this.chasePending = true;
    // Timecode follows song time, so a jump, loop wrap or rate change starts it again: a full frame at the new position, then piece 0.
    this.restartTimecode(jump.at, jump.position);
    // A seek moves the song away from the hand-over, so the outgoing song's quarter frames stop there.
    this.tail = null;
  }
  /**
   * Quarter frames due before `limit` (clock time). Frames are two-frame cycles of eight pieces. Stale quarter frames are skipped
   * without being sent. One summary entry is returned for them, so the notice counts the stall once.
   */
  private timecodeMessages(now: number, limit: number, candidates: ScheduledMessage[]): ScheduledMessage | null {
    this.tailMessages(limit, candidates);
    const tc = this.timecode;
    if (!tc || !this.config.timecode || tc.anchor.time >= limit) return null;
    const { fps } = this.config.timecode;
    if (tc.fullPending) {
      candidates.push({ bytes: fullFrame(tc.anchor.frames, fps), due: tc.anchor.time, label: "MIDI timecode", time: this.config.position });
      tc.fullPending = false;
    }
    let skipped: ScheduledMessage | null = null;
    for (;;) {
      const due = tc.anchor.time + (tc.next * 1000) / (4 * fps * this.rate);
      if (due >= limit) break;
      const bytes = quarterFrame(tc.next, cycleFrames(tc.next, tc.anchor.frames), fps);
      tc.next++;
      if (due < now - STALE_MS) {
        skipped = { bytes, due, label: "MIDI timecode (late)" };
        continue;
      }
      candidates.push({ bytes, due, label: "MIDI timecode" });
    }
    return skipped;
  }
  /**
   * The outgoing song's quarter frames due before `limit` and before its join. Only quarter frames run here: the tail has no cues, clock
   * or full frame, so it ends at the join and this schedule's own full frame comes after it.
   */
  private tailMessages(limit: number, candidates: ScheduledMessage[]) {
    const tail = this.tail;
    if (!tail) return;
    const end = Math.min(limit, tail.end);
    for (;;) {
      const due = tail.anchor.time + (tail.next * 1000) / (4 * tail.fps * tail.rate);
      if (due >= end) break;
      candidates.push({ bytes: quarterFrame(tail.next, cycleFrames(tail.next, tail.anchor.frames), tail.fps), due, label: "MIDI timecode" });
      tail.next++;
    }
    if (end >= tail.end) this.tail = null;
  }
  /** The quarter-frame stream this schedule is sending, for a hand-over to carry on. Null when it sends no timecode. */
  timecodeStream(): TimecodeStream | null {
    const tc = this.timecode;
    if (!tc || !this.config.timecode) return null;
    return { anchor: { ...tc.anchor }, next: tc.next, fps: this.config.timecode.fps, rate: this.rate };
  }
  /** Clock time of song position `song` (seconds), so a rated song reads its position off the clock at `rate` times the song's pace. */
  private clockAt(song: number): number {
    return this.config.origin + (song * 1000) / this.rate;
  }
  /** Clock time of pulse `k`: 24 pulses per beat, from the pulse anchor. The pulses follow the effective tempo, the written BPM times `rate`. */
  private pulseDue(k: number): number {
    return this.pulseAnchor.time + (((k - this.pulseAnchor.index) / 24) * 60 * 1000) / (this.config.bpm * this.rate);
  }
  tick(now: number) {
    if (this.stopped) return;
    if (this.pendingJump && now >= this.pendingJump.at) this.jump();
    let position = ((now - this.config.origin) / 1000) * this.rate;
    if (now - this.lastTick > STALE_MS || now - this.heartbeat > STALE_MS) {
      this.resync(now, position);
      if (this.stopped) return;
    }
    this.lastTick = now;
    position = ((now - this.config.origin) / 1000) * this.rate;
    const lookahead = this.config.lookahead ?? BLUETOOTH_LOOKAHEAD;
    // Once checkpoints show the audio has not moved, cues after the start position are held, so a late start does not fire them early.
    const holdAt = this.audioReported && !this.started ? this.config.position : Infinity;
    const until = Math.min(this.config.duration, position + lookahead * this.rate, holdAt),
      candidates: ScheduledMessage[] = [];
    // The cap is exclusive: a cue on the boundary waits for the plan, so a jump at that boundary never sends the passage after it.
    while (this.next < this.cues.length && this.cues[this.next].time <= until && this.cues[this.next].time < this.cap - 0.001) {
      const cue = this.cues[this.next++];
      for (const bytes of cue.messages) candidates.push({ bytes, due: this.clockAt(cue.time), label: cue.label || "Song cue", time: cue.time });
    }
    if (this.tempo) {
      for (const bytes of this.tempo)
        candidates.push({
          bytes,
          due: this.config.tempoAt ?? this.clockAt(Math.max(0, this.config.position)),
          label: "Song tempo",
          time: Math.max(0, this.config.position),
        });
      this.tempo = null;
    }
    if (this.playTriggers.length) {
      // Sent once per start, after the tempo, so a jump or a loop that passes the start does not send them again.
      const due = this.config.tempoAt ?? this.clockAt(Math.max(0, this.config.position));
      for (const bytes of this.playTriggers) candidates.push({ bytes, due, label: "Song play trigger", time: Math.max(0, this.config.position) });
      this.playTriggers = [];
    }
    // Clock and timecode are exclusive: a receiver gets one source of time, so clock is ignored when timecode is on.
    if (this.config.clock && !this.config.timecode) {
      // The clock runs on its own clock time, not on the song's, so a jump does not change its phase.
      const horizon = Math.min(now + lookahead * 1000, this.clockAt(this.config.duration));
      while (this.pulseDue(this.pulse) < horizon) candidates.push({ bytes: [248], due: this.pulseDue(this.pulse++), label: "MIDI clock" });
    }
    // Quarter frames stop at a pending jump (the old passage ends there) and at the cap, and never run before song position zero.
    const timecodeLimit = Math.min(
      now + lookahead * 1000,
      this.clockAt(this.config.duration),
      this.clockAt(this.cap),
      this.pendingJump?.at ?? Infinity,
      this.timecodeEnd,
    );
    const skippedTimecode = this.timecodeMessages(now, timecodeLimit, candidates);
    const messages: ScheduledMessage[] = [],
      dropped: ScheduledMessage[] = skippedTimecode ? [skippedTimecode] : [];
    for (const message of candidates) {
      if (now - message.due <= STALE_MS) messages.push(message);
      else {
        const action = lateAction(message.bytes);
        if (action === "send") messages.push(message);
        else if (action === "drop") dropped.push(message);
      }
    }
    // Dropped patch or controller changes leave the pedals in the wrong state, so they are replayed as a chase too.
    const lostState = dropped.some((m) => (m.bytes[0] >= 176 && m.bytes[0] < 208) || m.bytes[0] === 240 || m.bytes[0] === 243);
    if (this.chasePending || lostState) {
      const chasePosition = this.chasePending ? this.config.position : position;
      this.chasePending = false;
      const sent = new Set(messages.map((m) => m.bytes.join(",")));
      // A cue at the chase position sends its own state at that moment, so the chase leaves those channels and controllers out.
      const chase = computeChaseState(this.cues, chasePosition, this.chaseTriggers, settledAt(this.cues, chasePosition))
        .filter((m) => !sent.has(m.bytes.join(",")))
        .map((m) => ({ bytes: m.bytes, due: Math.max(now, this.clockAt(chasePosition) - CHASE_LEAD_MS), label: "Chase state", time: m.time }));
      messages.unshift(...chase);
    }
    const ordered = orderSameTime(messages, this.config.pedalChannel);
    if (messages.length || dropped.length) this.emit({ type: "batch", messages: ordered, ...(dropped.length ? { dropped } : {}), timecode: this.timecodeStream() });
  }
}
