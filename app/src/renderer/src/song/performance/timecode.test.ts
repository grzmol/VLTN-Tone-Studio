import { describe, expect, it } from "vitest";
import { cycleFrames, formatOffset, framesAt, fullFrame, parseOffset, quarterFrame, splitFrames, timecodeOffsetFrames } from "./timecode";

/* 01:02:03:04 at 25 fps is (1 * 3600 + 2 * 60 + 3) * 25 + 4 = 93079 frames. Its pieces, worked by hand:
 *   piece 0 frame low 4 -> 04; piece 1 frame high 0 -> 10; piece 2 seconds low 3 -> 23; piece 3 seconds high 0 -> 30;
 *   piece 4 minutes low 2 -> 42; piece 5 minutes high 0 -> 50; piece 6 hours low 1 -> 61;
 *   piece 7 hours high 0 with rate code 1 (25 fps) in bits 1-2 -> 72. */
const ONE_TWO_THREE_FOUR = 93079;

describe("offsets", () => {
  it("counts an offset from 00:00:00:00", () => {
    expect(parseOffset("00:00:00:00", 25)).toEqual({ frames: 0 });
    expect(parseOffset("01:02:03:04", 25)).toEqual({ frames: ONE_TWO_THREE_FOUR });
    expect(parseOffset("00:00:01:00", 30)).toEqual({ frames: 30 });
    expect(parseOffset("00:01:00:00", 24)).toEqual({ frames: 1440 });
  });

  it("refuses a frame field at or above the rate", () => {
    expect(parseOffset("00:00:00:24", 24)).toEqual({ error: "Frames must be 0 to 23 at 24 fps." });
    expect(parseOffset("00:00:00:25", 25)).toEqual({ error: "Frames must be 0 to 24 at 25 fps." });
    expect(parseOffset("00:00:00:29", 30)).toEqual({ frames: 29 });
  });

  it("refuses out-of-range fields and bad text", () => {
    expect("error" in parseOffset("24:00:00:00", 25)).toBe(true);
    expect("error" in parseOffset("00:60:00:00", 25)).toBe(true);
    expect("error" in parseOffset("00:00:60:00", 25)).toBe(true);
    expect("error" in parseOffset("1:2:3", 25)).toBe(true);
    expect("error" in parseOffset("", 25)).toBe(true);
  });

  it("formats and wraps a frame count", () => {
    expect(formatOffset(ONE_TWO_THREE_FOUR, 25)).toBe("01:02:03:04");
    expect(splitFrames(24 * 3600 * 25 + 5, 25)).toEqual({ hours: 0, minutes: 0, seconds: 0, frame: 5 });
  });

  it("follows song position from the offset, and reads a negative position as zero", () => {
    expect(framesAt(0, ONE_TWO_THREE_FOUR, 25)).toBe(ONE_TWO_THREE_FOUR);
    expect(framesAt(1.04, 0, 25)).toBe(26);
    expect(framesAt(0.99999999999, 0, 25)).toBe(25);
    expect(framesAt(-3, 10, 25)).toBe(10);
  });
});

describe("full frame", () => {
  it("encodes the rate in the hours byte", () => {
    expect(fullFrame(ONE_TWO_THREE_FOUR, 25)).toEqual([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x21, 0x02, 0x03, 0x04, 0xf7]);
    expect(fullFrame(0, 24)).toEqual([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0xf7]);
    expect(fullFrame(0, 30)).toEqual([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x60, 0x00, 0x00, 0x00, 0xf7]);
  });
});

describe("quarter frames", () => {
  it("sends the eight pieces of 01:02:03:04 at 25 fps", () => {
    const pieces = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => quarterFrame(i, ONE_TWO_THREE_FOUR, 25));
    expect(pieces).toEqual([
      [0xf1, 0x04],
      [0xf1, 0x10],
      [0xf1, 0x23],
      [0xf1, 0x30],
      [0xf1, 0x42],
      [0xf1, 0x50],
      [0xf1, 0x61],
      [0xf1, 0x72],
    ]);
  });

  it("uses the 30 fps rate code (3) in piece 7", () => {
    expect(quarterFrame(7, 0, 30)).toEqual([0xf1, 0x76]);
    expect(quarterFrame(7, 0, 24)).toEqual([0xf1, 0x70]);
  });

  it("wraps the piece number after eight", () => {
    expect(quarterFrame(8, ONE_TWO_THREE_FOUR, 25)).toEqual(quarterFrame(0, ONE_TWO_THREE_FOUR, 25));
  });

  it("carries the frame count of its cycle, two frames on per cycle", () => {
    expect(cycleFrames(0, 100)).toBe(100);
    expect(cycleFrames(7, 100)).toBe(100);
    expect(cycleFrames(8, 100)).toBe(102);
    expect(cycleFrames(17, 100)).toBe(104);
  });

  it("gives a high frame nibble above 15 at 24 and 25 fps", () => {
    // Frame 20 at 25 fps: low nibble 4, high nibble 1.
    expect(quarterFrame(0, 20, 25)).toEqual([0xf1, 0x04]);
    expect(quarterFrame(1, 20, 25)).toEqual([0xf1, 0x11]);
  });
});

describe("the session's timecode choice", () => {
  it("is null while timecode is off, whatever the offset text", () => {
    expect(timecodeOffsetFrames({ enabled: false, fps: 25, offset: "99:99:99:99" })).toBeNull();
  });

  it("reads the offset at the rate, and an empty offset as zero", () => {
    expect(timecodeOffsetFrames({ enabled: true, fps: 25, offset: "01:02:03:04" })).toBe(ONE_TWO_THREE_FOUR);
    expect(timecodeOffsetFrames({ enabled: true, fps: 30, offset: "" })).toBe(0);
  });

  it("throws the reason when the offset is not valid at the rate", () => {
    expect(() => timecodeOffsetFrames({ enabled: true, fps: 24, offset: "00:00:00:24" })).toThrow("MIDI timecode offset: Frames must be 0 to 23 at 24 fps.");
  });
});
