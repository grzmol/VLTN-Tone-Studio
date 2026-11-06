import { describe, expect, it } from "vitest";
import { decodeMidiFile, encodeMidiFile, MAX_SMF_BYTES, midiFileFromOptions, parseSmf, smfCues } from "./smf";

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
