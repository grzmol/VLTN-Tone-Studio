import { describe, expect, it } from "vitest";
import { BleMidiDecoder, BlePacketBuilder, encodeBleMidi } from "./ble-midi";

describe("BLE-MIDI wire framing", () => {
  it("encodes channel messages and a 13-bit timestamp including wrap", () => {
    expect([...encodeBleMidi([0xc0, 5], 129)[0]]).toEqual([0x81, 0x81, 0xc0, 5]);
    expect([...encodeBleMidi([0xf8], 8192)[0]]).toEqual([0x80, 0x80, 0xf8]);
    for (const bytes of [
      [1, 2, 3],
      [0x90, 60],
      [0xc0, 128],
      [0xf0, 1],
      [0xf0, 128, 0xf7],
    ])
      expect(() => encodeBleMidi(bytes)).toThrow();
  });
  it("decodes multiple timestamped messages and running status", () => {
    const decoder = new BleMidiDecoder();
    expect(decoder.decode(Uint8Array.from([0x80, 0x81, 0x90, 60, 100, 61, 90, 0x82, 62, 80, 0x83, 0xc0, 7])).map((b) => [...b])).toEqual([
      [0x90, 60, 100],
      [0x90, 61, 90],
      [0x90, 62, 80],
      [0xc0, 7],
    ]);
  });
  it("reassembles SysEx notifications and separates real-time events", () => {
    const decoder = new BleMidiDecoder();
    expect(decoder.decode(Uint8Array.from([0x80, 0x80, 0xf0, 1, 2]))).toEqual([]);
    expect(decoder.decode(Uint8Array.from([0x80, 3, 0x81, 0xf8, 4])).map((b) => [...b])).toEqual([[0xf8]]);
    expect(decoder.decode(Uint8Array.from([0x80, 5, 0x82, 0xf7])).map((b) => [...b])).toEqual([[0xf0, 1, 2, 3, 4, 5, 0xf7]]);
  });
  it("handles real-time events interrupting a channel message", () => {
    expect(new BleMidiDecoder().decode(Uint8Array.from([0x80, 0x80, 0x90, 60, 0x81, 0xf8, 100])).map((b) => [...b])).toEqual([[0xf8], [0x90, 60, 100]]);
  });
  it("fragments large SysEx at the default MTU without truncation", () => {
    for (const length of [0, 16, 17, 18, 35, 1260]) {
      const message = [0xf0, ...Array.from({ length }, (_, i) => i % 128), 0xf7];
      const packets = encodeBleMidi(message, 1234);
      expect(packets.every((p) => p.length <= 20)).toBe(true);
      const decoder = new BleMidiDecoder();
      expect(packets.flatMap((p) => decoder.decode(p)).map((b) => [...b])).toEqual([message]);
    }
  });
  it("drops malformed or incomplete messages and resets partial SysEx", () => {
    const decoder = new BleMidiDecoder();
    decoder.decode(Uint8Array.from([0x80, 0x80, 0xf0, 1]));
    decoder.decode(Uint8Array.from([0, 2, 3]));
    expect(decoder.decode(Uint8Array.from([0x80, 0x80, 0xc0, 5])).map((b) => [...b])).toEqual([[0xc0, 5]]);
    expect(decoder.decode(Uint8Array.from([0x80, 0x80, 0x90, 60]))).toEqual([]);
  });
});

describe("BlePacketBuilder", () => {
  const decodeAll = (packets: Uint8Array[]) => {
    const decoder = new BleMidiDecoder();
    return packets.flatMap((p) => decoder.decode(p)).map((b) => [...b]);
  };
  it("packs several messages into one packet with a timestamp before each", () => {
    const builder = new BlePacketBuilder();
    builder.add([0xf8], 129);
    builder.add([0xc0, 5], 130);
    builder.add([0xf8], 131);
    const packets = builder.flush();
    expect(packets.map((p) => [...p])).toEqual([[0x81, 0x81, 0xf8, 0x82, 0xc0, 5, 0x83, 0xf8]]);
    expect(decodeAll(packets)).toEqual([[0xf8], [0xc0, 5], [0xf8]]);
  });
  it("starts a new packet when the next message does not fit", () => {
    const builder = new BlePacketBuilder();
    for (let i = 0; i < 10; i++) builder.add([0xf8], i);
    const packets = builder.flush();
    expect(packets.every((p) => p.length <= 20)).toBe(true);
    expect(packets.length).toBe(2);
    expect(decodeAll(packets)).toEqual(Array.from({ length: 10 }, () => [0xf8]));
  });
  it("starts a new packet when the timestamp high bits change or the low bits go backwards", () => {
    const builder = new BlePacketBuilder();
    builder.add([0xf8], 127);
    builder.add([0xf8], 128);
    builder.add([0xf8], 130);
    builder.add([0xf8], 129);
    expect(builder.flush().map((p) => [...p])).toEqual([
      [0x80, 0xff, 0xf8],
      [0x81, 0x80, 0xf8, 0x82, 0xf8],
      [0x81, 0x81, 0xf8],
    ]);
  });
  it("lets SysEx follow other messages and continue across packets without losing order", () => {
    const sysex = [0xf0, ...Array.from({ length: 40 }, (_, i) => i), 0xf7];
    const builder = new BlePacketBuilder();
    builder.add([0xc0, 1], 10);
    builder.add(sysex, 10);
    builder.add([0xc0, 2], 10);
    const packets = builder.flush();
    expect(packets.every((p) => p.length <= 20)).toBe(true);
    expect(decodeAll(packets)).toEqual([[0xc0, 1], sysex, [0xc0, 2]]);
  });
  it("round-trips a mixed stream at several packet sizes and resets after flush", () => {
    const messages = [[0xb0, 7, 100], [0xf8], [0xf0, 1, 2, 3, 0xf7], [0xc1, 9], [0xf0, 0xf7], [0xfa], [0xf8]];
    for (const mtu of [5, 7, 20, 64]) {
      const builder = new BlePacketBuilder(mtu);
      messages.forEach((m, i) => builder.add(m, 1000 + i));
      const packets = builder.flush();
      expect(packets.every((p) => p.length <= mtu)).toBe(true);
      expect(decodeAll(packets)).toEqual(messages);
      expect(builder.flush()).toEqual([]);
    }
  });
  it("rejects invalid messages and sizes without corrupting the pending packet", () => {
    expect(() => new BlePacketBuilder(4)).toThrow();
    const builder = new BlePacketBuilder();
    builder.add([0xc0, 1], 0);
    expect(() => builder.add([0x90, 60], 0)).toThrow();
    expect(decodeAll(builder.flush())).toEqual([[0xc0, 1]]);
  });
});
