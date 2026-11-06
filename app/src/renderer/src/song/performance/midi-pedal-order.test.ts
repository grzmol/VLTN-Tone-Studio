import { describe, expect, it } from "vitest";
import { orderForPedal } from "./midi-pedal-order";

const order = (messages: number[][], pedalChannel: number | null | undefined = 16) => orderForPedal(messages, pedalChannel, (m) => m);

describe("orderForPedal", () => {
  it("sends the other pedal's program change before the GP-180's own, the H1 case", () => {
    expect(
      order([
        [0xc0 + 15, 68],
        [0xc0, 0],
      ]),
    ).toEqual([
      [0xc0, 0],
      [0xc0 + 15, 68],
    ]);
  });
  it("puts the other channels first and keeps bank select before its program change on the pedal channel", () => {
    const bank = [0xb0 + 15, 0, 1];
    const bankLsb = [0xb0 + 15, 32, 2];
    const program = [0xc0 + 15, 3];
    const other = [0xb0, 20, 64];
    expect(order([bank, bankLsb, program, other])).toEqual([other, bank, bankLsb, program]);
  });
  it("keeps the order inside each group", () => {
    const a = [0xb0, 1, 1];
    const b = [0xb0 + 15, 2, 2];
    const c = [0xb0 + 1, 3, 3];
    const d = [0xb0 + 15, 4, 4];
    expect(order([a, b, c, d])).toEqual([a, c, b, d]);
  });
  it("keeps SysEx and other channel-less messages ahead of the pedal channel, in their original order", () => {
    const sysex = [0xf0, 0x7d, 0x01, 0xf7];
    const clock = [0xf8];
    const pedal = [0xc0 + 15, 5];
    expect(order([pedal, sysex, clock])).toEqual([sysex, clock, pedal]);
  });
  it("does nothing when there is no pedal channel", () => {
    const messages = [
      [0xc0 + 15, 68],
      [0xc0, 0],
    ];
    expect(order(messages, null)).toEqual(messages);
    expect(orderForPedal(messages, undefined, (m) => m)).toEqual(messages);
  });
  it("uses the bytes accessor for messages that wrap them", () => {
    const items = [{ bytes: [0xc0 + 15, 68] }, { bytes: [0xc0, 0] }];
    expect(orderForPedal(items, 16, (item) => item.bytes)).toEqual([items[1], items[0]]);
  });
});
