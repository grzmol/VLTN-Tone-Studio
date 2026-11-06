import { describe, expect, it } from "vitest";
import { buildReport, type ReportInput } from "./report";

const base: ReportInput = {
  appVersion: "0.9.0",
  platform: "darwin",
  host: null,
  checks: [],
  status: "connected",
  mode: "webmidi",
  portName: "Valeton GP-180 MIDI",
  device: "gp180",
  connectionError: null,
  lastError: null,
  monitor: null,
  logFolder: null,
  now: 0,
};

describe("diagnostic report", () => {
  it("leaves the Bluetooth lines out when the caller has nothing to report", () => {
    expect(buildReport(base)).not.toContain("Bluetooth");
  });

  it("lists the Bluetooth link and the counters of the last session", () => {
    const report = buildReport({
      ...base,
      bluetooth: { available: true, connecting: false, name: "GP-180", state: "connected", error: null },
      bluetoothDiagnostics: { device: "GP-180", writes: 12, notifications: 3, messages: 5, dropped: 1, reconnects: 2 },
    });
    expect(report).toContain("Bluetooth API: available");
    expect(report).toContain("Bluetooth MIDI: connected");
    expect(report).toContain("Bluetooth device: GP-180");
    expect(report).toContain("Last Bluetooth error: none");
    expect(report).toContain("Bluetooth GATT writes completed: 12");
    expect(report).toContain("Bluetooth GATT notifications received: 3");
    expect(report).toContain("Bluetooth MIDI messages decoded: 5");
    expect(report).toContain("Bluetooth late messages dropped: 1");
    expect(report).toContain("Bluetooth automatic reconnects: 2");
  });

  it("says when Bluetooth is unavailable or still connecting", () => {
    const report = buildReport({ ...base, bluetooth: { available: false, connecting: true, name: null, state: "disconnected", error: "No device" } });
    expect(report).toContain("Bluetooth API: unavailable");
    expect(report).toContain("Bluetooth MIDI: connecting");
    expect(report).toContain("Last Bluetooth error: No device");
  });
});
