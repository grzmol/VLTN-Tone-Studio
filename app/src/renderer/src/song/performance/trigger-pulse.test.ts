import { describe, expect, it } from "vitest";
import { TriggerPulses, TRIGGER_HOLD_MS } from "./trigger-pulse";

const press = [0xb1, 80, 127];
const release = [0xb1, 80, 0];
describe("momentary controller timing", () => {
  it("holds a same-time press for 100 ms before releasing, without moving the press", () => {
    const pulses = new TriggerPulses(),
      output = {};
    expect(pulses.timestamp(output, press, 1000, 900)).toBe(1000);
    expect(pulses.timestamp(output, release, 1000, 900)).toBe(1000 + TRIGGER_HOLD_MS);
  });
  it("holds immediate or already late messages from their actual send time", () => {
    const pulses = new TriggerPulses(),
      output = {};
    expect(pulses.timestamp(output, press, undefined, 1000)).toBeUndefined();
    expect(pulses.timestamp(output, release, undefined, 1001)).toBe(1100);
    expect(pulses.timestamp(output, press, 1900, 2000)).toBe(1900);
    expect(pulses.timestamp(output, release, 1900, 2000)).toBe(2100);
  });
  it("preserves an already long release and separates rapid retriggers in their original order", () => {
    const pulses = new TriggerPulses(),
      output = {};
    pulses.timestamp(output, press, 1000, 900);
    expect(pulses.timestamp(output, release, 1400, 900)).toBe(1400);
    expect(pulses.timestamp(output, press, 1400, 900)).toBe(1410);
    expect(pulses.timestamp(output, release, 1400, 900)).toBe(1510);
  });
  it("keeps outputs and controllers independent and leaves notes and continuous values unchanged", () => {
    const pulses = new TriggerPulses(),
      first = {},
      second = {};
    pulses.timestamp(first, press, 1000, 900);
    expect(pulses.timestamp(second, release, 1000, 900)).toBe(1000);
    expect(pulses.timestamp(first, [0xb1, 81, 0], 1000, 900)).toBe(1000);
    expect(pulses.timestamp(first, [0x91, 80, 0], undefined, 1000)).toBeUndefined();
    expect(pulses.timestamp(first, [0xb1, 80, 64], undefined, 1000)).toBeUndefined();
  });
  it("requeues a cancelled release after output.clear without releasing a future cancelled press", () => {
    const pulses = new TriggerPulses(),
      output = {};
    pulses.timestamp(output, press, 1000, 900);
    pulses.timestamp(output, release, 1000, 900);
    pulses.timestamp(output, [0xb1, 81, 127], 1200, 900);
    expect(pulses.releasesAfterClear(output, 1050)).toEqual([{ bytes: release, timestamp: 1100 }]);
    expect(pulses.timestamp(output, press, undefined, 1050)).toBe(1110);
    expect(pulses.timestamp(output, release, undefined, 1050)).toBe(1210);
    expect(pulses.releasesAfterClear(output, 1300)).toEqual([]);
  });
});

it("releases an active pulse when a later pulse on the same controller is cancelled", () => {
  const pulses = new TriggerPulses(),
    output = {};
  pulses.timestamp(output, press, 1000, 900);
  pulses.timestamp(output, release, 1000, 900);
  pulses.timestamp(output, press, 1200, 900);
  pulses.timestamp(output, release, 1200, 900);
  expect(pulses.releasesAfterClear(output, 1050)).toEqual([{ bytes: release, timestamp: 1100 }]);
  expect(pulses.timestamp(output, press, undefined, 1050)).toBe(1110);
});
