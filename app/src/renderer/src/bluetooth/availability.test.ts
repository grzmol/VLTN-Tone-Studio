import { describe, expect, it } from "vitest";
import { bluetoothOffered } from "./availability";

const withBluetooth = { bluetooth: {} };

describe("bluetoothOffered", () => {
  it("is on for the GP-150 and GP-180 when Web Bluetooth exists", () => {
    expect(bluetoothOffered("gp150", withBluetooth)).toBe(true);
    expect(bluetoothOffered("gp180", withBluetooth)).toBe(true);
  });

  it("is off for the other pedals", () => {
    for (const device of ["gp5", "gp50", "gp200", "gp200lt", "gp200jr"] as const) expect(bluetoothOffered(device, withBluetooth)).toBe(false);
  });

  it("is off when no pedal is known", () => {
    expect(bluetoothOffered(null, withBluetooth)).toBe(false);
  });

  it("is off in a browser without Web Bluetooth", () => {
    expect(bluetoothOffered("gp180", {})).toBe(false);
    expect(bluetoothOffered("gp150", undefined)).toBe(false);
  });
});
