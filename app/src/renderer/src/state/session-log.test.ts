import { describe, expect, it } from "vitest";
import type { DeviceHostStatus } from "@shared/host/device";
import { useDevice } from "./device";
import type { DeviceState } from "./device-types";
import { deviceLogEntries } from "./session-log";

const base: DeviceState = useDevice.getState();
const at = (over: Partial<DeviceState>): DeviceState => ({ ...base, ...over });
const host = (over: Partial<DeviceHostStatus> = {}): DeviceHostStatus => ({
  checkedAt: 1,
  os: "Windows 10.0.26100 x64",
  versions: { app: "0.5.0", electron: "43", chrome: "150", node: "24" },
  usb: [{ vendorId: 0x84ef, productId: 0x002a, product: "GP-200" }],
  driver: "usbaudio, USB Audio Device",
  linuxSeq: null,
  usbInterfaces: null,
  vendorApps: { suite: false, gp200Editor: false },
  ...over,
});

describe("deviceLogEntries", () => {
  it("logs connection steps and failures", () => {
    expect(deviceLogEntries(at({ status: "idle" }), at({ status: "connecting", mode: "webmidi" }))).toEqual([["Event", "Connecting (USB MIDI)"]]);
    expect(deviceLogEntries(at({ status: "idle" }), at({ status: "connecting", mode: "bluetooth" }))).toEqual([["Event", "Connecting (Bluetooth MIDI)"]]);
    expect(deviceLogEntries(at({ status: "connecting" }), at({ status: "connected", device: "gp200", portName: "GP-200 MIDI 1" }))).toEqual([["Event", 'Connected to the GP-200 on "GP-200 MIDI 1"']]);
    const failed = deviceLogEntries(at({ status: "connecting" }), at({ status: "error", error: { code: "busy", message: "silent", ports: [] } }));
    expect(failed).toEqual([["Error", "Connection failed: busy: silent (visible ports: none)"]]);
    expect(deviceLogEntries(at({ status: "connected" }), at({ status: "disconnected", disconnectReason: "lost" }))).toEqual([["Event", "Disconnected (the pedal went away)"]]);
  });

  it("logs a long job once when it starts and once when it ends, not every progress step", () => {
    const start = at({ busy: { kind: "backup", progress: 0, label: "Backing up 256 slots" } });
    expect(deviceLogEntries(at({ busy: null }), start)).toEqual([["Event", "Started: Backing up 256 slots"]]);
    expect(deviceLogEntries(start, at({ busy: { kind: "backup", progress: 0.5, label: "Backing up slot 128 of 256" } }))).toEqual([]);
    expect(deviceLogEntries(start, at({ busy: null }))).toEqual([["Event", "Finished: backup"]]);
  });

  it("logs a host check only when what it saw changed", () => {
    const first = host();
    const [entry] = deviceLogEntries(at({ hostStatus: null }), at({ hostStatus: first }));
    expect(entry[0]).toBe("Host");
    expect(entry[1]).toContain("Driver: usbaudio, USB Audio Device");
    expect(deviceLogEntries(at({ hostStatus: first }), at({ hostStatus: host({ checkedAt: 2 }) }))).toEqual([]);
    expect(deviceLogEntries(at({ hostStatus: first }), at({ hostStatus: host({ checkedAt: 3, vendorApps: { suite: false, gp200Editor: true } }) }))[0][1]).toContain("GP-200 editor yes");
  });
});
