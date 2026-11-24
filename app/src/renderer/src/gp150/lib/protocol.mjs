// Valeton GP-150 USB-MIDI codec (the protocol generation Valeton Suite 2.1.0 calls "Device150"; the GP-180 speaks it
// too). Pure, isomorphic ESM, zero dependencies. Evidence: the GP-180 USB captures of majabojarska/Valeton-GP180-Rev-Eng
// (GPL-3.0), checked against every one of its 8 980 frames (tests/vectors.mjs keeps the ones the tests use).
//
// Frame (both directions):  F0 7F | chk | TOTAL lo7 hi7 | OFF lo7 hi7 | SEQ | IDX | data, 2 wire bytes per byte (high
//   nibble first) | F7. chk = CRC-8 (poly 0x31, init 0) over every byte after it up to F7, masked to 7 bits. TOTAL =
//   decoded length of the whole logical message, OFF = where this packet's data starts (14 bit each, 119 bytes per
//   packet). SEQ counts messages, per direction (7 bit, wraps to 1). IDX numbers the packets of a message: from 0 on the
//   host, from 1 on the pedal.
// Control frames have TOTAL 0; OFF lo/hi then carry the type and an argument: 0/0 = ACK of message SEQ, 1/3 = host
//   hello, 2/3 = pedal hello, 3/6 = "send this part again" (8 raw bytes: 01 00, offset lo7 hi7, length lo7 hi7, 00 00).
//   Every message is acknowledged by the other side.
// Logical message: 01 | crc8(rest) | u16 LE length of rest | P | T | u16 LE command | payload. P: 03 query / reply /
//   report, 00 host set, 01 host upload, 09 pedal "upload done", 20 pedal event. T = command >> 12 (1 lists, 2 global
//   settings, 3 patch). Queries carry [cmd][02 00][args]; sets carry the record [cmd][len][data].

export const SYSEX_HEAD = Object.freeze([0xf0, 0x7f]);
/** Decoded data bytes per packet. */
export const CHUNK = 119;
export const MAX_MESSAGE = 0x3fff;

export const P = Object.freeze({ QUERY: 0x03, SET: 0x00, UPLOAD: 0x01, DONE: 0x09, EVENT: 0x20 });
export const CONTROL = Object.freeze({ ACK: 0, HELLO: 1, HELLO_REPLY: 2, RESEND: 3 });
/** Protocol version the host announces in its hello. */
export const HELLO_VERSION = 3;

/** Commands (logical message u16). */
export const CMD = Object.freeze({
  PRESET_NAMES: 0x1010,
  IR_UPLOAD: 0x1040,
  IR_RENAME: 0x1041,
  IR_NAMES: 0x1042,
  SNAPTONE_UPLOAD: 0x1050,
  SNAPTONE_RENAME: 0x1051,
  SNAPTONE_NAMES: 0x1052,
  STATE: 0x1070,
  DEVICE_ID: 0x1080,
  NAM_UPLOAD: 0x1090,
  NAM_RENAME: 0x1091,
  NAM_NAMES: 0x1092,
  GLOBALS: 0x2000,
  GLOBAL_EQ: 0x2010,
  IO: 0x2020,
  USB: 0x2030,
  MIDI: 0x2040,
  SYSTEM: 0x2050,
  DRUM: 0x2060,
  TUNER: 0x2070,
  FACTORY_RESET: 0x2080,
  PATCH: 0x3011,
  PATCH_SETTINGS: 0x3020,
  BLOCK_ON: 0x3031,
  MODEL: 0x3032,
  PARAM: 0x3033,
  CHAIN: 0x3034,
  KNOBS: 0x3050,
  EXP: 0x3060,
  PATCH_STATE: 0x3070,
  CTRL: 0x3080,
  SAVED: 0x0014,
});

/** Commands that are never sent (they erase the pedal or start a firmware transfer). */
export const DANGEROUS = Object.freeze(new Set([CMD.FACTORY_RESET]));

/** The 12 modules in storage order (preset blocks, live edits, chain values). */
export const BLOCKS = Object.freeze(["PRE", "WAH", "DST", "NS", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"]);
export const BLOCK = Object.freeze(Object.fromEntries(BLOCKS.map((b, i) => [b, i])));
export const PARAM_COUNT = 15;
/** The model id of an empty module ("None"); the VOL module's only model (Volume) has the same id. */
export const NONE_FXID = 0x06000003;
/** Knob targets besides the 12 modules. */
export const KNOB_TARGET = Object.freeze({ PATCH_VOL: 0x0c, PATCH_BPM: 0x0d, NONE: 0xffff });

// Native NAM has 20 selectable models (0x10000000..0x10000013), even though its name reply contains 100 records plus None.
export const SLOTS = Object.freeze({ PRESETS: 200, SNAPTONES: 100, NAMS: 20, USER_IRS: 20 });

/**
 * Pedal settings: where each lives in the global-settings records (0x2010..0x2050; the pedal reports them all in the
 * 0x2000 reply and when they change on the pedal, the host sets a whole record). From the GP-180 captures' diffs.
 * globalEq is the Global EQ's on/off, the low byte of the u32 that opens the 0x2010 record.
 */
export const GLOBALS = Object.freeze({
  inputLevel: { cmd: 0x2020, off: 0, type: "i16" },
  outputStereo: { cmd: 0x2020, off: 2, type: "u16" },
  noCabL: { cmd: 0x2020, off: 4, type: "u16" },
  noCabR: { cmd: 0x2020, off: 6, type: "u16" },
  micLevel: { cmd: 0x2020, off: 8, type: "u16" },
  micMonitor: { cmd: 0x2020, off: 10, type: "u16" },
  micJack: { cmd: 0x2020, off: 12, type: "u16" },
  usbRecLevel: { cmd: 0x2030, off: 0, type: "i16" },
  btRecLevel: { cmd: 0x2030, off: 2, type: "i16" },
  micRecLevel: { cmd: 0x2030, off: 4, type: "i16" },
  recModeL: { cmd: 0x2030, off: 6, type: "u16" },
  recModeR: { cmd: 0x2030, off: 8, type: "u16" },
  usbMonitorLevel: { cmd: 0x2030, off: 10, type: "i16" },
  midiInSource: { cmd: 0x2040, off: 0, type: "u16" },
  midiInChannelTrs: { cmd: 0x2040, off: 2, type: "u16" },
  midiInChannelUsb: { cmd: 0x2040, off: 4, type: "u16" },
  midiInChannelBt: { cmd: 0x2040, off: 6, type: "u16" },
  midiOutChannelTrs: { cmd: 0x2040, off: 8, type: "u16" },
  midiOutChannelUsb: { cmd: 0x2040, off: 10, type: "u16" },
  midiOutChannelBt: { cmd: 0x2040, off: 12, type: "u16" },
  clockSource: { cmd: 0x2040, off: 14, type: "u16" },
  clockOutTrs: { cmd: 0x2040, off: 16, type: "u16" },
  cloudOutUsb: { cmd: 0x2040, off: 18, type: "u16" },
  brightness: { cmd: 0x2050, off: 0, type: "u16" },
  displayTimeout: { cmd: 0x2050, off: 2, type: "u16" },
  fsMode: { cmd: 0x2050, off: 6, type: "u8" },
  expJack: { cmd: 0x2050, off: 8, type: "u8" },
  fsJack: { cmd: 0x2050, off: 9, type: "u8" },
  extFs1: { cmd: 0x2050, off: 10, type: "u8" },
  extFs2: { cmd: 0x2050, off: 11, type: "u8" },
  tapPre: { cmd: 0x2050, off: 12, type: "u8" },
  tapMod: { cmd: 0x2050, off: 13, type: "u8" },
  tapDly: { cmd: 0x2050, off: 14, type: "u8" },
  btAudioLevel: { cmd: 0x2050, off: 17, type: "u8" },
  autoCabMatch: { cmd: 0x2050, off: 20, type: "u8" },
  autoSave: { cmd: 0x2050, off: 22, type: "u8" },
  globalEq: { cmd: 0x2010, off: 0, type: "u8" },
});
export const GLOBAL_RECORDS = Object.freeze([CMD.IO, CMD.USB, CMD.MIDI, CMD.SYSTEM]);

/**
 * Global EQ record 0x2010: 32 values of 4 bytes. 0 = the EQ on/off (u32 0/1), 1 = level (f32), 2..31 = the GP-200's Global EQ values 0..29 (f32) in the same
 * order (low cut, low shelf, bands 1-4, high shelf, high cut; the cuts' Q slots unused).
 */
export const GLOBAL_EQ = Object.freeze({ VALUES: 32, ON: 0, LEVEL: 1, BANDS_AT: 2 });
/** Name field of list entries, renames and uploads. */
export const NAME_FIELD = 16;

// ------------------------------------------------------------------------------------------- bytes

export const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));
export const u16le = (v) => [v & 0xff, (v >>> 8) & 0xff];
export const u32le = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
export const u32be = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
export const readU16 = (b, o) => b[o] | (b[o + 1] << 8);
export const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const readU32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export function f32le(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [...b];
}
export const readF32 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);
export const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

/** ASCII name field of `len` bytes (NUL padded); characters outside printable ASCII become "?". */
export function nameField(name, len = NAME_FIELD) {
  const out = new Array(len).fill(0);
  const s = String(name).slice(0, len);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c >= 0x20 && c < 0x7f ? c : 0x3f;
  }
  return out;
}

/** Text up to the first NUL. */
export function readName(b, o, len) {
  let s = "";
  for (let i = 0; i < len && o + i < b.length; i++) {
    const c = b[o + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** CRC-8 (poly 0x31, init 0, no reflection, no xorout). crc8([0x31..0x39]) === 0xA2. */
export function crc8(bytes) {
  let c = 0;
  for (const v of bytes) {
    c ^= v;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

const lo7 = (v) => v & 0x7f;
const hi7 = (v) => (v >>> 7) & 0x7f;

// ------------------------------------------------------------------------------------------- frames

/** Frame bytes from the six header fields and (decoded) data. */
function frame(fields, wire) {
  const body = [...fields, ...wire];
  return Uint8Array.from([0xf0, 0x7f, crc8(body) & 0x7f, ...body, 0xf7]);
}

/** A data packet: `data` (decoded bytes) at `offset` of a `total`-byte message. */
export function encodePacket({ total, offset, seq, index, data }) {
  if (total < 1 || total > MAX_MESSAGE) throw new RangeError(`message length ${total} is outside 1..${MAX_MESSAGE}`);
  const wire = [];
  for (const b of data) wire.push(b >> 4, b & 0x0f);
  return frame([lo7(total), hi7(total), lo7(offset), hi7(offset), seq & 0x7f, index & 0x7f], wire);
}

/** A control frame (TOTAL 0): ACK, hello, resend request. */
export function encodeControl({ type, arg = 0, seq = 0, index = 0, extra = [] }) {
  return frame([0, 0, type & 0x7f, arg & 0x7f, seq & 0x7f, index & 0x7f], extra);
}

export const ack = (seq) => encodeControl({ type: CONTROL.ACK, seq });
export const hello = () => encodeControl({ type: CONTROL.HELLO, arg: HELLO_VERSION });

/** Ask the other side to send `length` bytes at `offset` of message `seq` again (packet `index`). */
export function resendRequest(seq, index, offset, length) {
  return encodeControl({ type: CONTROL.RESEND, arg: 6, seq, index, extra: [1, 0, lo7(offset), hi7(offset), lo7(length), hi7(length), 0, 0] });
}

/**
 * Frame bytes → { kind: "packet", total, offset, seq, index, data } | { kind: "control", type, arg, seq, index, extra }.
 * null for anything else (not F0 7F … F7, bad check byte, nibble data with a value above 0x0F).
 */
export function decodeFrame(bytes) {
  const m = toBytes(bytes);
  if (m.length < 10 || m[0] !== 0xf0 || m[1] !== 0x7f || m[m.length - 1] !== 0xf7) return null;
  if ((crc8(m.subarray(3, m.length - 1)) & 0x7f) !== m[2]) return null;
  const total = m[3] | (m[4] << 7);
  const seq = m[7];
  const index = m[8];
  const rest = m.subarray(9, m.length - 1);
  if (total === 0) return { kind: "control", type: m[5], arg: m[6], seq, index, extra: Uint8Array.from(rest) };
  if (rest.length % 2) return null;
  const data = new Uint8Array(rest.length / 2);
  for (let i = 0; i < data.length; i++) {
    const hi = rest[2 * i];
    const lo = rest[2 * i + 1];
    if (hi > 0x0f || lo > 0x0f) return null;
    data[i] = (hi << 4) | lo;
  }
  return { kind: "packet", total, offset: m[5] | (m[6] << 7), seq, index, data };
}

/** Packets of `msg` (logical bytes) as message `seq`; `fromHost` numbers them from 0, the pedal from 1. */
export function packetize(msg, seq, fromHost = true) {
  const m = toBytes(msg);
  const out = [];
  for (let off = 0, i = 0; off < m.length; off += CHUNK, i++)
    out.push(encodePacket({ total: m.length, offset: off, seq, index: i + (fromHost ? 0 : 1), data: m.subarray(off, off + CHUNK) }));
  return out;
}

/** Next message number after `seq` (7 bit; 0 is only the first). */
export const nextSeq = (seq) => (seq >= 0x7f ? 1 : seq + 1);

/**
 * Collects packets into messages. push(packet) → { seq, bytes } when a message is complete, else null. A packet that
 * doesn't continue its message where it left off is reported by `gap()` (offset expected) until it arrives.
 */
export class Reassembler {
  #parts = new Map();
  push(p) {
    if (p.offset === 0) this.#parts.set(p.seq, { total: p.total, bytes: [] });
    const part = this.#parts.get(p.seq);
    if (!part || part.total !== p.total || p.offset !== part.bytes.length) return null;
    part.bytes.push(...p.data);
    if (part.bytes.length < part.total) return null;
    this.#parts.delete(p.seq);
    return { seq: p.seq, bytes: Uint8Array.from(part.bytes.slice(0, part.total)) };
  }
  /** Where message `seq` stopped, or null when nothing of it is pending. */
  pending(seq) {
    const part = this.#parts.get(seq);
    return part ? { offset: part.bytes.length, total: part.total } : null;
  }
  reset() {
    this.#parts.clear();
  }
}

// ------------------------------------------------------------------------------------------- messages

/** Logical message bytes: 01 | crc8 | u16 length | P | T | u16 cmd | payload. T defaults to cmd >> 12 (the saved event uses 0x10). */
export function encodeMessage({ p, cmd, t = (cmd >>> 12) & 0x0f, payload = [] }) {
  const rest = [p & 0xff, t & 0xff, ...u16le(cmd), ...payload];
  return Uint8Array.from([0x01, crc8(rest), ...u16le(rest.length), ...rest]);
}

/** Logical bytes → { p, t, cmd, payload, crcOk } (payload: everything after the command). null when malformed. */
export function decodeMessage(bytes) {
  const b = toBytes(bytes);
  if (b.length < 8 || b[0] !== 0x01 || readU16(b, 2) !== b.length - 4) return null;
  return { p: b[4], t: b[5], cmd: readU16(b, 6), payload: b.subarray(8), crcOk: crc8(b.subarray(4)) === b[1] };
}

/** Query `cmd` with `args` (payload [cmd][02 00][args]). */
export const query = (cmd, args = []) => encodeMessage({ p: P.QUERY, cmd, payload: [...u16le(cmd), 2, 0, ...args] });

/** Set record `cmd` with `data`; `extra` is added to the length field as Suite does for some commands. */
function setRecord(cmd, data, extra = 0, p = P.SET) {
  if (DANGEROUS.has(cmd)) throw new Error(`command 0x${cmd.toString(16)} is never sent`);
  return encodeMessage({ p, cmd, payload: [...u16le(cmd), ...u16le(data.length + extra), ...data] });
}

/** Read a preset: `slot` 0..199, or 0xFFFF = the edit buffer; `select` makes it the active preset. */
export const readPatch = (slot, select) => query(CMD.PATCH, [...u16le(slot), select ? 0 : 1]);
export const EDIT_BUFFER = 0xffff;

/** Live param: model id u32, value f32, module, param id (the pedal reports knob turns in the same layout). */
export const setParam = (block, param, fxid, value) => setRecord(CMD.PARAM, [...u32le(fxid), ...f32le(value), block, param, 0, 0], 4);
export const setBlockOn = (block, on) => setRecord(CMD.BLOCK_ON, [block, on ? 1 : 0, 0, 0], 4);
/** Model change: model id LE, module u32. */
export const setModel = (block, fxid) => setRecord(CMD.MODEL, [...u32le(fxid), ...u32le(block)], 4);
/** Whole patch-settings record (80 bytes: tempo, volume, NAM mode, name). */
export const setPatchSettings = (record) => setRecord(CMD.PATCH_SETTINGS, [...record]);
/** Knobs 1-3: u32 target each (a module, KNOB_TARGET.PATCH_VOL / PATCH_BPM, or NONE). */
export const setKnobs = (targets) => setRecord(CMD.KNOBS, targets.flatMap((t) => u32le(t)), 4);
export const setExp = (record) => setRecord(CMD.EXP, [...record], 4);
export const setCtrl = (record) => setRecord(CMD.CTRL, [...record]);
/** Whole global-settings record `cmd` (0x2010..0x2060). */
export const setGlobalRecord = (cmd, record) => setRecord(cmd, [...record]);
/** Rename list slot `slot` (IR, SnapTone or NAM rename command). */
export const rename = (cmd, slot, name) => {
  // Both captured NAM renames use a SnapTone record inside the NAM envelope (0x1091 / 0x1051).
  const record = cmd === CMD.NAM_RENAME ? CMD.SNAPTONE_RENAME : cmd;
  return encodeMessage({ p: P.SET, cmd, payload: [...u16le(record), ...u16le(24), ...u32le(slot), ...nameField(name)] });
};

/** File upload into a list slot: [cmd][len][u32 slot][cmd][len][name16][8192 data] (both lengths are the outer one). */
export function upload(cmd, slot, name, data) {
  // A NAM upload carries the SnapTone record (0x1050) inside the NAM envelope (0x1090), as the NAM rename does.
  const record = cmd === CMD.NAM_UPLOAD ? CMD.SNAPTONE_UPLOAD : cmd;
  if (DANGEROUS.has(cmd)) throw new Error(`command 0x${cmd.toString(16)} is never sent`);
  const d = toBytes(data);
  if (d.length > 0x2000) throw new RangeError(`upload data is ${d.length} bytes; at most 8192`);
  const body = new Uint8Array(0x2000 + NAME_FIELD);
  body.set(nameField(name), 0);
  body.set(d, NAME_FIELD);
  const len = 4 + 4 + body.length + 4;
  return encodeMessage({ p: P.UPLOAD, cmd, payload: [...u16le(record), ...u16le(len), ...u32le(slot), ...u16le(record), ...u16le(len), ...body] });
}

/** Write preset file `prst` (1128 bytes, already carrying the slot) into its slot. */
export const importPatch = (prst) => encodeMessage({ p: P.UPLOAD, cmd: CMD.PATCH, payload: [...toBytes(prst)] });

// ------------------------------------------------------------------------------------------- decoding

/** The record data of a reply / report payload ([cmd][len][data…]). */
export const recordData = (payload) => payload.subarray(4);

/**
 * Name lists: presets (u32 index + name16), IR / SnapTone / NAM (u16 index, u16 flag (1 = empty), name16).
 * A preset's slot is its position in the list: after presets were overwritten a GP-150 still lists them in slot order
 * but with other u32 values (issue #140), so that field is not trusted.
 */
export function decodeNames(cmd, payload) {
  const d = recordData(payload);
  const out = [];
  for (let o = 0; o + 20 <= d.length; o += 20) {
    if (cmd === CMD.PRESET_NAMES) out.push({ slot: o / 20, name: readName(d, o + 4, NAME_FIELD), empty: false });
    else out.push({ slot: readU16(d, o), name: readName(d, o + 4, NAME_FIELD), empty: readU16(d, o + 2) === 1 });
  }
  return out;
}

/** Live param, from the pedal (a knob turned) or the host. */
export function decodeParam(payload) {
  const d = recordData(payload);
  return { fxid: readU32(d, 0), value: readF32(d, 4), block: d[8], param: d[9] };
}

export const decodeBlockOn = (payload) => ({ block: recordData(payload)[0], enabled: recordData(payload)[1] === 1 });
export const decodeModel = (payload) => ({ fxid: readU32(recordData(payload), 0), block: readU32(recordData(payload), 4) });
export const decodeChain = (payload) => [...recordData(payload).subarray(0, BLOCKS.length)];
export const decodeSaved = (payload) => ({ slot: readU32(payload, 0), name: readName(payload, 4, NAME_FIELD) });

/** Firmware string and the records of the global-settings reply. */
export function decodeGlobals(payload) {
  const d = recordData(payload);
  const firmware = readName(d, 0, 8).replace(/^V/, "");
  const records = new Map();
  for (let o = 8; o + 4 <= d.length; ) {
    const cmd = readU16(d, o);
    const len = readU16(d, o + 2);
    if (cmd === 0 || o + 4 + len > d.length) break;
    records.set(cmd, d.slice(o + 4, o + 4 + len));
    o += 4 + len;
  }
  return { firmware, records };
}

/** Human-readable decoding for the MIDI monitor and the session's event dispatch. */
export function describe(msg) {
  const name = Object.entries(CMD).find(([, v]) => v === msg.cmd)?.[0] ?? `0x${msg.cmd.toString(16)}`;
  return { ...msg, name };
}

// ------------------------------------------------------------------------------------------- settings records

/** Value of setting `name` in its record's bytes. */
export function readGlobal(record, name) {
  const g = GLOBALS[name];
  if (g.type === "u8") return record[g.off];
  const v = readU16(record, g.off);
  return g.type === "i16" && v & 0x8000 ? v - 0x10000 : v;
}

/** Copy of `record` with setting `name` set to `value`. */
export function writeGlobal(record, name, value) {
  const g = GLOBALS[name];
  const out = Uint8Array.from(record);
  if (g.type === "u8") out[g.off] = value & 0xff;
  else out.set(u16le(value & 0xffff), g.off);
  return out;
}

/** Every named setting found in `records` (Map cmd → record bytes). */
export function globalsOf(records) {
  const out = {};
  for (const name of Object.keys(GLOBALS)) {
    const r = records.get(GLOBALS[name].cmd);
    if (r && r.length >= GLOBALS[name].off + (GLOBALS[name].type === "u8" ? 1 : 2)) out[name] = readGlobal(r, name);
  }
  return out;
}

/** Global EQ record → 32 numbers, and back (value 0, the on/off switch, is a u32; the rest f32). */
export function eqValues(record) {
  return Array.from({ length: GLOBAL_EQ.VALUES }, (_, i) => (i === GLOBAL_EQ.ON ? readU32(record, 0) : Number(readF32(record, 4 * i).toFixed(3))));
}
export const eqRecord = (values) => Uint8Array.from(values.flatMap((v, i) => (i === GLOBAL_EQ.ON ? u32le(v ? 1 : 0) : f32le(v))));
