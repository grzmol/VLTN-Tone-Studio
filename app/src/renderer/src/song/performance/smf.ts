import type { Cue } from "./chart";

/*
 * A song's MIDI file, read into timed messages. Times are song seconds at the file's own tempo map. The scheduler applies the song's rate,
 * so a file plays at the same speed as the audio, and a jump re-anchors it the same way it does the chart's cues.
 * Only what a live show sends is kept: channel messages, song select and SysEx. Meta events other than tempo are skipped, and so are
 * system real-time bytes, which would fight the app's own clock.
 */

/** A standard MIDI file is read whole. Show files are a few kilobytes; this cap stops a wrong file from freezing the app. */
export const MAX_SMF_BYTES = 2 * 1024 * 1024;
export const MAX_SMF_MESSAGES = 50_000;
/** The tempo before a file's first tempo change: 120 beats per minute, in microseconds per quarter note. */
const DEFAULT_TEMPO = 500_000;

export interface SmfMessage {
  /** Song seconds at the file's tempo, from the start of the file. */
  time: number;
  bytes: number[];
}

const TRUNCATED = "The MIDI file ends early. Export it again.";

class Cursor {
  pos = 0;
  constructor(
    private readonly data: Uint8Array,
    private readonly end = data.length,
  ) {}
  byte(): number {
    if (this.pos >= this.end) throw new Error(TRUNCATED);
    return this.data[this.pos++];
  }
  take(count: number): Uint8Array {
    if (this.pos + count > this.end) throw new Error(TRUNCATED);
    const bytes = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return bytes;
  }
  u16(): number {
    const high = this.byte();
    return (high << 8) | this.byte();
  }
  u32(): number {
    const high = this.u16();
    return high * 65536 + this.u16();
  }
  text(count: number): string {
    return String.fromCharCode(...this.take(count));
  }
  /** A variable-length quantity, at most four bytes as the format allows. */
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.byte();
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error("A MIDI file has a number that is too long.");
  }
}

const dataByte = (value: number): number => {
  if (value > 127) throw new Error("A MIDI file has a data byte above 127.");
  return value;
};

/** Parses a standard MIDI file (format 0 or 1, ticks per quarter note). Throws with a message a performer can act on. */
export function parseSmf(data: Uint8Array): SmfMessage[] {
  if (data.length > MAX_SMF_BYTES) throw new Error(`The MIDI file is larger than ${MAX_SMF_BYTES / 1024 / 1024} MB.`);
  const header = new Cursor(data);
  if (header.text(4) !== "MThd") throw new Error("This is not a standard MIDI file.");
  const headerLength = header.u32();
  if (headerLength < 6) throw new Error("The MIDI file header is damaged.");
  const format = header.u16(),
    trackCount = header.u16(),
    division = header.u16();
  header.take(headerLength - 6);
  if (format > 1) throw new Error("Format 2 MIDI files (independent sequences) are not supported. Export as format 0 or 1.");
  if (division & 0x8000) throw new Error("SMPTE timing is not supported. Export with ticks per beat.");
  if (division === 0) throw new Error("The MIDI file has no ticks per beat.");
  if (trackCount < 1 || trackCount > 256) throw new Error("The MIDI file has an unsupported number of tracks.");

  const events: { tick: number; bytes: number[] }[] = [],
    tempos: { tick: number; microseconds: number }[] = [];
  const body = new Cursor(data, data.length);
  body.pos = header.pos;
  for (let track = 1; track <= trackCount; track++) {
    if (body.text(4) !== "MTrk") throw new Error(`Track ${track} is missing its header.`);
    const size = body.u32();
    if (body.pos + size > data.length) throw new Error(`Track ${track} is cut short.`);
    const end = body.pos + size,
      cursor = new Cursor(data, end);
    cursor.pos = body.pos;
    let tick = 0,
      running = 0;
    while (cursor.pos < end) {
      tick += cursor.vlq();
      let status = cursor.byte();
      if (status < 0x80) {
        if (!running) throw new Error(`Track ${track} uses running status before any status byte.`);
        cursor.pos--;
        status = running;
      }
      if (status === 0xff) {
        const type = cursor.byte(),
          payload = cursor.take(cursor.vlq());
        if (type === 0x51) {
          if (payload.length !== 3) throw new Error("A tempo event in the MIDI file is damaged.");
          tempos.push({ tick, microseconds: (payload[0] << 16) | (payload[1] << 8) | payload[2] });
        }
        if (type === 0x2f) cursor.pos = end;
        running = 0;
      } else if (status === 0xf0 || status === 0xf7) {
        const payload = cursor.take(cursor.vlq());
        // An escaped (0xF7) packet is data for another device, not a message to send.
        if (status === 0xf0) {
          const sysex = payload.at(-1) === 0xf7 ? payload.subarray(0, -1) : payload;
          sysex.forEach(dataByte);
          events.push({ tick, bytes: [0xf0, ...sysex, 0xf7] });
        }
        running = 0;
      } else if (status === 0xf3) {
        events.push({ tick, bytes: [0xf3, dataByte(cursor.byte())] });
        running = 0;
      } else if (status >= 0xf0) {
        // Other system common and real-time bytes are not sent; skip their data so the track stays in step.
        const skip = status === 0xf1 ? 1 : status === 0xf2 ? 2 : 0;
        cursor.take(skip);
        running = 0;
      } else {
        const count = status >= 0xc0 && status < 0xe0 ? 1 : 2;
        const bytes = [status];
        for (let i = 0; i < count; i++) bytes.push(dataByte(cursor.byte()));
        events.push({ tick, bytes });
        running = status;
      }
      if (events.length > MAX_SMF_MESSAGES) throw new Error(`The MIDI file has more than ${MAX_SMF_MESSAGES} messages.`);
    }
    body.pos = end;
  }
  return timed(events, tempos, division);
}

/** Converts ticks to seconds through the tempo map, then sorts the messages by time. The sort is stable, so simultaneous messages keep their order. */
function timed(events: { tick: number; bytes: number[] }[], tempos: { tick: number; microseconds: number }[], division: number): SmfMessage[] {
  const segments = [{ tick: 0, microseconds: DEFAULT_TEMPO, seconds: 0 }];
  for (const tempo of [...tempos].sort((a, b) => a.tick - b.tick)) {
    const last = segments[segments.length - 1];
    if (tempo.tick === last.tick) {
      last.microseconds = tempo.microseconds;
      continue;
    }
    const seconds = last.seconds + ((tempo.tick - last.tick) * last.microseconds) / (division * 1_000_000);
    segments.push({ tick: tempo.tick, microseconds: tempo.microseconds, seconds });
  }
  const secondsAt = (tick: number): number => {
    let segment = segments[0];
    for (const next of segments) if (next.tick <= tick) segment = next;
    return segment.seconds + ((tick - segment.tick) * segment.microseconds) / (division * 1_000_000);
  };
  return events
    .sort((a, b) => a.tick - b.tick)
    .map((event) => ({ time: secondsAt(event.tick), bytes: event.bytes }));
}

/** The cues a MIDI file adds to a song: one per message, flagged so the cue builder and reader leave them out. */
export function smfCues(data: Uint8Array): Cue[] {
  return parseSmf(data).map((message) => ({ time: message.time, text: "", messages: [message.bytes], fromFile: true }));
}

/** A MIDI file kept in a song's options. The bytes are base64, so the option stays plain JSON. */
export interface MidiFileOption {
  name: string;
  data: string;
}

export function encodeMidiFile(name: string, bytes: Uint8Array): MidiFileOption {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: name.slice(0, 200), data: btoa(binary) };
}

export function decodeMidiFile(file: MidiFileOption): Uint8Array {
  try {
    return Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("The MIDI file saved with this song is damaged. Attach it again.");
  }
}

/** The MIDI file saved in a song's options, or null. Anything that is not the saved shape is ignored. */
export function midiFileFromOptions(options: object): MidiFileOption | null {
  const file: unknown = "midiFile" in options ? options.midiFile : undefined;
  if (!file || typeof file !== "object" || !("name" in file) || !("data" in file)) return null;
  return typeof file.name === "string" && typeof file.data === "string" ? { name: file.name, data: file.data } : null;
}
