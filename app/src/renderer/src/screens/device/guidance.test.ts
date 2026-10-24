import { describe, expect, it } from "vitest";
import type { DeviceHostStatus } from "@shared/host/device";
import type { ConnectionErrorCode } from "@/state/device-types";
import { refineConnectionError, toConnectionError } from "@/state/connection-error";
import { connectionView, diagnosticChecks, formatWhen, requestErrorLine, type Check, type GuidanceInput } from "./guidance";
import { SUPPORTED_PEDALS } from "@/state/device-model";
import { SUPPORTED_DEVICE_KEYS } from "@/state/driver/types";
import { listNames } from "@shared/devices";

const host = (over: Partial<DeviceHostStatus> = {}): DeviceHostStatus => ({
  checkedAt: 0,
  os: "test",
  versions: { app: "0.1.0", electron: "43", chrome: "150", node: "24" },
  usb: [],
  driver: null,
  linuxSeq: null,
  usbInterfaces: null,
  vendorApps: { suite: false, gp200Editor: false },
  ...over,
});
const gp5 = { vendorId: 0x84ef, productId: 0x0184, product: "GP-5" };
const gp50 = { vendorId: 0x84ef, productId: 0x018a, product: "GP-50" };
const updater = { vendorId: 0x84ef, productId: 0x0185, product: "Valeton Upgrade" };
const gp200 = { vendorId: 0x84ef, productId: 0x002a, product: "GP-200" };
const gp200Updater = { vendorId: 0x84ef, productId: 0x002b, product: null };
const gp200lt = { vendorId: 0x84ef, productId: 0x002c, product: "GP-200LT" };

const err = (code: ConnectionErrorCode, input: Partial<GuidanceInput> = {}) =>
  connectionView({ status: "error", error: { code, message: code }, mode: "webmidi", hostStatus: null, platform: "linux", ...input });

describe("connectionView", () => {
  it("connected: green chip, live, no primary action", () => {
    const v = connectionView({ status: "connected", error: null, mode: "webmidi", hostStatus: null, platform: "linux" });
    expect(v).toMatchObject({ kind: "connected", led: "on", chip: "USB", offline: false, action: "none" });
    expect(connectionView({ status: "connected", error: null, mode: "mock", hostStatus: null, platform: "web" }).chip).toBe("Simulated");
  });

  it("connecting offers Cancel", () => {
    expect(connectionView({ status: "connecting", error: null, mode: "webmidi", hostStatus: null, platform: "linux" })).toMatchObject({ kind: "connecting", led: "warn", action: "cancel" });
  });

  it("disconnected says when it was last connected and says why when the port went away", () => {
    const now = new Date(2026, 9, 7, 15, 0).getTime();
    const at = new Date(2026, 9, 7, 13, 42).getTime();
    const v = connectionView({ status: "disconnected", error: null, mode: "webmidi", hostStatus: null, platform: "linux", lastConnectedAt: at, now });
    expect(v).toMatchObject({ kind: "disconnected", led: "off", chip: "Not connected", action: "connect" });
    expect(v.detail).toBe("Last connected today at 13:42");
    const lost = connectionView({ status: "disconnected", error: null, mode: "webmidi", hostStatus: null, platform: "linux", disconnectReason: "lost" });
    expect(lost.detail).toMatch(/went away/);
  });

  it("unsupported in the browser points to the desktop app and Chrome/Edge", () => {
    const v = err("unsupported", { platform: "web" });
    expect(v.kind).toBe("unsupported");
    expect(v.note).toMatch(/desktop app/);
    expect(v.note).toMatch(/Chrome or Edge/);
  });

  it("broken browser names Chromium 152 and the fix", () => {
    expect(err("broken-browser", { platform: "web" }).note).toMatch(/153/);
  });

  it("permission in the browser gives site-settings steps", () => {
    const v = err("permission", { platform: "web" });
    expect(v.kind).toBe("permission");
    expect(v.steps.join(" ")).toMatch(/MIDI devices/);
  });

  it("Linux without /dev/snd/seq access asks to join the device's group", () => {
    const h = host({ linuxSeq: { path: "/dev/snd/seq", exists: true, accessible: false, group: "audio", inGroup: false } });
    for (const code of ["permission", "not-found"] as const) {
      const v = err(code, { hostStatus: h });
      expect(v.kind).toBe("linux-access");
      expect(v.steps[0]).toContain("usermod -aG audio");
    }
  });

  it("Windows: GP-5 on USB but no port = driver problem with the Windows 11 guide opened", () => {
    const v = err("not-found", { platform: "win32", hostStatus: host({ usb: [gp5], driver: "usbmidi2, USB MIDI 2.0 Device" }) });
    expect(v).toMatchObject({ kind: "driver", led: "fault", chip: "Check driver", action: "show-fix", openGuide: true });
    expect(v.note).toMatch(/MIDI 2\.0/);
    expect(v.steps.some((s) => s.includes("USB Audio Device"))).toBe(true);
  });

  it('distinguishes an open but silent MIDI 2.0 port from a missing port', () => {
    const v = err('busy', { platform: 'win32', portName: 'GP-180 MIDI', hostStatus: host({ usb: [{ vendorId: 0x84ef, productId: 0x0188, product: 'GP-180' }], driver: 'USBMidi2' }) });
    expect(v.detail).toContain('port opened');
    expect(v.note).toContain('does not establish the cause');
    expect(v.statusText).toContain('GP-180');
  });

  it("a GP-50 on USB is a supported pedal: driver guidance names it, never update mode", () => {
    const v = err("not-found", { platform: "win32", hostStatus: host({ usb: [gp50], driver: "usbmidi2" }) });
    expect(v.kind).toBe("driver");
    expect(v.statusText).toBe("GP-50 found, but its driver hides the MIDI port");
    expect(v.steps[0]).toContain("GP-50");
  });

  it("names the last connected model, or both models when none is known", () => {
    expect(connectionView({ status: "connecting", error: null, mode: "webmidi", hostStatus: null, platform: "linux", device: "gp50" }).statusText).toBe("Connecting to the GP-50");
    expect(connectionView({ status: "connecting", error: null, mode: "webmidi", hostStatus: null, platform: "linux" }).statusText).toBe(`Connecting to the ${SUPPORTED_PEDALS}`);
  });

  it("names the GP-200 on the port or on USB, never the remembered GP-50", () => {
    const remembered = { mode: "webmidi", platform: "linux", device: "gp50" } as const;
    const connecting = connectionView({ ...remembered, status: "connecting", error: null, hostStatus: null, portName: "GP-200 MIDI 1" });
    expect(connecting.statusText).toBe("Connecting to the GP-200");
    expect(err("timeout", { ...remembered, portName: "GP-200LT MIDI 1" }).detail).toBe("A device answered, but not like a GP-200LT");
    expect(connectionView({ ...remembered, status: "disconnected", error: null, hostStatus: host({ usb: [gp200] }) }).statusText).toBe("GP-200 not connected");
    // A simulated GP-200 is named by its port while it syncs; once connected the store's model names it
    expect(connectionView({ ...remembered, mode: "mock", status: "connecting", error: null, hostStatus: null, portName: "GP-200JR (simulated)" }).statusText).toBe("Connecting to the GP-200JR");
  });

  it("sends GP-200 owners to Valeton's own tools, GP-5 owners to Valeton Suite", () => {
    expect(err("bootloader", { device: "gp200" }).note).toMatch(/Finish the update in Valeton's updater/);
    expect(err("bootloader", { device: "gp50" }).note).toMatch(/Finish the update in Valeton Suite/);
    const driver = (usb: typeof gp200) => err("not-found", { platform: "win32", hostStatus: host({ usb: [usb], driver: "usbmidi2" }) }).steps[0];
    expect(driver(gp200)).toBe("Plug the GP-200 in, switch it on and close Valeton's GP-200 editor.");
    expect(driver(gp50)).toBe("Plug the GP-50 in, switch it on and close Valeton Suite.");
  });

  it("no pedal on USB = plug-in guidance listing the visible ports", () => {
    const v = connectionView({
      status: "error",
      error: { code: "not-found", message: "", ports: ["Midi Through Port-0"] },
      mode: "webmidi",
      hostStatus: host(),
      platform: "linux",
    });
    expect(v.kind).toBe("disconnected");
    expect(v.note).toMatch(/Midi Through Port-0/);
    expect(v.note).toMatch(/data cable/);
  });

  it("silent port with Valeton Suite running = close Suite, Check again", () => {
    const v = err("busy", { platform: "win32", hostStatus: host({ vendorApps: { suite: true, gp200Editor: false } }) });
    expect(v).toMatchObject({ kind: "suite", action: "check", actionLabel: "Check again" });
    expect(v.state).toMatch(/Valeton Suite/);
  });

  it("silent port without Suite on Windows opens the driver guide", () => {
    expect(err("busy", { platform: "win32", hostStatus: host() })).toMatchObject({ kind: "silent", openGuide: true });
  });

  it('recognizes the already-installed legacy driver without asserting another app holds the port', () => {
    const v = err('busy', { platform: 'win32', portName: 'GP-180 MIDI', hostStatus: host({ driver: 'usbaudio, GP-180 MIDI' }) });
    expect(v.note).toContain('already installed');
    expect(v.note).toContain('official editor');
    expect(v.note).not.toContain('Another app holds');
  });

  it("silent GP-200 on the Windows MIDI 2.0 driver = driver guide", () => {
    const v = err("busy", { platform: "win32", hostStatus: host({ usb: [gp200], driver: "usbmidi2, USB MIDI 2.0 Device" }) });
    expect(v).toMatchObject({ kind: "driver", action: "show-fix" });
    expect(v.note).not.toMatch(/Valeton Suite/);
  });

  it("silent GP-200 with its editor running = close the GP-200 editor", () => {
    const v = err("busy", { platform: "win32", hostStatus: host({ usb: [gp200], driver: "usbaudio, USB Audio Device", vendorApps: { suite: false, gp200Editor: true } }) });
    expect(v.kind).toBe("suite");
    expect(v.state).toMatch(/GP-200 editor/);
    expect(v.note).not.toMatch(/Valeton Suite/);
  });

  it("a running editor of the other family doesn't hold a GP-5's port", () => {
    const v = err("busy", { platform: "win32", hostStatus: host({ usb: [gp5], driver: "usbaudio", vendorApps: { suite: false, gp200Editor: true } }) });
    expect(v.kind).toBe("silent");
  });

  it("silent GP-200 never tells its owner to close Valeton Suite", () => {
    const v = err("busy", { platform: "win32", hostStatus: host({ usb: [gp200], driver: "usbaudio" }) });
    expect(v.kind).toBe("silent");
    expect(v.note).toMatch(/Valeton's GP-200 editor/);
    expect(v.note).not.toMatch(/Valeton Suite/);
  });

  it("silent port in a browser on Windows points at the WinRT MIDI flag", () => {
    const v = err("busy", { platform: "web", hostStatus: host({ os: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", vendorApps: null }) });
    expect(v.note).toMatch(/use-winrt-midi-api/);
    expect(err("busy", { platform: "web", hostStatus: host({ os: "Mozilla/5.0 (X11; Linux x86_64)", vendorApps: null }) }).note).not.toMatch(/winrt/);
  });

  it("bootloader: update mode, no action, app stays silent", () => {
    expect(err("bootloader")).toMatchObject({ kind: "bootloader", chip: "Update mode", action: "none", offline: true });
  });

  it("unsupported model: says which pedal, sends nothing, offers Check again", () => {
    const v = connectionView({ status: "error", error: { code: "unsupported-model", message: "GP-200 support is coming in a later version of Tone Studio." }, mode: "webmidi", hostStatus: null, platform: "linux", device: "gp5" });
    expect(v).toMatchObject({ kind: "unsupported-model", led: "warn", action: "check", offline: true, detail: "GP-200 support is coming in a later version of Tone Studio." });
    expect(v.note).toContain(`simulated ${listNames(SUPPORTED_DEVICE_KEYS)}`);
  });

  it("timeout after bytes arrived = wrong device / firmware", () => {
    const v = err("timeout", { device: "gp5" });
    expect(v.kind).toBe("wrong-device");
    expect(v.detail).toBe("A device answered, but not like a GP-5");
    expect(v.note).not.toMatch(/not a GP-50/);
  });

  it("every connection error code maps to a view with text", () => {
    const codes: ConnectionErrorCode[] = ["unsupported", "insecure", "permission", "no-sysex", "broken-browser", "not-found", "busy", "timeout", "bootloader", "unsupported-model", "unknown"];
    for (const code of codes) {
      const v = err(code);
      expect(v.state.length).toBeGreaterThan(0);
      expect(v.statusText.length).toBeGreaterThan(0);
      expect(v.offline).toBe(true);
    }
  });
});

describe("refineConnectionError", () => {
  it("turns not-found into bootloader when only an update-mode Valeton device is on USB", () => {
    expect(refineConnectionError({ code: "not-found", message: "" }, host({ usb: [updater] })).code).toBe("bootloader");
  });
  it("keeps not-found when the GP-5 itself is present or nothing is", () => {
    expect(refineConnectionError({ code: "not-found", message: "" }, host({ usb: [gp5, updater] })).code).toBe("not-found");
    expect(refineConnectionError({ code: "not-found", message: "" }, host()).code).toBe("not-found");
    expect(refineConnectionError({ code: "not-found", message: "" }, null).code).toBe("not-found");
  });
  it("never treats a GP-50 as update mode, even next to another Valeton device", () => {
    expect(refineConnectionError({ code: "not-found", message: "" }, host({ usb: [gp50] })).code).toBe("not-found");
    expect(refineConnectionError({ code: "busy", message: "" }, host({ usb: [gp50, updater] })).code).toBe("busy");
  });
  it("reports a GP-200 on USB without a MIDI port as that model, its updater as update mode", () => {
    const notFound = refineConnectionError({ code: "not-found", message: "" }, host({ usb: [gp200] }));
    expect(notFound.code).toBe("not-found");
    expect(connectionView({ status: "error", error: notFound, mode: "webmidi", hostStatus: host({ usb: [gp200] }), platform: "linux", device: "gp5" }).detail).toBe(
      "Found on USB, but there is no GP-200 MIDI port",
    );
    expect(refineConnectionError({ code: "not-found", message: "" }, host({ usb: [gp200Updater] })).code).toBe("bootloader");
    expect(refineConnectionError({ code: "permission", message: "" }, host({ usb: [gp200] })).code).toBe("permission");
  });
});

describe("toConnectionError", () => {
  it("a silent port names the editor of that model", () => {
    expect(toConnectionError({ code: "timeout" }, false, "gp200").message).toMatch(/Close Valeton's GP-200 editor/);
    expect(toConnectionError({ code: "timeout" }, false, "gp5").message).toMatch(/Close Valeton Suite/);
  });

  it("calls a reply that doesn't identify the pedal a wrong device, a later silence a stalled read", () => {
    expect(toConnectionError({ code: "timeout" }, true, "gp200lt")).toMatchObject({ code: "timeout", message: expect.stringMatching(/not like a GP-200LT/) });
    const stalled = toConnectionError({ code: "timeout", message: "read slot 01-A: no reply after 4 tries" }, true, "gp200lt", true);
    expect(stalled.code).toBe("unknown");
    expect(stalled.message).toBe("The GP-200LT stopped answering while Tone Studio read it (read slot 01-A: no reply after 4 tries). Switch it off and on, then reconnect.");
  });
});

describe("diagnosticChecks", () => {
  const base = { portName: null, webmidi: true, chrome: "150" };
  it("all green when connected on Linux", () => {
    const checks = diagnosticChecks({
      ...base,
      portName: "GP-5 MIDI 1",
      status: "connected",
      error: null,
      mode: "webmidi",
      platform: "linux",
      hostStatus: host({ usb: [gp5], driver: "snd-usb-audio", linuxSeq: { path: "/dev/snd/seq", exists: true, accessible: true, group: "audio", inGroup: true } }),
    });
    expect(checks.map((c) => c.state)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(checks[0].detail).toBe("Valeton GP-5 found, 84EF:0184");
    expect(checks[1].detail).toContain("snd-usb-audio");
    expect(checks[2].detail).toBe("GP-5 MIDI 1 answers requests");
  });

  it("Windows MIDI 2.0 driver is a fault; Suite running is a warning", () => {
    const checks = diagnosticChecks({ ...base, status: "error", error: { code: "not-found", message: "" }, mode: "webmidi", platform: "win32", hostStatus: host({ usb: [gp5], driver: "usbmidi2", vendorApps: { suite: true, gp200Editor: false } }) });
    expect(checks.find((c) => c.id === "driver")?.state).toBe("fault");
    expect(checks.find((c) => c.id === "access")?.state).toBe("warn");
  });

  const busy = { ...base, status: "error", error: { code: "busy", message: "" }, mode: "webmidi", platform: "win32" } as const;
  const row = (checks: Check[], id: Check["id"]) => checks.find((c) => c.id === id);

  it("GP-200 driver row: the standard driver is fine, another one is a warning", () => {
    expect(row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200], driver: "usbaudio, USB Audio Device" }) }), "driver")).toMatchObject({ state: "ok", detail: "Windows (usbaudio, USB Audio Device)" });
    const asio = row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200], driver: "ValetonAsio, Valeton GP-200 ASIO" }) }), "driver");
    expect(asio).toMatchObject({ state: "warn" });
    expect(asio?.detail).toContain("ValetonAsio, Valeton GP-200 ASIO");
  });

  it("GP-200 on the MIDI 2.0 driver is a fault, a GP-200 without a bound driver a warning", () => {
    expect(row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200], driver: "usbmidi2, USB MIDI 2.0 Device" }) }), "driver")?.state).toBe("fault");
    expect(row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200], driver: null }) }), "driver")?.state).toBe("warn");
  });

  it("GP-200LT without a known MIDI interface: driver unknown, not a warning", () => {
    const unknown = row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200lt], driver: null, usbInterfaces: [{ productId: 0x002c, iface: 0, service: "usbaudio", name: null, midi: false }] }) }), "driver");
    expect(unknown).toMatchObject({ state: "idle", detail: "Couldn't tell which driver the GP-200LT's MIDI interface uses" });
    const known = row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200lt], driver: null, usbInterfaces: [{ productId: 0x002c, iface: 2, service: null, name: null, midi: true }] }) }), "driver");
    expect(known?.state).toBe("warn");
  });

  it("exclusive access for a GP-200 is about its editor, not Valeton Suite", () => {
    const running = row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200], driver: "usbaudio", vendorApps: { suite: false, gp200Editor: true } }) }), "access");
    expect(running).toMatchObject({ state: "warn" });
    expect(running?.detail).toMatch(/GP-200 editor/);
    const idle = row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200], driver: "usbaudio", vendorApps: { suite: true, gp200Editor: false } }) }), "access");
    expect(idle).toMatchObject({ state: "ok", detail: "Valeton's GP-200 editor is not running" });
    expect(`${idle?.detail} ${idle?.hint}`).not.toMatch(/Suite/);
    expect(row(diagnosticChecks({ ...busy, hostStatus: host({ usb: [gp200], vendorApps: null }) }), "access")?.state).toBe("idle");
  });

  it("reports a GP-50 on USB with its product id", () => {
    const checks = diagnosticChecks({ ...base, status: "error", error: { code: "not-found", message: "" }, mode: "webmidi", platform: "linux", hostStatus: host({ usb: [gp50] }) });
    expect(checks[0]).toMatchObject({ state: "ok", detail: "Valeton GP-50 found, 84EF:018A" });
    expect(checks[2].detail).toBe("No GP-50 MIDI port");
  });

  it("reports other Valeton devices as faults", () => {
    const checks = diagnosticChecks({ ...base, status: "error", error: { code: "not-found", message: "" }, mode: "webmidi", platform: "linux", hostStatus: host({ usb: [updater] }) });
    expect(checks[0]).toMatchObject({ state: "fault", detail: "Other Valeton device: 84EF:0185" });
  });

  it("browser without WebMIDI reports the browser row as a fault", () => {
    const checks = diagnosticChecks({ ...base, webmidi: false, status: "error", error: { code: "unsupported", message: "" }, mode: "webmidi", platform: "web", hostStatus: null });
    expect(checks.find((c) => c.id === "driver")).toMatchObject({ name: "Browser", state: "fault" });
  });
});

describe("small formatters", () => {
  it("formatWhen", () => {
    const now = new Date(2026, 9, 7, 12).getTime();
    expect(formatWhen(new Date(2026, 9, 6, 9, 5).getTime(), now)).toBe("yesterday at 09:05");
    expect(formatWhen(new Date(2026, 9, 3, 18, 0).getTime(), now)).toBe("on 3 Oct at 18:00");
  });
  it("requestErrorLine", () => {
    expect(requestErrorLine({ code: "timeout", message: "", at: 0 })).toBe("The pedal stopped answering (timeout)");
    expect(requestErrorLine(null)).toBeNull();
  });
});
