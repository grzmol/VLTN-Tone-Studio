import type { PcmAudio, Stems } from "../types";
import { orderedKeys } from "../tracks";
import { beatSeconds, clicksWhilePlaying, clicksWhileStopped, preRollStart, type MetronomeMode } from "../performance/rhythm";
import { audioTimeOf, beatAtOrAfter, gridClicks, gridStart, songTimeAt, type GridCursor, type Segment } from "../performance/timeline";
import { clampRate } from "../performance/speed";
import { equalPowerCurve, playRange, CROSSFADE_MAX_S, type PlayRange } from "../performance/transition";
import type { EndBehaviour, SongShape } from "../performance/song-shape";
import { createPlaybackEngine, type PlaybackEngine } from "../audio/playback-engine";
import { stemGains, type Mix } from "./mix";
import { type BusName, type OutputConfig } from "../audio/outputs";
import { clickAccent, clickNote, clickNotes, resolveCountInSound, type ClickSound, type CountInSound } from "../performance/click-sound";
import { SYNTH, SYNTH_SECONDS, synthClick } from "./click-voices";

// Plays a song's tracks in sync through WebAudio: one buffer source per track → its gain (mixer) → its pan → a fade (the song's
// fades and any crossfade) → an analyser (level meter) → the track's bus. A track is a split's stem or an imported one (see
// tracks.ts). Pausing or seeking restarts the sources at the new position.
//
// The metronome is one grid of clicks. While the song plays it follows the song's timeline (see timeline.ts), so a count-in
// (clicks before the audio) and a pre-roll (audio that starts before the requested position) keep the same bar phase, and a jump
// keeps it too. While stopped, a rehearsal grid starts from the moment it is switched on and never touches the song. Clicks go to
// the click bus, which can be sent to its own output.
//
// A jump is scheduled ahead on the audio clock: the stems stop at its boundary and restart at the target, sample-accurately, so
// nothing has to be late. The jump can be cancelled until shortly before the boundary.
//
// Songs in a set share one engine (one AudioContext and output router). A song can hand over to the next one: the next song starts
// on the same clock at the join, and this song fades out and stops at the join's end. The session takes the next song over before
// the join is heard. Until then either song can be paused, which cancels the hand-over.

/** Which bus each track plays on, keyed by track name. A track without an entry plays on Main. */
export type TrackBuses = Partial<Record<string, BusName>>;

const RAMP_S = 0.015;
/** A jump that would start in the past starts this far from now. */
const JUMP_MIN_S = 0.05;
/** A jump can be cancelled until this long before it takes effect. The metronome reads this far ahead, so a cancel must come first. */
const JUMP_CANCEL_S = 0.15;
/** While a song loops, the next pass is scheduled once the current one is this close to its end */
const LOOP_AHEAD_S = 1;
const LOOP_CHECK_MS = 50;

interface Voice {
  buffer: AudioBuffer;
  gain: GainNode;
  pan: StereoPannerNode;
  fade: GainNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
}

/** A jump waiting on the audio clock: the sources it replaces, and the song end the segment before it had. */
interface PreparedJump {
  when: number;
  previous: AudioBufferSourceNode[];
  end: number;
  timer: ReturnType<typeof setTimeout>;
  /** The buffers and rate the stems played before a render swap, so a cancelled swap can go back to them */
  restore: { rate: number; buffers: Partial<Record<string, AudioBuffer>> } | null;
}

/** A render of the song: the rate its buffers play at, and one buffer per stem, holding song time divided by the rate. */
export interface RenderedBuffers {
  rate: number;
  buffers: Partial<Record<string, AudioBuffer>>;
}

export interface MetronomeSettings {
  mode: MetronomeMode;
  bpm: number;
  beats: number;
  volume: number;
  firstBeat?: number;
  /** The click's sound; the plain blip when unset */
  sound?: ClickSound;
  /** The count-in's sound; follows `sound` when unset */
  countInSound?: CountInSound;
}

/** Lead-in for one start. Both are in beats of `bpm`; a missing or zero value means none. */
export interface Lead {
  /** The song's written tempo, which the metronome uses. Defaults to the metronome's tempo. The count-in runs at this times the song's rate. */
  bpm?: number;
  /** Clicks before the audio starts; the first is on the downbeat */
  countInBeats?: number;
  /** Audio starts this many beats before the requested position */
  preRollBeats?: number;
  /** Seconds from the call until the audio clock starts the song, so the MIDI chase can go out first. Missing means none. */
  startDelay?: number;
}

/** One click as it is scheduled: `when` is on the main audio clock, and `beat` counts from 0 on the downbeat of a bar of `beats`. */
export interface ClickEvent {
  when: number;
  beat: number;
  beats: number;
  sound: ClickSound;
}

export type { SongShape };

/** When the next song starts and when this one stops, both on the audio clock. A fade of `fadeLength` runs between them. */
export interface Join {
  startAt: number;
  fadeLength: number;
  stopAt: number;
  /** The next song's lead-in: its count-in comes before `startAt` is heard */
  lead: Lead;
}

/** Stops and forgets every click in `clicks`: blips and drum samples alike. */
function silence(clicks: Set<AudioScheduledSourceNode>): void {
  for (const source of clicks) {
    source.stop();
    source.disconnect();
  }
  clicks.clear();
}

/** Seconds per beat of a lead-in tempo, or 0 when the tempo is not usable. */
function beatInterval(bpm: number): number {
  return Number.isFinite(bpm) && bpm > 0 ? beatSeconds(bpm) : 0;
}

/** A fade length the player can ramp: finite, not negative, and not longer than a fade may be. */
function fadeSeconds(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(CROSSFADE_MAX_S, value!)) : 0;
}

/**
 * Fills a song's buffers and yields between one channel and the next, so that a long copy does not hold the renderer. Uses the
 * scheduler where the page has one, and a timer otherwise.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class StemPlayer {
  /** The playable range, in song seconds. Trim and the file's length both set it. */
  private range: PlayRange;
  /** The song's length in song seconds, before any trim. The buffers may be a render of it, so this is not their own length. */
  private readonly fileLength: number;
  /** The rate the buffers play at. One song second takes 1 / rate seconds of audio. */
  private rate: number;
  /** The song's tracks, in the order the mixer shows them (see `orderedKeys`) */
  readonly names: string[];
  private readonly engine: PlaybackEngine;
  private readonly ownsEngine: boolean;
  private readonly ctx: AudioContext;
  private readonly router: PlaybackEngine["router"];
  private fadeIn: number;
  private fadeOut: number;
  private endBehaviour: EndBehaviour = "next";
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private voices: Record<string, Voice>;
  /** The song's timeline on the audio clock. A jump appends a segment. Empty until something has been started. */
  private segments: Segment[] = [];
  private prepared: PreparedJump | null = null;
  private offset = 0;
  /** The position the last start asked for. A pause during the count-in returns here, not to the pre-roll start. */
  private resumeAt = 0;
  private playing = false;
  /** The song this one has handed over to, until the session takes it or the hand-over is cancelled */
  private next: StemPlayer | null = null;
  /** Whether this song has handed over. Its stems then run on to `tailEnd`, and the song is not rehearsed afterwards. */
  private handedOver = false;
  /** Audio time at which the last stem of a handed-over song stops */
  private tailEnd = 0;
  private metronome: MetronomeSettings = { mode: "off", bpm: 120, beats: 4, volume: 0.25 };
  private clickTimer: ReturnType<typeof setInterval> | null = null;
  private clicks = new Set<AudioScheduledSourceNode>();
  /** Count-in clicks have their own set: a metronome change restarts the grid and must not cut the count-in short. */
  private countInClicks = new Set<AudioScheduledSourceNode>();
  /** Decoded drum samples for the click sounds, by drum note. A note with no buffer yet (or one that failed to load) clicks as the blip. */
  private clickBuffers = new Map<number, AudioBuffer>();
  private clickLoading = new Set<number>();
  /** Your own samples for the "custom" sound: one for the downbeat and one for the other beats. A missing slot clicks as the blip. */
  private customBuffers: { down?: AudioBuffer; other?: AudioBuffer } = {};
  /** Told about every click as it is scheduled, so the MIDI click can send the same beat. See `setClickListener`. */
  private clickListener: ((click: ClickEvent) => void) | null = null;
  /** Called when playback stops or is cut, so a MIDI click can drop the clicks it has not sent yet. */
  onClicksStopped: (() => void) | null = null;
  /** Whether the built-in sound still plays while the MIDI click is on. */
  private clickAudible = true;
  /** One bar of Listen, kept apart so a metronome change does not cut it off. */
  private previewing = new Set<AudioScheduledSourceNode>();
  private meterBuffer = new Float32Array(2048);
  private unlisten: () => void;
  /** Called when playback reaches the end on its own */
  onEnded: (() => void) | null = null;
  /** Called when a loop pass is scheduled: at song time `at` the song jumps back to `to`, and the jump takes effect at audio time `when`. */
  onLoopScheduled: ((loop: { to: number; at: number; when: number }) => void) | null = null;
  /** Called when an output cannot be used and audio falls back to the default output */
  onOutputWarning: ((message: string) => void) | null = null;

  /**
   * `engine` is the context and outputs this song plays on. Without one the player makes its own and closes it on dispose; a session
   * passes the shared engine so that songs in a set play on one clock.
   */
  /**
   * `stems` are the song's stems, or a render of them at `rate` (see `renderBuffers`). Shape and fades are in song seconds.
   */
  constructor(stems: Stems, engine?: PlaybackEngine, shape: SongShape = {}, fill: "now" | "later" = "now", rate = 1) {
    this.names = orderedKeys(Object.keys(stems).filter((name) => stems[name]));
    if (!this.names.length) throw new Error("There are no stems to play.");
    const first = stems[this.names[0]]!;
    this.rate = clampRate(rate);
    this.fileLength = (first.channels[0].length / first.sampleRate) * this.rate;
    this.range = playRange(this.fileLength, shape);
    this.offset = this.range.start;
    this.fadeIn = fadeSeconds(shape.fadeIn);
    this.fadeOut = fadeSeconds(shape.fadeOut);
    this.endBehaviour = shape.endBehaviour ?? "next";
    this.ownsEngine = !engine;
    this.engine = engine ?? createPlaybackEngine();
    this.ctx = this.engine.ctx;
    this.router = this.engine.router;
    this.unlisten = this.engine.onWarning((message) => this.onOutputWarning?.(message));
    this.voices = Object.fromEntries(
      this.names.map((name) => {
        const pcm = stems[name]!;
        const buffer = this.ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
        if (fill === "now") pcm.channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
        const gain = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner();
        const fade = this.ctx.createGain();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = this.meterBuffer.length;
        gain.connect(pan);
        pan.connect(fade);
        fade.connect(analyser);
        analyser.connect(this.router.buses.main);
        return [name, { buffer, gain, pan, fade, analyser, source: null }];
      }),
    );
  }

  /**
   * Builds a player whose buffers are filled a channel at a time, yielding between channels, so a long song does not block the
   * renderer. The player is not used until the returned promise resolves.
   */
  static async create(stems: Stems, engine?: PlaybackEngine, shape: SongShape = {}, pause: () => Promise<void> = yieldToMain, rate = 1): Promise<StemPlayer> {
    const player = new StemPlayer(stems, engine, shape, "later", rate);
    for (const name of player.names) {
      const pcm = stems[name]!;
      const buffer = player.voice(name).buffer;
      for (let c = 0; c < pcm.channels.length; c++) {
        buffer.copyToChannel(pcm.channels[c] as Float32Array<ArrayBuffer>, c);
        await pause();
      }
    }
    return player;
  }

  private voice(name: string): Voice {
    return this.voices[name]!;
  }

  /** Song time where the playable range ends. Trim and the file's length both set it. */
  get duration(): number {
    return this.range.end;
  }

  /** The file's length in seconds, before any trim */
  get length(): number {
    return this.fileLength;
  }

  /** Song time where the playable range starts */
  get start(): number {
    return this.range.start;
  }

  /** What the song does at its end. The session reads it to decide whether the playlist goes on. */
  get behaviour(): EndBehaviour {
    return this.endBehaviour;
  }

  /**
   * Sets what the song does at its end. A playlist entry's override replaces the song's own when the entry becomes the playing one, so a
   * loop override loops inside the player as it would for a song saved as a loop.
   */
  setEndBehaviour(behaviour: EndBehaviour): void {
    this.endBehaviour = behaviour;
    if (this.playing) this.updateLoop();
  }

  /**
   * Applies a new trim, fades and end behaviour. A trim change while the song plays moves its stop at once. Fades apply from the next
   * start, because the ramps of a playing song are already scheduled.
   */
  setShape(shape: SongShape): void {
    const duration = this.duration;
    this.range = playRange(this.fileLength, shape);
    this.fadeIn = fadeSeconds(shape.fadeIn);
    this.fadeOut = fadeSeconds(shape.fadeOut);
    this.endBehaviour = shape.endBehaviour ?? "next";
    if (this.offset >= this.duration || this.offset < this.start) this.offset = this.start;
    if (this.playing && this.duration !== duration) {
      this.segments[this.segments.length - 1].songEnd = this.duration;
      const end = audioTimeOf(this.segments, this.duration);
      for (const name of this.names) this.voice(name).source?.stop(end);
    }
    if (this.playing) this.updateLoop();
  }


  get isPlaying(): boolean {
    return this.playing;
  }

  /** Playback position in seconds. Negative during a count-in. */
  get position(): number {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, songTimeAt(this.segments, this.ctx.currentTime));
  }

  /** The audio clock now, so the session can map audio times onto the MIDI clock. */
  get audioNow(): number {
    return this.ctx.currentTime;
  }

  /** The audio time at which song time `at` plays on the current timeline. Only meaningful while playing. */
  audioTimeOf(at: number): number {
    return audioTimeOf(this.segments, at);
  }

  async play(lead: Lead = {}): Promise<void> {
    if (this.playing) return;
    // Rehearsal clicks stop at once; the song's own grid takes over below.
    this.stopMetronome();
    await this.router.resume();
    if (this.offset >= this.duration) this.offset = this.start;
    const bpm = lead.bpm ?? this.metronome.bpm;
    this.resumeAt = this.offset;
    if (lead.preRollBeats && beatInterval(bpm)) this.offset = preRollStart(this.offset, lead.preRollBeats, bpm);
    this.launch(this.ctx.currentTime + 0.02 + (lead.startDelay ?? 0), this.offset, lead, 0);
  }

  /**
   * Starts the song at audio time `clickAt`, from song time `from`. The count-in, when there is one, comes first, so the audio begins
   * after it. A crossfade of `crossfadeIn` seconds fades the song in with its curve instead of the song's own fade in.
   */
  private launch(clickAt: number, from: number, lead: Lead, crossfadeIn: number): void {
    const bpm = lead.bpm ?? this.metronome.bpm;
    // The count-in is counted at the song's tempo times its rate, so it is as long as the audio it leads.
    const interval = beatInterval(bpm) / this.rate;
    const start = clickAt + (lead.countInBeats ?? 0) * interval;
    for (const name of this.names) {
      const v = this.voice(name);
      const source = this.ctx.createBufferSource();
      source.buffer = v.buffer;
      source.connect(v.gain);
      source.start(start, from / this.rate);
      source.stop(start + (this.duration - from) / this.rate);
      v.source = source;
    }
    this.scheduleFades(start, from, crossfadeIn);
    this.watchEnd();
    this.segments = [{ ctxStart: start, songStart: from, songEnd: this.duration, rate: this.rate }];
    this.playing = true;
    if (lead.countInBeats) this.scheduleCountIn(clickAt, lead.countInBeats, interval);
    this.startPlayingGrid();
    this.updateLoop();
  }

  /** Keeps the loop timer running while a looping song plays, and stops it otherwise. */
  private updateLoop(): void {
    const wanted = this.playing && this.endBehaviour === "loop";
    if (wanted && !this.loopTimer) this.loopTimer = setInterval(() => this.keepLooping(), LOOP_CHECK_MS);
    else if (!wanted && this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /**
   * Schedules the next pass of a looping song once the current one is close to its end: a jump back to the trimmed start, placed on
   * the audio clock, so the loop has no gap.
   */
  private keepLooping(): void {
    if (!this.playing || this.next || this.prepared || this.endBehaviour !== "loop" || this.duration <= this.start) return;
    const remaining = this.audioTimeOf(this.duration) - this.ctx.currentTime;
    if (remaining > LOOP_AHEAD_S || remaining < JUMP_MIN_S) return;
    const when = this.prepareJump(this.start, this.duration);
    if (when !== null) this.onLoopScheduled?.({ to: this.start, at: this.duration, when });
  }

  /** Ramps every stem's fade for a start at `start` from song time `from`: a crossfade's curve in, or the song's own fades. */
  private scheduleFades(start: number, from: number, crossfadeIn: number): void {
    const end = start + (this.duration - from) / this.rate;
    for (const name of this.names) {
      const { fade } = this.voice(name);
      fade.gain.cancelScheduledValues(start);
      if (crossfadeIn > 0) {
        fade.gain.setValueCurveAtTime(equalPowerCurve("in"), start, crossfadeIn);
        continue;
      }
      if (this.fadeIn > 0) {
        fade.gain.setValueAtTime(0, start);
        fade.gain.linearRampToValueAtTime(1, start + this.fadeIn);
      } else fade.gain.setValueAtTime(1, start);
      if (this.fadeOut > 0) {
        fade.gain.setValueAtTime(1, Math.max(start, end - this.fadeOut));
        fade.gain.linearRampToValueAtTime(0, end);
      }
    }
  }

  pause(): void {
    this.cancelChain();
    if (!this.playing) return;
    const at = this.position;
    this.offset = at < 0 ? this.resumeAt : Math.max(0, at);
    this.playing = false;
    this.stopSources();
    this.startRehearsal();
  }

  async seek(seconds: number): Promise<void> {
    const t = Math.max(this.start, Math.min(this.duration, seconds));
    if (!this.playing) {
      this.offset = t;
      return;
    }
    this.pause();
    this.offset = t;
    await this.play();
  }

  /**
   * Hands over to `next`. It starts on this clock at `join.startAt` (after its count-in), and this song fades out over
   * `join.fadeLength` and stops at `join.stopAt`. Playback carries on until then, so the session can take the next song over first.
   * Returns false when there is nothing to hand over to: this song is not playing, already has a next song, or the join is in the past.
   */
  chainNext(next: StemPlayer, join: Join): boolean {
    if (!this.playing || this.next || next.ctx !== this.ctx || join.startAt < this.ctx.currentTime) return false;
    this.next = next;
    this.stopMetronome();
    for (const name of this.names) {
      const { fade, source } = this.voice(name);
      if (join.fadeLength > 0) {
        fade.gain.cancelScheduledValues(join.startAt);
        fade.gain.setValueCurveAtTime(equalPowerCurve("out"), join.startAt, join.fadeLength);
      }
      // A later stop replaces the stop that was set for the song's own end.
      source?.stop(join.stopAt);
    }
    this.tailEnd = join.stopAt;
    next.resumeAt = next.start;
    next.launch(join.startAt, next.start, join.lead, join.fadeLength);
    return true;
  }

  /** Gives the next song to the caller, which takes it over. This song's own end no longer stops anything else. */
  detachNext(): StemPlayer | null {
    const next = this.next;
    this.next = null;
    this.handedOver = next !== null;
    return next;
  }

  /** Undoes a hand-over that has not been taken: the next song stops, and this song keeps its own fades and end. */
  cancelChain(): void {
    const next = this.next;
    if (!next) return;
    this.next = null;
    const now = this.ctx.currentTime;
    const end = audioTimeOf(this.segments, this.duration);
    for (const name of this.names) {
      const { fade, source } = this.voice(name);
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(1, now);
      source?.stop(end);
    }
    next.stopNow();
    this.startPlayingGrid();
  }

  /** Stops this song at once, with no rehearsal grid. Used for a hand-over that was cancelled. */
  private stopNow(): void {
    this.playing = false;
    this.stopSources();
  }

  /**
   * Schedules a jump: at song time `at` the stems stop and restart at song time `to`, sample-accurately on the audio clock.
   * A jump that would start in the past starts JUMP_MIN_S from now. Returns the audio time it takes effect, or null when nothing
   * plays or another jump is still waiting.
   */
  prepareJump(to: number, at: number, render?: RenderedBuffers): number | null {
    if (!this.playing || this.prepared) return null;
    const last = this.segments[this.segments.length - 1];
    const when = Math.max(this.ctx.currentTime + JUMP_MIN_S, audioTimeOf(this.segments, at));
    // A render swap plays the new buffers from the jump on, at their rate. The old buffers stay with the record for a cancel.
    const rate = render?.rate ?? this.rate;
    const restore = render ? { rate: this.rate, buffers: Object.fromEntries(this.names.map((name) => [name, this.voice(name).buffer])) } : null;
    const previous: AudioBufferSourceNode[] = [];
    for (const name of this.names) {
      const v = this.voice(name);
      const source = this.ctx.createBufferSource();
      source.buffer = render?.buffers[name] ?? v.buffer;
      source.connect(v.gain);
      source.start(when, to / rate);
      source.stop(Math.max(when, when + (this.duration - to) / rate));
      previous.push(v.source!);
      v.source = source;
      if (render?.buffers[name]) v.buffer = render.buffers[name];
    }
    if (render) this.rate = render.rate;
    for (const old of previous) old.stop(when);
    this.watchEnd();
    const end = last.songEnd;
    last.songEnd = at;
    this.segments.push({ ctxStart: when, songStart: to, songEnd: this.duration, rate });
    // The jump has taken effect once the clock passes `when`; after that it cannot be cancelled and the record is no longer needed.
    const timer = setTimeout(
      () => {
        if (this.prepared?.when === when) this.prepared = null;
      },
      (when - this.ctx.currentTime) * 1000 + 50,
    );
    this.prepared = { when, previous, end, timer, restore };
    return when;
  }

  /**
   * Builds the buffers of a render of this song at `rate`, one per stem, from the stems the render was made of. Each channel is
   * copied in turn, yielding between them, so a long song does not hold the renderer. The buffers are not played until they are
   * given to `swapRender` or `applyRender`.
   */
  async renderBuffers(stems: Stems, rate: number, pause: () => Promise<void> = yieldToMain): Promise<RenderedBuffers> {
    const buffers: Partial<Record<string, AudioBuffer>> = {};
    for (const name of this.names) {
      const pcm = stems[name];
      if (!pcm) continue;
      const buffer = this.ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
      for (let c = 0; c < pcm.channels.length; c++) {
        buffer.copyToChannel(pcm.channels[c] as Float32Array<ArrayBuffer>, c);
        await pause();
      }
      buffers[name] = buffer;
    }
    return { rate: clampRate(rate), buffers };
  }

  /**
   * Puts a render in place while the song is stopped. Song position is kept, because it is in song time, and the next start plays
   * the new buffers at the new rate.
   */
  applyRender(render: RenderedBuffers): void {
    this.rate = render.rate;
    for (const name of this.names) {
      const buffer = render.buffers[name];
      if (buffer) this.voice(name).buffer = buffer;
    }
  }

  /**
   * The first beat of the metronome's grid at or after the song time that plays `lead` audio seconds from now. The beat grid is
   * in song time, so a render swap lands on a beat of the song at any rate. Without a usable tempo the grid is every second.
   */
  nextBeatAfter(lead: number): number {
    const { bpm } = this.metronome;
    const interval = Number.isFinite(bpm) && bpm > 0 ? 60 / bpm : 1;
    const firstBeat = this.firstBeat();
    const ahead = this.position + lead * this.rate;
    return firstBeat + beatAtOrAfter(ahead, firstBeat, interval) * interval;
  }

  /**
   * Swaps a render in while the song plays, at the first beat that is at least `lead` audio seconds away. The jump keeps the song
   * position: the same song time before and after, on new buffers at the new rate. Returns the song time and the audio time the swap
   * takes effect, or null when a jump is still waiting or the song is not playing. The caller retries then.
   */
  swapRender(render: RenderedBuffers, lead = JUMP_MIN_S): { at: number; when: number } | null {
    if (!this.playing || this.next) return null;
    const at = this.nextBeatAfter(lead);
    const when = this.prepareJump(at, at, render);
    return when === null ? null : { at, when };
  }

  /** The rate the song plays at now. The buffers and the rate change together, so this is also the rate of a render in place. */
  get playbackRate(): number {
    return this.rate;
  }

  /**
   * Undoes a jump that is still waiting: the stems keep playing the passage they were on. Returns false when there is no jump,
   * or when it is too close to take effect to undo cleanly. Then the jump stands.
   */
  cancelJump(): boolean {
    const jump = this.prepared;
    if (!jump || this.ctx.currentTime > jump.when - JUMP_CANCEL_S) return false;
    clearTimeout(jump.timer);
    this.prepared = null;
    if (jump.restore) {
      this.rate = jump.restore.rate;
      for (const name of this.names) if (jump.restore.buffers[name]) this.voice(name).buffer = jump.restore.buffers[name]!;
    }
    this.segments.pop();
    this.segments[this.segments.length - 1].songEnd = jump.end;
    // The stems go back to the song's own end, which a stop set for the jump's boundary has replaced.
    const end = audioTimeOf(this.segments, this.duration);
    this.names.forEach((name, i) => {
      const v = this.voice(name);
      const pending = v.source!;
      pending.onended = null;
      pending.stop(0);
      pending.disconnect();
      jump.previous[i].stop(end);
      v.source = jump.previous[i];
    });
    this.watchEnd();
    return true;
  }

  /** Sends each track to its bus. Tracks without an entry stay on Main. */
  setTrackBuses(routes: TrackBuses): void {
    for (const name of this.names) {
      const analyser = this.voice(name).analyser;
      analyser.disconnect();
      analyser.connect(this.router.buses[routes[name] ?? "main"]);
    }
  }

  /** Channels the main device has. */
  get outputChannels(): number {
    return this.router.channels;
  }

  /** A short tone on one bus, to check that output. */
  testTone(bus: BusName): void {
    this.router.testTone(bus);
  }

  /**
   * Volume, mute, solo and pan, all ramped so a change is heard without a click. `master` scales every track: the song's loudness gain,
   * when the song is normalised.
   */
  setMix(mix: Mix, master = 1): void {
    const gains = stemGains(mix, this.names);
    const now = this.ctx.currentTime;
    for (const name of this.names) {
      const v = this.voice(name);
      v.gain.gain.setTargetAtTime(gains[name] * master, now, RAMP_S);
      v.pan.pan.setTargetAtTime(mix[name]?.pan ?? 0, now, RAMP_S);
    }
  }

  /** Uses the stems' AudioContext and song-time origin, including after pause/seek. */
  setMetronome(settings: MetronomeSettings): void {
    this.stopMetronome();
    this.metronome = settings;
    this.prepareClickSounds();
    // A song that has handed over keeps no grid of its own: the next song takes the clicks.
    if (this.next) return;
    if (this.playing) this.startPlayingGrid();
    else this.startRehearsal();
  }

  private firstBeat(): number {
    const { firstBeat } = this.metronome;
    return Number.isFinite(firstBeat) && firstBeat! >= 0 ? firstBeat! : 0;
  }

  /** The sounds the metronome and the count-in play now. */
  private sounds(): { sound: ClickSound; countIn: ClickSound } {
    const sound = this.metronome.sound ?? "click";
    return { sound, countIn: resolveCountInSound(this.metronome.countInSound ?? "same", sound) };
  }

  /**
   * Decodes the drum samples the chosen sounds need, once each, so no click waits for a decode. Runs when the settings change, never at
   * Play. A sample that fails to load stays out of the cache and its clicks use the blip.
   */
  private prepareClickSounds(): void {
    const { sound, countIn } = this.sounds();
    const { beats } = this.metronome;
    const wanted = [...new Set([...clickNotes(sound, beats), ...clickNotes(countIn, beats)])].filter((note) => !this.clickBuffers.has(note) && !this.clickLoading.has(note));
    if (!wanted.length) return;
    for (const note of wanted) this.clickLoading.add(note);
    // The sample module (and the codec behind it) is only loaded when a drum sound is chosen, so the plain click costs nothing.
    void import("../band/samples")
      .then(({ loadDrumSample }) =>
        Promise.all(
          wanted.map((note) =>
            loadDrumSample(note)
              .then((audio) => {
                const { ctx } = this.router.clickTarget();
                const buffer = ctx.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
                audio.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
                this.clickBuffers.set(note, buffer);
              })
              // A sample that fails to decode stays out of the cache, and its clicks use the blip.
              .catch(() => {})
              .finally(() => this.clickLoading.delete(note)),
          ),
        ),
      )
      .catch(() => wanted.forEach((note) => this.clickLoading.delete(note)));
  }

  /**
   * Hands over your own samples for the "custom" sound, or null for a slot to clear. Converted once, here, so a click never decodes.
   * A slot with no sample clicks as the blip.
   */
  setCustomClickSamples(samples: { down: PcmAudio | null; other: PcmAudio | null }): void {
    const { ctx } = this.router.clickTarget();
    const toBuffer = (audio: PcmAudio | null): AudioBuffer | undefined => {
      if (!audio || !audio.channels.length || !audio.channels[0].length) return undefined;
      const buffer = ctx.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
      audio.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
      return buffer;
    };
    this.customBuffers = { down: toBuffer(samples.down), other: toBuffer(samples.other) };
  }

  /**
   * Sets who hears about each click (the MIDI click) and whether the built-in sound plays as well. With no listener every click sounds.
   * The listener is called when a click is scheduled, a little before it is due, and never at Play.
   */
  setClickListener(listener: ((click: ClickEvent) => void) | null, alsoPlay = true): void {
    this.clickListener = listener;
    this.clickAudible = listener === null || alsoPlay;
  }

  /**
   * One click at `when` (a main-clock time) on beat `beat` of the bar. Kept in `into`, so the set's owner can cancel it. The synthesised
   * sounds are oscillators and a noise burst, your own samples and the band's drums are buffer sources, and the blip is what any of the
   * samples falls back to while it is not ready.
   */
  private click(when: number, beat: number, into: Set<AudioScheduledSourceNode> = this.clicks, sound: ClickSound = this.sounds().sound): void {
    const { beats } = this.metronome;
    this.clickListener?.({ when, beat, beats, sound });
    if (!this.clickAudible) return;
    const volume = Math.max(0, Math.min(1, this.metronome.volume));
    const down = beat === 0;
    // The click may sit on its own device, with its own clock: `localTime` maps the time onto that clock.
    const { ctx, bus, localTime } = this.router.clickTarget();
    const at = localTime(when);
    const note = clickNote(sound, beat, beats);
    const buffer = sound === "custom" ? (down ? this.customBuffers.down : this.customBuffers.other) : note === null ? undefined : this.clickBuffers.get(note);
    const gain = ctx.createGain();
    // A click can be more than one source (the cowbell's two oscillators), and all of them are stopped together.
    let sources: AudioScheduledSourceNode[];
    let stopAt: number | null = null;
    if (buffer) {
      const sample = ctx.createBufferSource();
      sample.buffer = buffer;
      gain.gain.setValueAtTime(volume * clickAccent(sound, beat), at);
      sources = [sample];
    } else if (sound === "cowbell" || sound === "woodblock") {
      sources = synthClick(ctx, sound, at, volume * clickAccent(sound, beat), down, gain);
      stopAt = at + SYNTH_SECONDS;
    } else {
      // The blip, which is also what a drum sound falls back to while its sample is not ready.
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(down ? 1500 : 1000, at);
      gain.gain.setValueAtTime(volume * (down ? 1 : 0.65), at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      sources = [osc];
      stopAt = at + 0.05;
    }
    gain.connect(bus);
    // The gain is freed when the last of the sources has ended.
    let running = sources.length;
    for (const source of sources) {
      // The synthesised voices wire their own filters, so only a source with nothing after it is connected here.
      if (!SYNTH.has(sound)) source.connect(gain);
      into.add(source);
      source.onended = () => {
        into.delete(source);
        source.disconnect();
        if (--running === 0) gain.disconnect();
      };
      source.start(at);
      if (stopAt !== null) source.stop(stopAt);
    }
  }

  /**
   * Listen: one bar of the metronome's (or the count-in's) sound at the metronome tempo, through the click output, without starting the
   * song. Does nothing while the song plays, where the real click is already audible. The bar is cut off by a pause or a new Listen.
   */
  async previewClicks(which: "metronome" | "countIn" = "metronome"): Promise<void> {
    if (this.playing) return;
    const { bpm, beats } = this.metronome;
    if (!beatInterval(bpm) || !Number.isInteger(beats) || beats < 1) return;
    await this.router.resume();
    silence(this.previewing);
    const sounds = this.sounds();
    const start = this.ctx.currentTime + 0.05;
    for (let beat = 0; beat < beats; beat++) this.click(start + beat * beatInterval(bpm), beat, this.previewing, which === "countIn" ? sounds.countIn : sounds.sound);
  }

  /** The count-in is always clicked, whatever the metronome mode: it is the lead-in the player asked for. */
  private scheduleCountIn(when: number, beats: number, interval: number): void {
    for (let beat = 0; beat < beats; beat++) this.click(when + beat * interval, beat % this.metronome.beats, this.countInClicks, this.sounds().countIn);
  }

  /** Clicks on the grid along the current timeline, from where the timeline is now. Re-run by the timer, so a jump is followed. */
  private startGrid(): void {
    const { bpm, beats } = this.metronome;
    if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isInteger(beats) || beats < 1 || !this.segments.length) return;
    const firstBeat = this.firstBeat();
    const interval = 60 / bpm;
    let cursor: GridCursor = gridStart(this.segments, this.ctx.currentTime, firstBeat, interval);
    const fill = () => {
      const now = this.ctx.currentTime;
      const next = gridClicks(this.segments, cursor, now, now + 0.1, firstBeat, interval);
      cursor = next.cursor;
      for (const click of next.clicks) this.click(click.when, click.beat % beats);
    };
    fill();
    this.clickTimer = setInterval(fill, 25);
  }

  /** While the song plays: the grid follows the song's timeline, so the bar phase survives pre-roll, seeks and jumps. */
  private startPlayingGrid(): void {
    if (!clicksWhilePlaying(this.metronome.mode)) return;
    this.startGrid();
  }

  /** While stopped: a grid that starts now, so a rehearsal keeps time without moving the song. */
  private startRehearsal(): void {
    if (!clicksWhileStopped(this.metronome.mode)) return;
    const anchor = this.ctx.currentTime + 0.02;
    this.segments = [{ ctxStart: anchor, songStart: 0, songEnd: Infinity }];
    this.startGrid();
  }

  private stopMetronome(): void {
    if (this.clickTimer) clearInterval(this.clickTimer);
    this.clickTimer = null;
    silence(this.clicks);
  }

  /** Current RMS level (0..1) of each stem after its gain */
  levels(): Record<string, number> {
    return Object.fromEntries(
      this.names.map((name) => {
        if (!this.playing) return [name, 0];
        this.voice(name).analyser.getFloatTimeDomainData(this.meterBuffer);
        let sum = 0;
        for (const x of this.meterBuffer) sum += x * x;
        return [name, Math.sqrt(sum / this.meterBuffer.length)];
      }),
    );
  }

  /** Sends the tracks and the click to the outputs in `config`. Never stops playback: a missing output falls back to the default. */
  setOutputs(config: OutputConfig): Promise<void> {
    return this.router.apply(config);
  }

  /**
   * Ends the song. The stems stop at once, unless a hand-over has left them running to their end: then they are released after that.
   * A shared engine is left open; a player that owns its engine closes it.
   */
  async dispose(): Promise<void> {
    this.cancelChain();
    this.playing = false;
    const tail = this.handedOver ? this.tailEnd - this.ctx.currentTime : 0;
    if (tail > 0) {
      setTimeout(() => void this.release(false), tail * 1000 + 100);
      return;
    }
    await this.release(true);
  }

  /** Frees the song's nodes. `stop` is false after a hand-over, whose stems have already been scheduled to end. */
  private async release(stop: boolean): Promise<void> {
    this.unlisten();
    if (stop) this.stopSources();
    else this.stopMetronome();
    for (const name of this.names) {
      const { gain, pan, fade, analyser } = this.voice(name);
      gain.disconnect();
      pan.disconnect();
      fade.disconnect();
      analyser.disconnect();
    }
    if (this.ownsEngine) await this.engine.close();
  }

  /**
   * The song's end: one source tells the end, the others end on the same sample. Attached to the leader, which a jump replaces, so
   * the watch moves with it. A source that a jump has replaced ends without this firing. After a hand-over the end is not a stop:
   * the next song is already playing, so only the caller is told.
   */
  private watchEnd(): void {
    const leader = this.voice(this.names[0]);
    const ending = leader.source!;
    ending.onended = () => {
      if (!this.playing || leader.source !== ending) return;
      this.playing = false;
      if (this.next || this.handedOver) {
        this.onEnded?.();
        return;
      }
      this.stopSources();
      this.offset = this.duration;
      this.onEnded?.();
      this.startRehearsal();
    };
  }

  private stopSources() {
    this.stopMetronome();
    this.onClicksStopped?.();
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    silence(this.countInClicks);
    silence(this.previewing);
    for (const name of this.names) {
      const v = this.voice(name);
      if (!v.source) continue;
      v.source.onended = null;
      v.source.stop();
      v.source.disconnect();
      v.source = null;
    }
    if (this.prepared) {
      clearTimeout(this.prepared.timer);
      for (const source of this.prepared.previous) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      this.prepared = null;
    }
  }
}
