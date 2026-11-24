// MIDI monitor: a capped list of tx/rx lines fed by the sessions' `log` option, and the decoder that turns raw frames
// into readable lines ("Select preset 63", "Acknowledged", "Pedal: DLY Mix 32"). GP-5 family frames are nibble frames;
// GP-200 family frames start with their own header and decode with gp200/lib/protocol.mjs; GP-150 frames start F0 7F
// with a check byte and decode with gp150/lib/protocol.mjs.
import { BLOCKS, CC, CMD, EXP_TARGETS, KIND, READ, Reassembler, decodeMessage, globalsFor, parseSysex, patchSettingByRecord } from "@/gp5/lib/protocol.mjs";
import { modelByFxid } from "@/gp5/lib/catalog.mjs";
import {
  BLOCKS as GP200_BLOCKS,
  CHUNK,
  DEVICE_TYPES,
  PATCH_SETTING,
  Reassembler as Gp200Reassembler,
  decodeFrame as decodeGp200Frame,
  decodeMessage as decodeGp200Message,
  slotLabel as gp200SlotLabel,
  type DecodedMessage as Gp200Message,
  type DecodedRecord as Gp200Record,
} from "@/gp200/lib/protocol.mjs";
import {
  BLOCKS as GP150_BLOCKS,
  CHUNK as GP150_CHUNK,
  CMD as GP150_CMD,
  CONTROL as GP150_CONTROL,
  EDIT_BUFFER as GP150_EDIT_BUFFER,
  GLOBAL_RECORDS as GP150_GLOBAL_RECORDS,
  P as GP150_P,
  decodeBlockOn as decodeGp150BlockOn,
  decodeFrame as decodeGp150Frame,
  decodeModel as decodeGp150Model,
  decodeParam as decodeGp150Param,
  decodeSaved as decodeGp150Saved,
  readU16 as gp150U16,
  readU32 as gp150U32,
  type Message as Gp150Message,
} from "@/gp150/lib/protocol.mjs";
import { profileFor } from "@shared/devices";
import type { DeviceKey, GlobalSpec, MidiLogEntry } from "./device-types";
import { GP200_GLOBAL_SPECS } from "./driver/gp200-globals";

export const MIDI_LOG_CAP = 2000;

/** MIDI monitor lines, oldest first; `pushMidiLog` drops the oldest past MIDI_LOG_CAP. */
export const midiLog: MidiLogEntry[] = [];

export function pushMidiLog(line: MidiLogEntry): void {
  midiLog.push(line);
  if (midiLog.length > MIDI_LOG_CAP) midiLog.shift();
}

/** "F0 0A 0B …" */
export const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);

const READ_NAMES: Record<number, string> = {
  [READ.GLOBALS]: "pedal settings",
  [READ.USER_IRS]: "user IR names",
  [READ.SNAPTONES]: "SnapTone names",
  [READ.PRESET_NAMES]: "preset names",
  [READ.CURRENT_PATCH]: "active preset",
  [READ.CURRENT_SLOT]: "active slot",
  [READ.MODIFIED]: "unsaved-edits flag",
  [READ.EXPORT_PRESET]: "stored preset",
};

const LIST_NAMES: Record<string, string> = { presets: "Preset names", snaptones: "SnapTone names", irs: "User IR names" };

/** Param name lookup (block storage index, algId) → "Gain"; the store passes the active preset's models. */
export type ParamNamer = (block: number, index: number) => string | undefined;
/** Model of the connected pedal (picks the effect catalog for model names); null = unknown. */
export type DeviceGetter = () => DeviceKey | null;

const blockName = (b: number) => BLOCKS[b] ?? `Block ${b}`;
const blockList = (blocks: number[]) => (blocks.length ? blocks.map(blockName).join(" ") : "none");

/** "Global Monitor level -20" / "Global FS3 function Tap tempo" from the model's settings table (unknown model: GP-5's). */
function describeGlobal(a: number, b: number, value: number, device: DeviceKey | null): string {
  const table = globalsFor(device === "gp50" ? "gp50" : "gp5") as Record<string, GlobalSpec>;
  const g = Object.values(table).find((x) => x.addr[0] === a && x.addr[1] === b);
  if (!g) return `Global ${a}.${b} ${value}`;
  return `Global ${g.label} ${g.labels?.[value - g.min] ?? value}`;
}

/** One 0x42 record: "Tempo 120 BPM", "EXP target DLY", "Patch volume 50". */
function describeSetting(record: number, value: number): string {
  const field: string | undefined = patchSettingByRecord(record)?.[0];
  switch (field) {
    case "volume":
      return `Patch volume ${value}`;
    case "bpm":
      return `Tempo ${value} BPM`;
    case "on":
      return `EXP ${value ? "on" : "off"}`;
    case "paramMin":
      return `EXP minimum ${value}%`;
    case "paramMax":
      return `EXP maximum ${value}%`;
    case "volPosition":
      return `EXP volume ${value ? "Post" : "Pre"}`;
    case "volMin":
      return `EXP volume minimum ${value}%`;
    case "volMax":
      return `EXP volume maximum ${value}%`;
    case "targetModule":
      return `EXP target ${EXP_TARGETS[value] ?? value}`;
    case "targetParam":
      return `EXP parameter ${value + 1}`;
    default:
      return `Patch setting 0x${record.toString(16)} = ${value}`;
  }
}

/** Host commands that carry their meaning in the payload (the rest decode like device messages). */
function describeCommand(p: Uint8Array, device: DeviceKey | null): string | null {
  switch (p[1]) {
    case CMD.SELECT_PRESET:
      return `Select preset ${u32(p, 2)}`;
    case CMD.SAVE_PRESET:
      return `Save to slot ${u32(p, 2)}`;
    case CMD.RENAME_PRESET:
      return `Rename slot ${u32(p, 2)}`;
    case CMD.WRITE_PRESET:
      return `Write slot ${p[2]}`;
    case CMD.SET_GLOBAL:
      return describeGlobal(p[2], p[3], i32(p, 6), device);
    case CMD.DELETE_PRESET:
      return `Clear slot ${u32(p, 2)}`;
    case CMD.PASTE_PRESET:
      return `Copy slot ${u16(p, 4)} to slot ${u16(p, 2)}`;
    case CMD.MOVE_PRESET:
      return `Move slot ${u32(p, 2)} to slot ${u32(p, 6)}`;
    default:
      return null;
  }
}

interface Decoded {
  type: string;
  block?: number;
  index?: number;
  value?: number;
  enabled?: boolean;
  fxid?: number;
  slot?: number;
  sel?: number;
  list?: string;
  settings?: { record: number; value: number }[];
  fs1?: number[];
  fs2?: number[];
  order?: number[];
  a?: number;
  b?: number;
}

/** Describe one complete logical payload (both directions). `device` picks the catalog; unknown → GP-50 (a superset). */
export function describePayload(p: Uint8Array, dir: "out" | "in", paramName?: ParamNamer, device: DeviceKey | null = null): { text: string; ack: boolean } {
  const kind = p[0];
  const fn = p[1];
  if (kind === KIND.ACK) return { text: "Acknowledged", ack: true };
  if (kind === KIND.GET && dir === "out") {
    const what = READ_NAMES[fn] ?? `selector 0x${fn?.toString(16)}`;
    return { text: fn === READ.EXPORT_PRESET ? `Read ${what} of slot ${u32(p, 2)}` : `Read ${what}`, ack: false };
  }
  const command = kind === KIND.SET && dir === "out" ? describeCommand(p, device) : null;
  if (command) return { text: command, ack: false };
  const msg: Decoded = decodeMessage(p);
  const who = dir === "in" ? "Pedal: " : "";
  const say = (text: string) => ({ text: who + text, ack: false });
  switch (msg.type) {
    case "param": {
      const name = paramName?.(msg.block!, msg.index!) ?? `param ${msg.index}`;
      const v = msg.value!;
      return say(`${blockName(msg.block!)} ${name} ${Number.isInteger(v) ? v : v.toFixed(1)}`);
    }
    case "block":
      return say(`${blockName(msg.block!)} ${msg.enabled ? "on" : "off"}`);
    case "model": {
      const m = modelByFxid(msg.fxid!, device ?? "gp50") as { name?: string } | undefined;
      return say(`${blockName(msg.block!)} model ${m?.name ?? `0x${msg.fxid!.toString(16)}`}`);
    }
    case "patchSetting":
      return say((msg.settings ?? []).map((s) => describeSetting(s.record, s.value)).join(", "));
    case "footswitch":
      return say(`Footswitches FS1 ${blockList(msg.fs1 ?? [])}, FS2 ${blockList(msg.fs2 ?? [])}`);
    case "order":
      return say(`Chain order ${blockList(msg.order ?? [])}`);
    case "global":
      return say(describeGlobal(msg.a!, msg.b!, msg.value!, device));
    case "listChanged":
      return say(`${LIST_NAMES[msg.list!] ?? "A list"} changed`);
    case "slot":
      return { text: `Active slot ${msg.slot}`, ack: false };
    case "presetChanged":
      return { text: "Preset changed on the pedal", ack: false };
    case "reply":
      return { text: `Reply: ${READ_NAMES[msg.sel!] ?? `selector 0x${msg.sel?.toString(16)}`} (${p.length} bytes)`, ack: false };
    default:
      return { text: `Unknown message ${hex(p.subarray(0, 2))}`, ack: false };
  }
}

// ------------------------------------------------------------------------------------------- GP-200 family

/** What the GP-200 session logs besides whole messages: address frames and the device's flush request. */
type Gp200Frame = Gp200Record | { kind: "flush" } | { kind: "softwareState"; state: number | null; deviceType: number | null } | { kind: "softwareJump" };

const gp200Block = (b: number) => GP200_BLOCKS[b] ?? `Block ${b}`;
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const PATCH_SETTING_NAMES: Record<number, string> = {
  [PATCH_SETTING.VOL]: "Patch volume",
  [PATCH_SETTING.TEMPO]: "Tempo",
  [PATCH_SETTING.STYLE]: "Drum style",
  [PATCH_SETTING.SEND]: "FX loop send",
  [PATCH_SETTING.RETURN]: "FX loop return",
  [PATCH_SETTING.LOOP_MODE]: "FX loop mode",
  [PATCH_SETTING.PAN]: "Pan",
};

/** "Global Input level 3 dB" / "Global Display Patch" from the GP-200 settings table. */
function describeGp200Global(name: string | null, id: number, value: number): string {
  const g = GP200_GLOBAL_SPECS.find((s) => s.name === name);
  if (!g) return `Global 0x${id.toString(16)} ${value}`;
  return `Global ${g.label} ${g.labels?.[value - g.min] ?? `${value}${g.unit ? ` ${g.unit}` : ""}`}`;
}

/** One GP-200 record in words; null for records that only frame a message. */
function describeGp200Record(r: Gp200Frame, out: boolean, paramName?: ParamNamer): string | null {
  switch (r.kind) {
    case "header":
    case "patchInfo":
      return null;
    case "read":
      return out ? (r.slot === 0xffff ? "Read active preset" : `Read slot ${gp200SlotLabel(r.slot)}`) : null;
    case "patchChanged":
      return out ? `Select preset ${gp200SlotLabel(r.slot)}` : `Preset ${gp200SlotLabel(r.slot)} selected`;
    case "param":
      return `${gp200Block(r.block)} ${paramName?.(r.block, r.paramId) ?? `param ${r.paramId}`} ${num(r.value)}`;
    case "blockEnabled":
      return `${gp200Block(r.block)} ${r.enabled ? "on" : "off"}`;
    case "model":
      return `${gp200Block(r.block)} model 0x${r.fxid.toString(16)}`;
    case "patchSetting":
      return `${PATCH_SETTING_NAMES[r.target] ?? `Patch setting ${r.target}`} ${r.value}${r.target === PATCH_SETTING.TEMPO ? " BPM" : ""}`;
    case "chain":
      return `Chain order ${r.order.map(gp200Block).join(" ")}`;
    case "patchName":
      return `Preset name ${r.name}`;
    case "global":
      return describeGp200Global(r.name, r.id, r.value);
    case "globalEq":
      return `Global EQ value ${r.index} ${num(r.value)}`;
    case "globals":
      return "Settings";
    case "stateDump":
      return "Read pedal settings";
    case "drumState":
      return out ? "Read drum state" : `Drum ${r.playing ? "playing" : "stopped"}`;
    case "dirty":
      return r.dirty ? "Active preset edited" : "Active preset matches its slot";
    case "identityQuery":
      return "Identify";
    case "identity":
      return `Identity ${(DEVICE_TYPES as Record<number, { name: string } | undefined>)[r.deviceType]?.name ?? `type ${r.deviceType}`}`;
    case "softwareState":
      return r.state === 0 ? "Firmware update mode" : "Ready";
    case "irName":
      return out ? `Read User IR name ${r.slot + 1}` : `User IR ${r.slot + 1} ${r.name}`;
    case "snapToneName":
      return out ? `Read SnapTone name ${r.slot}` : `SnapTone ${r.slot} ${r.name}`;
    case "styleName":
      return out ? `Read drum style name ${r.index + 1}` : `Drum style ${r.index + 1} ${r.name}`;
    case "irUpload":
      return `Upload User IR ${r.slot + 1} ${r.name}`;
    case "snapToneUpload":
      return `Upload SnapTone ${r.slot} ${r.name}`;
    case "irResult":
    case "snapToneResult":
      return `${r.kind === "irResult" ? `User IR ${r.slot + 1}` : `SnapTone ${r.slot}`} ${r.ok ? "stored" : "not stored"}`;
    case "saved":
      return out ? `Save to slot ${gp200SlotLabel(r.slot)}` : `Saved slot ${gp200SlotLabel(r.slot)}`;
    case "flush":
      return "Stop sending (flush)";
    case "unknown":
      return `Record 0x${r.type.toString(16)}`;
    default: {
      // Records the app neither sends nor waits for: the record's name in words ("fsFunction" → "Fs function")
      const words = r.kind.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
      return words[0].toUpperCase() + words.slice(1);
    }
  }
}

/** A whole GP-200 message (or one address or flush frame): a write or patch reply, else its records. */
function describeGp200(m: Gp200Message | Gp200Frame | undefined, out: boolean, paramName?: ParamNamer): string {
  const who = out ? "" : "Pedal: ";
  if (!m) return "SysEx";
  if (!("records" in m)) return who + (describeGp200Record(m, out, paramName) ?? "SysEx");
  if (m.patch) {
    const what = m.patch.stored ? `slot ${gp200SlotLabel(m.patch.slot)}` : "active preset";
    return out ? `Write ${what}` : `Reply: ${what}`;
  }
  const parts = m.records.map((r) => describeGp200Record(r, out, paramName)).filter((t): t is string => t !== null);
  return who + (parts.join(", ") || "Empty message");
}

/** A GP-200 session warning: a resent request, an optional sync step the pedal didn't answer, or a write that didn't read back the same. */
function describeGp200Warning(
  w: { kind: "resend"; what: string; attempt: number } | { kind: "skipped"; what: string } | { kind: "verify"; slot: number; attempt: number },
): string {
  if (w.kind === "resend") return `No reply to ${w.what}: sending it again (try ${w.attempt + 1})`;
  if (w.kind === "skipped") return `No reply to ${w.what}: Tone Studio goes on without it`;
  return `Slot ${gp200SlotLabel(w.slot)} didn't read back the same after write ${w.attempt}`;
}

// ------------------------------------------------------------------------------------------- GP-150

const gp150Block = (b: number) => GP150_BLOCKS[b] ?? `Block ${b}`;
const gp150Slot = (slot: number) => profileFor("gp150").slotLabel(slot);
const GP150_READS: Record<number, string> = {
  [GP150_CMD.STATE]: "Read pedal state",
  [GP150_CMD.DEVICE_ID]: "Read device id",
  [GP150_CMD.PRESET_NAMES]: "Read preset names",
  [GP150_CMD.IR_NAMES]: "Read user IR names",
  [GP150_CMD.SNAPTONE_NAMES]: "Read SnapTone names",
  [GP150_CMD.NAM_NAMES]: "Read NAM names",
  [GP150_CMD.GLOBALS]: "Read pedal settings",
};

/** One GP-150 logical message (the session decodes both directions). */
function describeGp150(m: Gp150Message, out: boolean, paramName?: ParamNamer): string {
  const who = out ? "" : "Pedal: ";
  const data = m.payload.subarray(4);
  if (m.p === GP150_P.DONE) return "Pedal: upload stored";
  if (m.p === GP150_P.EVENT && m.cmd === GP150_CMD.SAVED) return `Pedal: saved slot ${gp150Slot(decodeGp150Saved(m.payload).slot)}`;
  if (m.p === GP150_P.UPLOAD) {
    if (m.cmd === GP150_CMD.PATCH) return `Write slot ${gp150Slot(gp150U32(m.payload, 4))}`;
    const slot = gp150U32(data, 0);
    return m.cmd === GP150_CMD.IR_UPLOAD ? `Upload user IR ${slot + 1}` : m.cmd === GP150_CMD.SNAPTONE_UPLOAD ? `Upload SnapTone ${slot}` : "Upload";
  }
  switch (m.cmd) {
    case GP150_CMD.PATCH: {
      if (out && m.p === GP150_P.QUERY && data.length >= 3) {
        const slot = gp150U16(data, 0);
        if (slot === GP150_EDIT_BUFFER) return "Read active preset";
        return data[2] === 0 ? `Select preset ${gp150Slot(slot)}` : `Read slot ${gp150Slot(slot)}`;
      }
      return `${who}preset ${gp150Slot(gp150U32(m.payload, 4))}`;
    }
    case GP150_CMD.PARAM: {
      const p = decodeGp150Param(m.payload);
      return `${who}${gp150Block(p.block)} ${paramName?.(p.block, p.param) ?? `param ${p.param}`} ${num(p.value)}`;
    }
    case GP150_CMD.BLOCK_ON: {
      const b = decodeGp150BlockOn(m.payload);
      return `${who}${gp150Block(b.block)} ${b.enabled ? "on" : "off"}`;
    }
    case GP150_CMD.MODEL: {
      const x = decodeGp150Model(m.payload);
      return `${who}${gp150Block(x.block)} model 0x${x.fxid.toString(16)}`;
    }
    case GP150_CMD.CHAIN:
      return `${who}chain order ${[...data.subarray(0, GP150_BLOCKS.length)].map(gp150Block).join(" ")}`;
    case GP150_CMD.PATCH_STATE:
      return `${who}${gp150U32(data, 0) === 1 ? "preset edited" : "preset unchanged"}`;
    case GP150_CMD.PATCH_SETTINGS:
      return `${who}tempo ${gp150U16(data, 0)}, volume ${gp150U16(data, 2)}`;
    case GP150_CMD.KNOBS:
      return `${who}knob assignments`;
    case GP150_CMD.EXP:
      return `${who}EXP settings`;
    case GP150_CMD.CTRL:
      return `${who}footswitch assignments`;
    case GP150_CMD.GLOBAL_EQ:
      return `${who}Global EQ`;
    case GP150_CMD.IR_RENAME:
    case GP150_CMD.SNAPTONE_RENAME:
      return `Rename ${m.cmd === GP150_CMD.IR_RENAME ? "user IR" : "SnapTone"} ${gp150U32(data, 0)}`;
  }
  if (out && m.p === GP150_P.QUERY) return GP150_READS[m.cmd] ?? `Read 0x${m.cmd.toString(16)}`;
  if (GP150_GLOBAL_RECORDS.includes(m.cmd)) return out ? "Set pedal settings" : "Pedal: settings";
  if (m.cmd === GP150_CMD.GLOBALS) return "Pedal: settings";
  if (m.cmd === GP150_CMD.PRESET_NAMES) return "Pedal: preset names";
  if (m.cmd === GP150_CMD.IR_NAMES) return "Pedal: user IR names";
  if (m.cmd === GP150_CMD.SNAPTONE_NAMES) return "Pedal: SnapTone names";
  return `${who}0x${m.cmd.toString(16)}`;
}

/** Describe a standard MIDI short message (CC, program change). `gp5`: name the GP-5 family's CC map. */
export function describeShort(b: Uint8Array, dir: "out" | "in", gp5 = true): string {
  const status = b[0] & 0xf0;
  if (status === 0xb0) {
    const [num, v] = [b[1], b[2]];
    if (!gp5) return `${dir === "in" ? "Pedal: " : ""}Control change ${num} = ${v}`;
    if (num === CC.PRESET_SELECT) return `${dir === "in" ? "Pedal: " : ""}Select preset ${v}`;
    if (num === CC.PATCH_VOLUME) return `Patch volume ${v}`;
    const block = Object.entries(CC.BLOCK_SWITCH).find(([, n]) => n === num)?.[0];
    if (block) return `${block} ${v >= 64 ? "on" : "off"}`;
    if (num === CC.TUNER) return `Tuner ${v >= 64 ? "on" : "off"}`;
    return `Control change ${num} = ${v}`;
  }
  if (status === 0xc0) return `Program change ${b[1]}`;
  return "MIDI message";
}

export const shortRaw = (b: Uint8Array) => (((b[0] & 0xf0) === 0xb0 ? `CC#${b[1]} ${b[2]}, ` : "") + hex(b));

/**
 * Turns the sessions' `log(dir, bytes, decoded)` calls into monitor lines. Outgoing multi-frame payloads are
 * reassembled here (the sessions log each frame); incoming payloads arrive already reassembled and decoded.
 */
export class MidiLogDecoder {
  #tx = new Reassembler();
  // Host queries may declare more bytes than they carry: a short chunk ends the message (as the simulator reads them).
  #tx200 = new Gp200Reassembler({ shortChunkEnds: CHUNK.HOST });
  #txChunk: number = CHUNK.HOST;
  #id = 0;
  constructor(
    private paramName?: ParamNamer,
    private device: DeviceGetter = () => null,
  ) {}

  line(dir: string, bytes: Uint8Array, decoded?: unknown, at = Date.now()): MidiLogEntry | null {
    const id = ++this.#id;
    if (dir === "warn") {
      const d = decoded as { type?: string; got?: number; kind?: string } | undefined;
      const text = d?.kind ? describeGp200Warning(d as Parameters<typeof describeGp200Warning>[0]) : `Unexpected reply${d?.got !== undefined ? ` length ${d.got}` : ""}`;
      return { id, at, dir: "warn", text, raw: "", ack: false };
    }
    if (dir === "rx-bad") return { id, at, dir: "bad", text: "Unreadable frame (CRC or length)", raw: `SysEx ${bytes.length} B`, ack: false };
    const d: "out" | "in" = dir === "tx" ? "out" : "in";
    if (bytes[0] !== 0xf0) {
      const device = this.device();
      return { id, at, dir: d, text: describeShort(bytes, d, !device || profileFor(device).family === "gp5"), raw: shortRaw(bytes), ack: false };
    }
    const gp150 = decodeGp150Frame(bytes);
    if (gp150) {
      const raw = `SysEx ${bytes.length} B`;
      if (gp150.kind === "control") {
        const text = gp150.type === GP150_CONTROL.ACK ? "Acknowledged" : gp150.type === GP150_CONTROL.HELLO ? "Connect" : gp150.type === GP150_CONTROL.HELLO_REPLY ? "Pedal: connected" : "Resend request";
        return { id, at, dir: d, text, raw, ack: gp150.type === GP150_CONTROL.ACK };
      }
      const msg = decoded as Gp150Message | undefined;
      const frames = Math.ceil(gp150.total / GP150_CHUNK);
      if (!msg || msg.cmd === undefined) return { id, at, dir: d, text: `Frame ${Math.floor(gp150.offset / GP150_CHUNK) + 1} of ${frames}`, raw, ack: false };
      return { id, at, dir: d, text: describeGp150(msg, d === "out", this.paramName) + (frames > 1 ? ` (${frames} frames)` : ""), raw, ack: false };
    }
    const gp200 = decodeGp200Frame(bytes);
    if (gp200) return { id, at, dir: d, text: this.#gp200(gp200, d, decoded), raw: `SysEx ${bytes.length} B`, ack: false };
    if (d === "in") {
      const msg = decoded as { raw?: Uint8Array } | undefined;
      const payload = msg?.raw ?? parseSysex(bytes)?.payload;
      if (!payload) return { id, at, dir: "bad", text: "Unreadable frame", raw: `SysEx ${bytes.length} B`, ack: false };
      const { text, ack } = describePayload(payload, "in", this.paramName, this.device());
      return { id, at, dir: d, text, raw: `SysEx ${bytes.length} B`, ack };
    }
    const frame = parseSysex(bytes);
    if (!frame) return { id, at, dir: d, text: "SysEx", raw: `SysEx ${bytes.length} B`, ack: false };
    const payload = this.#tx.push(frame);
    if (!payload) return { id, at, dir: d, text: `Frame ${frame.index + 1} of ${frame.total}`, raw: `SysEx ${bytes.length} B`, ack: false };
    const { text, ack } = describePayload(payload, "out", this.paramName, this.device());
    const frames = frame.total > 1 ? ` (${frame.total} frames)` : "";
    return { id, at, dir: d, text: text + frames, raw: `SysEx ${bytes.length} B`, ack };
  }

  /** A GP-200 frame: incoming ones come with the session's decoding, outgoing ones are reassembled here. */
  #gp200(frame: NonNullable<ReturnType<typeof decodeGp200Frame>>, d: "out" | "in", decoded: unknown): string {
    if (d === "in" && !decoded && frame.kind === "data") return `Pedal: frame ${Math.floor(frame.off / CHUNK.DEVICE) + 1} of ${Math.ceil(frame.len / CHUNK.DEVICE)}`;
    if (d === "in") return describeGp200(decoded as Gp200Message | Gp200Frame | undefined, false, this.paramName);
    if (frame.kind !== "data") return frame.kind === "address" && frame.address === "softwareState" ? "Read pedal mode" : "SysEx";
    // The first frame of a message sets the frame size: 183 B for the GP-200, 120 B for a JR or LT upload.
    if (frame.off === 0 && frame.len > frame.data.length) {
      this.#txChunk = frame.data.length;
      this.#tx200 = new Gp200Reassembler({ shortChunkEnds: this.#txChunk });
    }
    const msg = this.#tx200.push(frame);
    const chunk = Math.floor(frame.off / this.#txChunk) + 1;
    if (!msg) return `Frame ${chunk} of ${Math.ceil(frame.len / this.#txChunk)}`;
    return describeGp200(decodeGp200Message(msg), true, this.paramName) + (chunk > 1 ? ` (${chunk} frames)` : "");
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** 13:51:08.412 */
export function formatLogTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Line direction as the monitor and the session log name it. */
export const DIR_LABEL: Record<MidiLogEntry["dir"], string> = { out: "Out", in: "In", bad: "Bad", warn: "Warn" };

export function formatLogLine(e: MidiLogEntry): string {
  return `${formatLogTime(e.at)}  ${DIR_LABEL[e.dir].padEnd(4)}  ${e.text}${e.raw ? `  [${e.raw}]` : ""}`;
}
