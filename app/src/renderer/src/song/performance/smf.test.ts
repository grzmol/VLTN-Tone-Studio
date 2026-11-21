import { describe, expect, it } from "vitest";
import { decodeMidiFile, encodeDrumSmf, encodeMidiFile, encodeSmf, MAX_SMF_BYTES, midiFileFromOptions, parseSmf, smfCues } from "./smf";
import { fixedBeatGrid, type BeatGrid } from "../band/beat-grid";
import type { NoteEvent } from "../band/note";

/** Builds a standard MIDI file from tracks of [delta ticks, ...message bytes] events. Each track ends with an end-of-track meta event. */
function smf(format: number, division: number, tracks: number[][][], raw: number[][] = []): Uint8Array {
  const vlq = (value: number) => {
    const bytes = [value & 127];
    for (let rest = value >> 7; rest; rest >>= 7) bytes.unshift((rest & 127) | 128);
    return bytes;
  };
  const u16 = (value: number) => [value >> 8, value & 255];
  const u32 = (value: number) => [value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255];
  const chunks = tracks.map((events) => {
    const data = [...events.flatMap(([delta, ...bytes]) => [...vlq(delta), ...bytes]), 0, 0xff, 0x2f, 0];
    return [...Array.from("MTrk", (c) => c.charCodeAt(0)), ...u32(data.length), ...data];
  });
  const header = [...Array.from("MThd", (c) => c.charCodeAt(0)), 0, 0, 0, 6, ...u16(format), ...u16(tracks.length), ...u16(division)];
  return new Uint8Array([...header, ...chunks.flat(), ...raw.flat()]);
}

const tempo = (microseconds: number) => [0xff, 0x51, 3, (microseconds >> 16) & 255, (microseconds >> 8) & 255, microseconds & 255];

describe("single-track drum MIDI", () => {
  it("writes format 0, musical metadata, ordered notes and a whole-bar endpoint after silence", () => {
    const file = encodeDrumSmf([{ tick: 0, duration: 96, pitch: 36, velocity: 100 }], 120, 4, 4, 3840);
    expect(Array.from(file.slice(0, 14))).toEqual([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]);
    expect(new TextDecoder().decode(file.slice(14, 18))).toBe("MTrk");
    expect(new DataView(file.buffer).getUint32(18)).toBe(file.length - 22);
    // Independent byte-level check: final delta is 3840 - 96 = 3744 ticks, including the silent second bar.
    expect(Array.from(file.slice(22))).toEqual([0, 255, 88, 4, 4, 2, 24, 8, 0, 255, 81, 3, 7, 161, 32, 0, 153, 36, 100, 96, 137, 36, 0, 157, 32, 255, 47, 0]);
  });
  it("writes true 6/8 metadata and quarter-note tempo", () => {
    const file = encodeDrumSmf([], 150, 6, 8, 1440);
    expect(Array.from(file.slice(22, 37))).toEqual([0, 255, 88, 4, 6, 3, 36, 8, 0, 255, 81, 3, 6, 26, 128]);
    expect(Array.from(file.slice(37))).toEqual([139, 32, 255, 47, 0]);
  });
  it("places note-offs before repeated note-ons at the same tick", () => {
    const file = encodeDrumSmf(
      [
        { tick: 0, duration: 240, pitch: 38, velocity: 99 },
        { tick: 240, duration: 240, pitch: 38, velocity: 80 },
      ],
      120,
      4,
      4,
      1920,
    );
    expect(parseSmf(file).map((message) => message.bytes[0])).toEqual([0x99, 0x89, 0x99, 0x89]);
  });
  it("rejects invalid MIDI values and events beyond the declared endpoint", () => {
    const note = { tick: 0, duration: 96, pitch: 36, velocity: 100 };
    for (const bad of [
      { ...note, tick: NaN },
      { ...note, velocity: 0 },
      { ...note, duration: 2000 },
      { ...note, pitch: 200 },
    ]) {
      expect(() => encodeDrumSmf([bad], 120, 4, 4, 1920)).toThrow("drum hit");
    }
    expect(() => encodeDrumSmf([], 0, 4, 4, 1920)).toThrow("tempo");
    expect(() => encodeDrumSmf([], 120, 4, 3, 1920)).toThrow("time signature");
    expect(() => encodeDrumSmf([], 120, 4, 4, Infinity)).toThrow("length");
  });
});

describe("standard MIDI files", () => {
  it("places messages in seconds at the default 120 BPM", () => {
    const messages = parseSmf(
      smf(0, 480, [
        [
          [0, 0x90, 60, 100],
          [480, 0x80, 60, 0],
          [480, 0xc0, 5],
        ],
      ]),
    );
    expect(messages).toEqual([
      { time: 0, bytes: [0x90, 60, 100] },
      { time: 0.5, bytes: [0x80, 60, 0] },
      { time: 1, bytes: [0xc0, 5] },
    ]);
  });
  it("follows a tempo change in the middle of the file", () => {
    // Half a second at 120 BPM, then a second per beat from tick 480 on.
    const messages = parseSmf(
      smf(0, 480, [
        [
          [0, ...tempo(500_000)],
          [480, ...tempo(1_000_000)],
          [0, 0xb0, 7, 100],
          [480, 0xb0, 7, 0],
        ],
      ]),
    );
    expect(messages.map((m) => m.time)).toEqual([0.5, 1.5]);
  });
  it("merges tracks of a format 1 file in time order", () => {
    const messages = parseSmf(
      smf(1, 96, [
        [
          [0, ...tempo(500_000)],
          [96, 0xb0, 1, 1],
        ],
        [
          [48, 0xc0, 2],
          [48, 0xc0, 3],
        ],
      ]),
    );
    expect(messages).toEqual([
      { time: 0.25, bytes: [0xc0, 2] },
      { time: 0.5, bytes: [0xb0, 1, 1] },
      { time: 0.5, bytes: [0xc0, 3] },
    ]);
  });
  it("reads running status and skips meta events other than tempo", () => {
    const data = smf(0, 96, [
      [
        [0, 0xb0, 1, 10],
        [0, 0xb0, 1, 11],
      ],
    ]);
    expect(parseSmf(data).map((m) => m.bytes)).toEqual([
      [0xb0, 1, 10],
      [0xb0, 1, 11],
    ]);
    const withText = smf(0, 96, [
      [
        [0, 0xff, 1, 2, 104, 105],
        [0, 0x90, 60, 90],
      ],
    ]);
    expect(parseSmf(withText)).toEqual([{ time: 0, bytes: [0x90, 60, 90] }]);
  });
  it("keeps SysEx with or without its terminating F7 and song select, and drops real-time bytes", () => {
    const file = smf(0, 96, [
      [
        [0, 0xf0, 3, 0x7d, 1, 0xf7],
        [0, 0xf0, 2, 0x7d, 1],
        [0, 0xf3, 4],
        [0, 0xf8],
      ],
    ]);
    expect(parseSmf(file).map((m) => m.bytes)).toEqual([
      [0xf0, 0x7d, 1, 0xf7],
      [0xf0, 0x7d, 1, 0xf7],
      [0xf3, 4],
    ]);
  });
  it("turns each message into a flagged cue for the scheduler", () => {
    const cues = smfCues(smf(0, 96, [[[96, 0x90, 60, 90]]]));
    // 96 ticks per beat at the default 120 BPM is half a second.
    expect(cues).toEqual([{ time: 0.5, text: "", messages: [[0x90, 60, 90]], fromFile: true }]);
  });
  it("rejects files it cannot play, with a message that says why", () => {
    expect(() => parseSmf(new Uint8Array([1, 2, 3, 4]))).toThrow("not a standard MIDI file");
    expect(() => parseSmf(smf(2, 96, [[[0, 0x90, 60, 90]]]))).toThrow(/Format 2/);
    expect(() => parseSmf(smf(0, 0x8000 | 25, [[[0, 0x90, 60, 90]]]))).toThrow(/SMPTE/);
    expect(() => parseSmf(smf(0, 96, [[[0, 0x90, 60, 200]]]))).toThrow(/above 127/);
    expect(() => parseSmf(smf(0, 96, [[[0, 0x90, 60]]]))).toThrow(/ends early|cut short/);
    expect(() => parseSmf(smf(0, 96, [[[0, 0x90, 60, 90]]]).slice(0, 26))).toThrow(/cut short|ends early/);
    expect(() => parseSmf(smf(0, 96, [[[0, 0x90, 60, 90]]]).slice(0, 14))).toThrow(/ends early/);
    expect(() => parseSmf(smf(0, 96, [[[0, 0xff, 0x51, 2, 1, 2]]]))).toThrow(/tempo event/);
    expect(() => parseSmf(smf(0, 96, [[[0, 0x40, 1]]]))).toThrow(/running status/);
  });
  it("refuses a file larger than the cap, and one with too many messages", () => {
    expect(() => parseSmf(new Uint8Array(MAX_SMF_BYTES + 1))).toThrow(/larger than 2 MB/);
    const many = Array.from({ length: 50_001 }, () => [0, 0x90, 60, 1] as number[]);
    expect(() => parseSmf(smf(0, 96, [many]))).toThrow(/more than 50000 messages/);
  });
});

describe("MIDI file option", () => {
  it("round-trips the bytes through the song's options", () => {
    const bytes = smf(0, 96, [[[0, 0xb0, 1, 2]]]);
    const option = encodeMidiFile("intro.mid", bytes);
    expect(midiFileFromOptions({ midiFile: option })).toEqual(option);
    expect(Array.from(decodeMidiFile(option))).toEqual(Array.from(bytes));
  });
  it("ignores options that are not the saved shape, and reports damaged data", () => {
    expect(midiFileFromOptions({ midiFile: "x" })).toBeNull();
    expect(midiFileFromOptions({})).toBeNull();
    expect(() => decodeMidiFile({ name: "x.mid", data: "%%%" })).toThrow(/damaged/);
  });
});

describe("exporting a standard MIDI file", () => {
  /** A beat grid whose beats follow the given intervals, from time 0. */
  function gridOf(intervals: number[], beatsPerBar = 4): BeatGrid {
    const beats = [0];
    for (const interval of intervals) beats.push(beats[beats.length - 1] + interval);
    return { beatsPerBar, beats, downbeat: 0, bpm: 60 / intervals[0], steady: null };
  }
  /** Sixty beats whose interval grows by 0.2% a beat: a drift too small for one tempo change a beat, but large over the song. */
  const drifting = gridOf(Array.from({ length: 60 }, (_, beat) => 0.5 * (1 + 0.002 * beat)));
  const steady = fixedBeatGrid(120, 0, 4, 30);
  const note = (time: number, pitch: number, duration = 0.2, velocity = 100): NoteEvent => ({ time, pitch, velocity, duration });

  /** The file's bytes that match a pattern, counted. Tempo and time signature meta events are the only bytes that start with 0xFF there. */
  function countOf(bytes: Uint8Array, pattern: number[]): number {
    let count = 0;
    for (let i = 0; i + pattern.length <= bytes.length; i++) if (pattern.every((byte, j) => bytes[i + j] === byte)) count++;
    return count;
  }

  it("round-trips note on and off times within 1 ms on a steady grid", () => {
    const times = [0.25, 1.1, 2.5, 7.333];
    const file = encodeSmf([{ name: "Bass", channel: 0, notes: times.map((time, i) => note(time, 40 + i)) }], steady);
    const messages = parseSmf(file);
    times.forEach((time, i) => {
      const on = messages.find((m) => m.bytes[0] === 0x90 && m.bytes[1] === 40 + i);
      const off = messages.find((m) => m.bytes[0] === 0x80 && m.bytes[1] === 40 + i);
      expect(on?.time).toBeGreaterThan(time - 0.001);
      expect(on?.time).toBeLessThan(time + 0.001);
      expect(off?.time).toBeGreaterThan(time + 0.2 - 0.001);
      expect(off?.time).toBeLessThan(time + 0.2 + 0.001);
    });
  });

  it("round-trips within 2 ms on a drifting grid", () => {
    const times = [0.3, 5.1, 12.7, 25.9];
    const file = encodeSmf([{ name: "Drums", channel: 9, notes: times.map((time, i) => note(time, 36 + i)) }], drifting);
    const messages = parseSmf(file);
    times.forEach((time, i) => {
      const on = messages.find((m) => m.bytes[0] === 0x99 && m.bytes[1] === 36 + i);
      expect(Math.abs((on?.time ?? NaN) - time)).toBeLessThan(0.002);
    });
  });

  it("puts each track on its own channel, with notes-off on the same channel", () => {
    const file = encodeSmf(
      [
        { name: "Drums", channel: 9, notes: [note(0.5, 36)] },
        { name: "Bass", channel: 0, notes: [note(1, 40)] },
      ],
      steady,
    );
    const messages = parseSmf(file).filter((m) => m.bytes.length === 3);
    expect(messages.map((m) => m.bytes)).toEqual([
      [0x99, 36, 100],
      [0x89, 36, 0],
      [0x90, 40, 100],
      [0x80, 40, 0],
    ]);
  });

  it("writes a tempo only once for a steady grid, and again whenever a drifting grid moves past half a percent", () => {
    expect(countOf(encodeSmf([], steady), [0xff, 0x51, 3])).toBe(1);
    expect(countOf(encodeSmf([], drifting), [0xff, 0x51, 3])).toBeGreaterThan(5);
  });

  it("writes the time signature from the beats per bar", () => {
    const fourFour = encodeSmf([], steady);
    expect(countOf(fourFour, [0xff, 0x58, 4, 4, 2, 24, 8])).toBe(1);
    const threeFour = encodeSmf([], fixedBeatGrid(120, 0, 3, 30));
    expect(countOf(threeFour, [0xff, 0x58, 4, 3, 2, 24, 8])).toBe(1);
  });

  it("is format 1, with a conductor track and one track per part, each ending with end-of-track", () => {
    const file = encodeSmf(
      [
        { name: "Drums", channel: 9, notes: [note(1, 36)] },
        { name: "Bass", channel: 0, notes: [] },
      ],
      steady,
    );
    expect(Array.from(file.slice(0, 14))).toEqual([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, 1, 0xe0]);
    expect(countOf(file, [0xff, 0x2f, 0])).toBe(3);
  });
  it("writes a pitch-bend ramp into a slide before its note, and resets the bend after the note", () => {
    const slide: NoteEvent = { time: 1, pitch: 40, velocity: 100, duration: 0.3, slideFrom: 2 };
    const messages = parseSmf(encodeSmf([{ name: "Bass", channel: 0, notes: [slide] }], steady));
    const bends = messages.filter((message) => (message.bytes[0] & 0xf0) === 0xe0);
    const values = bends.map((message) => message.bytes[1] | (message.bytes[2] << 7));
    // Eight steps from two semitones down (0) up to centre (8192), then the reset to centre after the note.
    expect(values).toHaveLength(10);
    expect(values[0]).toBe(0);
    expect(values[8]).toBe(8192);
    expect(values.slice(0, 9)).toEqual([...values.slice(0, 9)].sort((a, b) => a - b));
    expect(values[9]).toBe(8192);
    const noteOn = messages.find((message) => (message.bytes[0] & 0xf0) === 0x90)!;
    const noteOff = messages.find((message) => (message.bytes[0] & 0xf0) === 0x80)!;
    expect(bends[0].time).toBeLessThan(noteOn.time);
    expect(bends[9].time).toBeGreaterThanOrEqual(noteOff.time - 1e-6);
  });

  it("writes no pitch bend for a note that does not slide", () => {
    const messages = parseSmf(encodeSmf([{ name: "Bass", channel: 0, notes: [note(1, 40)] }], steady));
    expect(messages.filter((message) => (message.bytes[0] & 0xf0) === 0xe0)).toEqual([]);
  });
});
