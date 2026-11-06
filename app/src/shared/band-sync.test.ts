import { describe, expect, it } from "vitest";
import { BAND_SYNC_LIMITS, isFollowerAction, parseClientMessage, parseServerMessage, parseSyncPort } from "./band-sync";

/** The message a follower sends, as text. */
const text = (value: unknown) => JSON.stringify(value);

describe("parseClientMessage", () => {
  it("accepts each shape a follower sends", () => {
    expect(parseClientMessage(text({ type: "hello", pin: "123456" }))).toEqual({ type: "hello", pin: "123456" });
    const token = "abcdefghijklmnopQRSTUV-_0123";
    expect(parseClientMessage(text({ type: "hello", token }))).toEqual({ type: "hello", token });
    expect(parseClientMessage(text({ type: "ping", seq: 3, t0: 1700000000000.5 }))).toEqual({ type: "ping", seq: 3, t0: 1700000000000.5 });
    expect(parseClientMessage(text({ type: "control", action: "transport.stop" }))).toEqual({ type: "control", action: "transport.stop" });
  });

  it("drops fields it does not know rather than passing them on", () => {
    expect(parseClientMessage(text({ type: "ping", seq: 1, t0: 5, extra: "x" }))).toEqual({ type: "ping", seq: 1, t0: 5 });
  });

  it("refuses a frame over the limit before it is parsed", () => {
    const padded = text({ type: "ping", seq: 1, t0: 1, pad: "x".repeat(BAND_SYNC_LIMITS.frameBytes) });
    expect(() => parseClientMessage(padded)).toThrow(/too large/);
  });

  it("counts bytes, not characters", () => {
    // Each of these is one character but several bytes, so the frame is over the limit by bytes alone.
    const pad = "é".repeat(Math.ceil(BAND_SYNC_LIMITS.frameBytes / 2));
    expect(() => parseClientMessage(text({ type: "ping", seq: 1, t0: 1, pad }))).toThrow(/too large/);
  });

  it("refuses text that is not JSON, and JSON that is not an object", () => {
    expect(() => parseClientMessage("{not json")).toThrow(/not JSON/);
    expect(() => parseClientMessage("[1,2]")).toThrow(/must be an object/);
    expect(() => parseClientMessage("null")).toThrow(/must be an object/);
    expect(() => parseClientMessage('"hello"')).toThrow(/must be an object/);
  });

  it("refuses an unknown message type", () => {
    expect(() => parseClientMessage(text({ type: "loadSong", id: "x" }))).toThrow(/not known/);
    expect(() => parseClientMessage(text({ pin: "123456" }))).toThrow(/not known/);
  });

  it("accepts only a PIN of exactly six digits", () => {
    for (const pin of ["12345", "1234567", "12345a", " 123456", "123 456", "", 123456]) {
      expect(() => parseClientMessage(text({ type: "hello", pin }))).toThrow();
    }
  });

  it("needs exactly one of a PIN or a session", () => {
    expect(() => parseClientMessage(text({ type: "hello" }))).toThrow(/PIN or a session/);
    expect(() => parseClientMessage(text({ type: "hello", pin: "123456", token: "abcdefghijklmnop" }))).toThrow(/not both/);
  });

  it("refuses a session that is too short or has characters a token never has", () => {
    expect(() => parseClientMessage(text({ type: "hello", token: "short" }))).toThrow(/session is not valid/);
    expect(() => parseClientMessage(text({ type: "hello", token: "abcdefghijklmnop<script>" }))).toThrow(/session is not valid/);
    expect(() => parseClientMessage(text({ type: "hello", token: "a".repeat(129) }))).toThrow(/session is not valid/);
  });

  it("refuses a ping whose numbers are not numbers", () => {
    expect(() => parseClientMessage(text({ type: "ping", seq: "1", t0: 1 }))).toThrow(/ping number/);
    expect(() => parseClientMessage(text({ type: "ping", seq: -1, t0: 1 }))).toThrow(/ping number/);
    expect(() => parseClientMessage(text({ type: "ping", seq: 1.5, t0: 1 }))).toThrow(/ping number/);
    expect(() => parseClientMessage(text({ type: "ping", seq: 1, t0: "1" }))).toThrow(/ping time/);
    expect(() => parseClientMessage(text({ type: "ping", seq: 1 }))).toThrow(/ping time/);
  });

  it("refuses any action a follower may not run, including the performer's own actions", () => {
    for (const action of ["transport.loadSong", "midi.arm", "song.next", "section.jump", "transport", "", undefined]) {
      expect(() => parseClientMessage(text({ type: "control", action }))).toThrow(/not one a follower can run/);
    }
  });
});

describe("isFollowerAction", () => {
  it("is true for the three transport actions only", () => {
    expect(isFollowerAction("transport.play")).toBe(true);
    expect(isFollowerAction("transport.playPause")).toBe(true);
    expect(isFollowerAction("transport.stop")).toBe(true);
    expect(isFollowerAction("transport.panic")).toBe(false);
    expect(isFollowerAction(1)).toBe(false);
  });
});

describe("parseSyncPort", () => {
  it("accepts a whole port in range", () => {
    expect(parseSyncPort(BAND_SYNC_LIMITS.defaultPort)).toBe(8787);
    expect(parseSyncPort(1024)).toBe(1024);
    expect(parseSyncPort(65535)).toBe(65535);
  });

  it("refuses a port that is privileged, out of range, fractional or text", () => {
    for (const port of [80, 1023, 65536, 0, 8787.5, "8787", NaN, null]) {
      expect(() => parseSyncPort(port)).toThrow(/Choose a port/);
    }
  });
});

describe("parseServerMessage", () => {
  it("reads an object with a type and ignores anything else", () => {
    expect(parseServerMessage(text({ type: "pong", seq: 1, t0: 1, t1: 2, t2: 3 }))).toEqual({ type: "pong", seq: 1, t0: 1, t1: 2, t2: 3 });
    expect(parseServerMessage("not json")).toBeNull();
    expect(parseServerMessage("[]")).toBeNull();
    expect(parseServerMessage(text({ seq: 1 }))).toBeNull();
  });
});
