import { readOptions, setSetting } from "./settings";
import { midiClickNote, type ClickSound } from "./click-sound";
import type { TimedMessage } from "./midi-scheduler";
import type { startMidiScheduler, midiNow } from "./midi-scheduler-client";
import type { ClickEvent } from "../stems/player";

// Send the click as MIDI (spec 103): each metronome and count-in beat is also sent as a General MIDI drum note to an output of its own,
// so a drum plugin in another app (through a virtual port) or a drum module can play the count-in. The notes follow the chosen click
// sound. They are timed by the MIDI scheduler's worker, on the same clock as cues, and never by a timer here; the only timer is the
// heartbeat that keeps that worker's session alive. The click has its own output and does not need Send cues to be armed.

export interface MidiClickSettings {
  enabled: boolean;
  /** The Web MIDI output id; "" means none, so nothing is sent. It is never taken from the cue output. */
  portId: string;
  /** 1–16; 10 is the General MIDI drum channel. */
  channel: number;
  /** Milliseconds the notes are moved by (−100 to +100), to make up for the other app's latency. */
  offsetMs: number;
  /** Whether the built-in sound plays as well. */
  alsoPlay: boolean;
}

export const MIDI_CLICK_DEFAULTS: MidiClickSettings = { enabled: false, portId: "", channel: 10, offsetMs: 0, alsoPlay: true };
export const MIDI_CLICK_OFFSET_LIMIT = 100;
/** Velocity of the downbeat and of the other beats. */
export const MIDI_CLICK_VELOCITIES = { down: 100, other: 80 };
/** The note-off follows the note-on by this long. */
export const MIDI_CLICK_NOTE_MS = 50;

const KEY = "vltn.performance.midiclick.v1";

const whole = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** Saved settings with every value checked: anything unknown or out of range reads as the default. */
export function parseMidiClickSettings(value: unknown): MidiClickSettings {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof MidiClickSettings, unknown>>;
  return {
    enabled: v.enabled === true,
    portId: typeof v.portId === "string" ? v.portId : "",
    channel: whole(v.channel, 1, 16, MIDI_CLICK_DEFAULTS.channel),
    offsetMs: whole(v.offsetMs, -MIDI_CLICK_OFFSET_LIMIT, MIDI_CLICK_OFFSET_LIMIT, 0),
    alsoPlay: v.alsoPlay !== false,
  };
}

export const readMidiClickSettings = (): MidiClickSettings => parseMidiClickSettings(readOptions<Record<string, unknown>>(KEY, {}));

export function saveMidiClickSettings(settings: MidiClickSettings): void {
  setSetting(KEY, ":options", JSON.stringify(settings));
}

/** The note-on and the note-off of one click, due at `due` (clock time) and `MIDI_CLICK_NOTE_MS` later. */
export function midiClickMessages(sound: ClickSound, beat: number, beats: number, channel: number, due: number): TimedMessage[] {
  const status = channel - 1;
  const note = midiClickNote(sound, beat, beats);
  const velocity = beat === 0 ? MIDI_CLICK_VELOCITIES.down : MIDI_CLICK_VELOCITIES.other;
  return [
    { bytes: [0x90 | status, note, velocity], due },
    { bytes: [0x80 | status, note, 0], due: due + MIDI_CLICK_NOTE_MS },
  ];
}

/** The part of a Web MIDI output the click uses. */
export interface ClickPort {
  state?: string;
  send(bytes: number[], timestamp?: number): void;
}

export interface MidiClickDeps {
  settings(): MidiClickSettings;
  /** The output the click goes to: the one named by the settings, or undefined. */
  output(portId: string): ClickPort | undefined;
  start: typeof startMidiScheduler;
  now: typeof midiNow;
  /** Called when the click's own session fails. The cue session is not touched. */
  onFault(message: string): void;
  /** The origin of `now()`, to turn a due time into a Web MIDI timestamp. */
  timeOrigin(): number;
}

/** The heartbeat the click's scheduler session needs, and how long it idles before it is closed. */
const SYNC_MS = 50;
const IDLE_MS = 3000;

/**
 * Sends the player's clicks as MIDI. One scheduler session starts with the first click and ends a few seconds after the last, so the
 * worker only runs while the metronome or a count-in is sounding.
 */
export class MidiClick {
  private session: ReturnType<typeof startMidiScheduler> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private origin = 0;
  private lastClick = 0;
  /** The notes sent on and not yet off, as "channel:note", so a cancel can release them. */
  private held = new Map<string, ClickPort>();

  constructor(private deps: MidiClickDeps) {}

  /** Handles one click from the player: `audioNow` is the audio clock at this moment, to turn the click's audio time into clock time. */
  onClick(click: ClickEvent, audioNow: number): void {
    const settings = this.deps.settings();
    if (!settings.enabled || !settings.portId) return;
    const port = this.deps.output(settings.portId);
    if (!port || port.state === "disconnected") return;
    const due = this.deps.now() + (click.when - audioNow) * 1000 + settings.offsetMs;
    const session = this.session ?? this.begin(port, settings.portId);
    if (!session) return;
    this.lastClick = this.deps.now();
    session.addTimed(midiClickMessages(click.sound, click.beat, click.beats, settings.channel, due));
  }

  /** Starts the click's session: a schedule with no cues, whose worker sends the timed notes to `port`. */
  private begin(port: ClickPort, portId: string): ReturnType<typeof startMidiScheduler> | null {
    this.origin = this.deps.now();
    try {
      const session = this.deps.start(
        { cues: [], position: 0, duration: 24 * 60 * 60, origin: this.origin, bpm: 120, clock: false, tempo: null, lookahead: 0.2 },
        (message) => {
          // The output is read when the message is sent, so a changed choice or a removed port is followed.
          const current = this.deps.output(portId);
          if (current !== port) return;
          if (message.bytes[0] >= 0x90 && message.bytes[0] < 0xa0) this.held.set(`${message.bytes[0] & 15}:${message.bytes[1]}`, port);
          else this.held.delete(`${message.bytes[0] & 15}:${message.bytes[1]}`);
          port.send(message.bytes, message.due - this.deps.timeOrigin());
        },
        (error) => {
          this.close();
          this.deps.onFault(`MIDI click stopped: ${error}`);
        },
      );
      this.session = session;
      // The worker wants a position now and then; the click session's position is just the time since it began.
      this.timer = setInterval(() => {
        const now = this.deps.now();
        if (now - this.lastClick > IDLE_MS) this.close();
        else session.sync((now - this.origin) / 1000);
      }, SYNC_MS);
      return session;
    } catch (e) {
      this.deps.onFault(`MIDI click could not start: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.session?.stop();
    this.session = null;
  }

  /**
   * Stops sending (a pause, a changed song, a turned-off setting). Notes the worker has already handed to the output are released, so
   * none hangs. The output's queue is not cleared: it may be the one the cues use.
   */
  cancel(): void {
    this.close();
    for (const [key, port] of this.held) {
      const [channel, note] = key.split(":").map(Number);
      try {
        port.send([0x80 | channel, note, 0]);
      } catch {
        // The port went away; there is nothing left to release.
      }
    }
    this.held.clear();
  }
}
