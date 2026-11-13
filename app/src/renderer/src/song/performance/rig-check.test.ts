import { describe, expect, it } from "vitest";
import { rigCheck, type RigFacts } from "./rig-check";

/** A pedal set up the way the app drives it: USB, channel 16, nothing else to protect. */
const good = (over: Partial<RigFacts> = {}): RigFacts => ({
  device: "gp180",
  globals: { midiInSource: 3, midiInChannelUsb: 16, midiInChannelBt: 16, midiInChannelTrs: 16, clockSource: 0, clockOutTrs: 0, fsJack: 0, expJack: 0 },
  transport: "system",
  pedalChannel: 16,
  otherChannels: [],
  appClock: false,
  tempoOnStart: false,
  downstreamPedals: false,
  ...over,
});
const codes = (facts: RigFacts) => rigCheck(facts).map((issue) => issue.code);
const withGlobals = (globals: RigFacts["globals"], over: Partial<RigFacts> = {}) => good({ globals: { ...good().globals, ...globals }, ...over });

describe("rigCheck", () => {
  it("returns nothing when the pedal agrees with the app", () => {
    expect(rigCheck(good())).toEqual([]);
    expect(rigCheck(withGlobals({ clockSource: 2, clockOutTrs: 1 }, { appClock: true, downstreamPedals: true, otherChannels: [1] }))).toEqual([]);
  });

  it("flags a MIDI in source that excludes USB, with a fix to Mixed", () => {
    for (const source of [0, 2]) {
      const [issue] = rigCheck(withGlobals({ midiInSource: source }));
      expect(issue).toMatchObject({ code: "in-source", level: "error", fix: { name: "midiInSource", value: 3 } });
    }
    expect(codes(withGlobals({ midiInSource: 1 }))).toEqual([]);
  });

  it("flags a MIDI in source that excludes Bluetooth when sending over Bluetooth", () => {
    for (const source of [0, 1]) expect(codes(withGlobals({ midiInSource: source }, { transport: "bluetooth" }))).toEqual(["in-source"]);
    expect(codes(withGlobals({ midiInSource: 2 }, { transport: "bluetooth" }))).toEqual([]);
  });

  it("flags Omni on the transport's channel when other pedals are configured", () => {
    const [issue] = rigCheck(withGlobals({ midiInChannelUsb: 0 }, { otherChannels: [1, 2] }));
    expect(issue).toMatchObject({ code: "in-channel-omni", level: "error", fix: { name: "midiInChannelUsb", value: 16 } });
    expect(issue.text).toContain("MIDI in channel (USB)");
    expect(issue.text).toContain("every channel over USB");
    expect(codes(withGlobals({ midiInChannelUsb: 0 }))).toEqual([]);
    expect(rigCheck(withGlobals({ midiInChannelBt: 0 }, { transport: "bluetooth", otherChannels: [1] }))[0].fix?.name).toBe("midiInChannelBt");
  });

  it("flags a channel that differs from the one the app sends on, naming both ways out", () => {
    const [issue] = rigCheck(withGlobals({ midiInChannelUsb: 5 }));
    expect(issue).toMatchObject({ code: "in-channel-mismatch", level: "error", fix: { name: "midiInChannelUsb", value: 16 } });
    expect(issue.text).toContain("change the app's channel to 5");
  });

  it("warns, with no fix, when another pedal shares the channel", () => {
    const [issue] = rigCheck(good({ otherChannels: [16] }));
    expect(issue).toMatchObject({ code: "in-channel-shared", level: "warning" });
    expect(issue.fix).toBeUndefined();
  });

  it("warns when the app sends clock and the pedal keeps its own", () => {
    const [issue] = rigCheck(good({ appClock: true }));
    expect(issue).toMatchObject({ code: "clock-source", level: "warning", fix: { name: "clockSource", value: 2 } });
  });

  it("offers no clock fix over Bluetooth and says it is unproven", () => {
    const [issue] = rigCheck(withGlobals({ midiInSource: 3 }, { appClock: true, transport: "bluetooth" }));
    expect(issue.code).toBe("clock-source");
    expect(issue.fix).toBeUndefined();
    expect(issue.text).toContain("unproven");
  });

  it("notes that tempo at start and clock both set the tempo", () => {
    const [issue] = rigCheck(withGlobals({ clockSource: 2 }, { appClock: true, tempoOnStart: true }));
    expect(issue).toMatchObject({ code: "clock-double", level: "advice" });
    expect(issue.fix).toBeUndefined();
    expect(codes(good({ appClock: true, tempoOnStart: true }))).toEqual(["clock-source"]);
  });

  it("advises turning clock out on when other pedals follow", () => {
    const [issue] = rigCheck(good({ downstreamPedals: true }));
    expect(issue).toMatchObject({ code: "clock-out", level: "advice", fix: { name: "clockOutTrs", value: 1 } });
  });

  it("flags an FS jack that is not MIDI out when other pedals are configured", () => {
    const issues = rigCheck(withGlobals({ fsJack: 1, clockOutTrs: 1 }, { downstreamPedals: true }));
    expect(issues).toEqual([expect.objectContaining({ code: "midi-out-jack", level: "error", fix: expect.objectContaining({ name: "fsJack", value: 0 }) })]);
    expect(codes(withGlobals({ fsJack: 1 }))).toEqual([]);
  });

  it("asks to connect the pedal when a needed setting was never read", () => {
    expect(rigCheck(good({ globals: {} }))).toEqual([
      { code: "unknown", level: "advice", text: "Connect the pedal in the editor to check its MIDI settings." },
    ]);
    expect(codes(good({ downstreamPedals: true, globals: { midiInSource: 3, midiInChannelUsb: 16 } }))).toEqual(["unknown"]);
  });

  it("checks a GP-150 the same way and names it", () => {
    const [issue] = rigCheck(withGlobals({ midiInChannelUsb: 0 }, { device: "gp150", otherChannels: [1] }));
    expect(issue.text).toContain("GP-150");
    expect(issue.code).toBe("in-channel-omni");
  });
});
