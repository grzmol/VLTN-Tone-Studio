import { describe, expect, it } from "vitest";
import { CC, encode, packetize } from "@/gp5/lib/protocol.mjs";
import * as gp200 from "@/gp200/lib/protocol.mjs";
import { generatePatch } from "@/gp200/lib/mock-device.mjs";
import { MIDI_LOG_CAP, MidiLogDecoder, midiLog, pushMidiLog } from "./midi-log";
import type { MidiLogEntry } from "./device-types";

describe("midiLog", () => {
  const line = (n: number): MidiLogEntry => ({ dir: "out", text: String(n) }) as MidiLogEntry;

  it("keeps lines oldest first, capped at MIDI_LOG_CAP, and clears", () => {
    midiLog.length = 0;
    for (let i = 0; i < MIDI_LOG_CAP + 5; i++) pushMidiLog(line(i));
    expect(midiLog.length).toBe(MIDI_LOG_CAP);
    expect(midiLog[0].text).toBe("5");
    expect(midiLog.at(-1)!.text).toBe(String(MIDI_LOG_CAP + 4));
    midiLog.length = 0;
    pushMidiLog(line(1));
    expect(midiLog.map((l) => l.text)).toEqual(["1"]);
  });
});

describe("MidiLogDecoder", () => {
  const frames = (payload: number[]) => packetize(payload) as Uint8Array[];

  it("decodes a CC preset select with its raw bytes", () => {
    const d = new MidiLogDecoder();
    const line = d.line("tx", Uint8Array.from([0xb0, CC.PRESET_SELECT, 63]))!;
    expect(line).toMatchObject({ dir: "out", text: "Select preset 63", raw: "CC#0 63, B0 00 3F" });
  });

  it("decodes outgoing globals and param edits, naming the param when known", () => {
    const d = new MidiLogDecoder((block, index) => (block === 3 && index === 0 ? "Gain" : undefined));
    const [g] = frames(encode.setGlobal("monitorLevel", 3));
    expect(d.line("tx", g)!.text).toBe("Global Monitor level 3");
    const [p] = frames(encode.setParam(3, 0, 70));
    expect(d.line("tx", p)!.text).toBe("AMP Gain 70");
  });

  it("reassembles multi-frame writes: partial frames, then the decoded message", () => {
    const d = new MidiLogDecoder();
    const prst = new Uint8Array(507);
    const all = frames(encode.writePreset(12, prst));
    expect(all.length).toBeGreaterThan(1);
    const lines = all.map((f) => d.line("tx", f)!);
    expect(lines[0].text).toBe(`Frame 1 of ${all.length}`);
    expect(lines.at(-1)!.text).toBe(`Write slot 12 (${all.length} frames)`);
  });

  it("marks ACKs and unreadable frames", () => {
    const d = new MidiLogDecoder();
    const [ack] = frames([0x14, 0x08, 0x00]);
    expect(d.line("rx", ack, { raw: Uint8Array.from([0x14, 0x08, 0x00]) })).toMatchObject({ dir: "in", text: "Acknowledged", ack: true });
    expect(d.line("rx-bad", Uint8Array.from([0xf0, 1, 2, 0xf7]))).toMatchObject({ dir: "bad" });
  });

  it("describes read requests and replies", () => {
    const d = new MidiLogDecoder();
    const [req] = frames(encode.read(0x40));
    expect(d.line("tx", req)!.text).toBe("Read preset names");
    const reply = Uint8Array.from([0x12, 0x10, 1, 3, 1, 0, 0]);
    expect(d.line("rx", frames([...reply])[0], { raw: reply })!.text).toBe("Reply: pedal settings (7 bytes)");
  });

  it("names models from the connected pedal's catalog", () => {
    const [wah] = frames(encode.setModel(1, 0x05000008)); // PRE C-Wah exists on the GP-50 only
    expect(new MidiLogDecoder(undefined, () => "gp50").line("tx", wah)!.text).toBe("PRE model C-Wah");
    expect(new MidiLogDecoder(undefined, () => "gp5").line("tx", wah)!.text).toBe("PRE model 0x5000008");
  });

  it("decodes the GP-50 commands and notifications readably", () => {
    const d = new MidiLogDecoder(undefined, () => "gp50");
    const tx = (payload: number[]) => frames(payload).map((f) => d.line("tx", f)!.text).at(-1);
    expect(tx(encode.setFootswitchMasks([2, 6], [7]))).toBe("Footswitches FS1 DST MOD, FS2 DLY");
    expect(tx(encode.setOrder([0, 1, 2, 9, 3, 4, 5, 6, 7, 8]))).toBe("Chain order NR PRE DST NS AMP CAB EQ MOD DLY RVB");
    expect(tx(encode.setPatchSetting(0x2002, 120))).toBe("Tempo 120 BPM");
    expect(tx(encode.setPatchSetting(0x2004, 13))).toBe("EXP minimum 13%");
    expect(tx(encode.deletePreset(5))).toBe("Clear slot 5");
    expect(tx(encode.pastePreset(7, 3))).toBe("Copy slot 3 to slot 7");
    expect(tx(encode.movePreset(3, 9))).toBe("Move slot 3 to slot 9");
    expect(tx(encode.exportPreset(12))).toBe("Read stored preset of slot 12");
    expect(tx(encode.read(0x45))).toBe("Read unsaved-edits flag");
    const listChanged = [0x12, 0x1b, 2, 0, 0, 0];
    expect(d.line("rx", frames(listChanged)[0], { raw: Uint8Array.from(listChanged) })!.text).toBe("Pedal: Preset names changed");
  });
});

describe("MidiLogDecoder on the GP-200", () => {
  type Msg = { cmd: number; payload: Uint8Array };
  const tx = (d: MidiLogDecoder, msg: Msg) => gp200.encodeFrames(msg).map((f) => d.line("tx", f)!.text);
  /** A pedal message as the GP-200 session logs it: the last frame, with what it decoded. */
  const rx = (d: MidiLogDecoder, msg: Msg) => d.line("rx", gp200.encodeFrames(msg, gp200.CHUNK.DEVICE).at(-1)!, gp200.decodeMessage(msg))!.text;

  it("names every chunk of a multi-frame pedal reply, not only the last (#136)", () => {
    const frames = gp200.encodeFrames({ cmd: 0x12, payload: new Uint8Array(846) }, gp200.CHUNK.DEVICE);
    const d = new MidiLogDecoder();
    expect(frames.map((f) => d.line("rx", f)!.text)).toEqual([1, 2, 3, 4, 5].map((n) => `Pedal: frame ${n} of 5`));
  });

  it("decodes outgoing selects, reads, edits and settings, naming the param when known", () => {
    const d = new MidiLogDecoder((block, index) => (block === 3 && index === 0 ? "Gain" : undefined), () => "gp200");
    const { encode: e, PATCH_SETTING, GLOBALS } = gp200;
    expect(tx(d, e.select(46))).toEqual(["Select preset 12-C"]);
    expect(tx(d, e.readStored(5))).toEqual(["Read slot 02-B"]);
    expect(tx(d, e.param(0, { block: 3, paramId: 0, fxid: 0x07000001, value: 42 }))).toEqual(["AMP Gain 42"]);
    expect(tx(d, e.blockEnabled(0, 2, false))).toEqual(["DST off"]);
    expect(tx(d, e.patchSetting(0, PATCH_SETTING.TEMPO, 120))).toEqual(["Tempo 120 BPM"]);
    expect(tx(d, e.global(GLOBALS.inputMode.id, 2))).toEqual(["Global Input mode Line"]);
    expect(tx(d, e.globalEq(30, 60))).toEqual(["Global EQ value 30 60"]);
  });

  it("reassembles a full write: partial frames, then the slot it writes", () => {
    const lines = tx(new MidiLogDecoder(), gp200.encode.fullWrite(5, generatePatch(5)));
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("Frame 1 of 7");
    expect(lines.at(-1)).toBe("Write slot 02-B (7 frames)");
  });

  it("describes what the session decoded from the pedal, and its warnings", () => {
    const d = new MidiLogDecoder();
    const { rec, concat, CMD, STATUS } = gp200;
    expect(rx(d, { cmd: CMD.SET, payload: rec.system(0, 7) })).toBe("Pedal: Preset 02-D selected");
    expect(rx(d, { cmd: CMD.SET, payload: concat([rec.header(1, 5), generatePatch(5)]) })).toBe("Reply: slot 02-B");
    expect(rx(d, { cmd: CMD.SET, payload: rec.status(STATUS.DIRTY, 1) })).toBe("Pedal: Active preset edited");
    expect(d.line("warn", new Uint8Array(), { kind: "resend", what: "read slot 5", attempt: 1 })!.text).toBe("No reply to read slot 5: sending it again (try 2)");
    expect(d.line("warn", new Uint8Array(), { kind: "verify", slot: 5, attempt: 1, offset: 9 })!.text).toBe("Slot 02-B didn't read back the same after write 1");
    expect(d.line("warn", new Uint8Array(), { kind: "skipped", what: "User IR names" })!.text).toBe("No reply to User IR names: Tone Studio goes on without it");
  });
});
