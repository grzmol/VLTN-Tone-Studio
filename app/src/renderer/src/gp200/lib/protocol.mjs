// Valeton GP-200 family (GP-200 / R / X, GP-200LT, GP-200JR) USB-MIDI codec. Pure, isomorphic ESM, zero dependencies.
// A different protocol generation from the GP-5: no checksum, no ACK, TLV records. Evidence: static RE of the official
// GP-200 editor 1.8.0 and the protocol vectors derived from it (tests/vectors.mjs); GPL sources were
// used for facts only.
//
// Frame:  F0 21 25 7E 47 50 2D 32 | CMD | LEN lo7 hi7 | OFF lo7 hi7 | 2 wire bytes per byte, high nibble first | F7
//   CMD 0x11 query / 0x12 set (host), 0x12 reply / notify and 0x03 "flush your TX queue" (device).
//   LEN = decoded length of the whole message, OFF = offset of this chunk (14 bit each). Host chunks <= 183 bytes,
//   the device sends 185. RX keeps the low nibble unmasked: the device sometimes puts a raw byte there.
// Payload: TLV records [u16 type LE][u16 len LE][len bytes]. Patch-scoped messages start with the header record
//   0x0000 {u16 a, u16 b}: a = 0 -> edit buffer of slot b (b = the CURRENT slot), a = 1 -> stored slot b.
// Address frames (not TLV): `11 12 00 00 00` SOFTWARE_STATE query, answered `12 12 00 00 00 <state> [<type>]` only in
//   update mode (USB captures: no reply in normal mode); `12 12 00 20 00` SOFTWARE_JUMP reboots into the updater and
//   must never be sent (see dangerOf).

export const SYSEX_ID = Object.freeze([0xf0, 0x21, 0x25, 0x7e, 0x47, 0x50, 0x2d, 0x32]);
export const CMD = Object.freeze({ QUERY: 0x11, SET: 0x12, FLUSH: 0x03 });
export const CHUNK = Object.freeze({ HOST: 183, DEVICE: 185 });
export const MAX_MESSAGE = 0x3fff;
const HEAD = 13; // F0 + 7 id bytes + CMD + LEN(2) + OFF(2)

/** Address frames: bytes 9..12 are an address instead of LEN/OFF. */
export const ADDRESS = Object.freeze({ SOFTWARE_STATE: Object.freeze([0x12, 0, 0, 0]), SOFTWARE_JUMP: Object.freeze([0x12, 0, 0x20, 0]) });

/** TLV record types. */
export const REC = Object.freeze({
  HEADER: 0x0000,
  READ: 0x0001,
  INFO: 0x0002,
  PARAM: 0x0005,
  PATCH_SETTING: 0x0006,
  NAME: 0x0007,
  CHAIN: 0x0008,
  AUTHOR: 0x0009,
  STYLE_NAME: 0x000a,
  NOTE: 0x000b,
  EXP: 0x000c,
  EXP_RANGE: 0x000e,
  CTRL: 0x000f,
  QUICK_ACCESS: 0x0010,
  FOCUS: 0x0013,
  BLOCK: 0x0014,
  BLOCK_ON: 0x0015,
  MODEL: 0x0016,
  DRUM_STATE: 0x1000,
  DRUM: 0x1001,
  GLOBAL_EQ_ALL: 0x1004,
  GLOBAL_EQ: 0x1005,
  STATE_DUMP: 0x1006,
  GLOBALS: 0x1007,
  SYSTEM: 0x1008,
  IR_NAME: 0x1009,
  IR_UPLOAD: 0x100a,
  IR_RESULT: 0x100b,
  IR_RENAME: 0x100c,
  FS_FUNCTION: 0x100f,
  STATUS: 0x1011,
  SNAPTONE_NAME: 0x1012,
  SNAPTONE_UPLOAD: 0x1013,
  SNAPTONE_RESULT: 0x1014,
  SNAPTONE_RENAME: 0x1015,
  FIRMWARE_JUMP: 0x2000,
  IDENTITY: 0x2001,
  SAVE: 0x2003,
  RESET_PROGRESS: 0x2005,
  FAVOURITE: 0x2006,
  MOVE: 0x2007,
  MOVE_COMMIT: 0x2008,
  DELETE: 0x2009,
});

/** The 11 blocks in record order (= default chain order); all are movable. */
export const BLOCKS = Object.freeze(["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"]);
export const BLOCK = Object.freeze(Object.fromEntries(BLOCKS.map((b, i) => [b, i])));
/** f32 params per block record. */
export const PARAM_COUNT = 15;
/** 0x0006 targets. */
export const PATCH_SETTING = Object.freeze({ VOL: 0, TEMPO: 1, STYLE: 2, SEND: 3, RETURN: 4, LOOP_MODE: 5, PAN: 6 });
/** Quick-Access / EXP block bytes that are not blocks. */
export const TARGET = Object.freeze({ PATCH_VOL: 0x0b, PATCH_TEMPO: 0x0c, NONE: 0xff });
/** 0x1011 sub-ids: host sub 0 = drum play/stop; device sub 1 = edit buffer dirty, sub 2 = EXP1 A/B. */
export const STATUS = Object.freeze({ DRUM: 0, DIRTY: 1, EXP1_AB: 2 });
export const STYLE_COUNT = 20;
export const NAME_FIELD = 16;

/** Device type (0x2001 reply / SOFTWARE_STATE byte 14) -> model. */
export const DEVICE_TYPES = Object.freeze({
  2: Object.freeze({ type: 2, key: "gp200", name: "GP-200", slots: 256, footswitches: 8 }),
  3: Object.freeze({ type: 3, key: "gp200lt", name: "GP-200LT", slots: 256, footswitches: 4 }),
  4: Object.freeze({ type: 4, key: "gp200jr", name: "GP-200JR", slots: 255, footswitches: 3 }),
});
export const deviceByKey = (key) => Object.values(DEVICE_TYPES).find((d) => d.key === key) ?? null;
/** The editor's only port detector (case-sensitive substring). */
export const GP200_PORT_RE = /GP-?200/;

/** Slot label as on the pedal: 64 banks x A-D, 0 -> "01-A", 255 -> "64-D". */
export function slotLabel(slot) {
  return `${String(Math.floor(slot / 4) + 1).padStart(2, "0")}-${"ABCD"[slot % 4]}`;
}

/**
 * 0x1008 global ids with their place in the 0x1007 state record (editor 1.8.0 RE).
 * `off` null = not mirrored in 0x1007 (EXP1 A/B lives in the patch).
 */
export const GLOBALS = Object.freeze({
  inputLevel: { id: 0x01, off: 0x06, type: "i16" }, // -20..+20 dB
  inputMode: { id: 0x02, off: 0x08, type: "u16" }, // 0 A.GT, 1 E.GT, 2 Line
  noCabL: { id: 0x03, off: 0x0a, type: "u16" },
  noCabR: { id: 0x04, off: 0x0c, type: "u16" },
  usbRecLevel: { id: 0x05, off: 0x0e, type: "i16" },
  recModeL: { id: 0x06, off: 0x10, type: "u16" }, // 0 Dry, 1 Effect
  recModeR: { id: 0x07, off: 0x12, type: "u16" },
  auxToUsb: { id: 0x08, off: 0x14, type: "u16" },
  usbMonitorLevel: { id: 0x09, off: 0x16, type: "i16" },
  exp2Mode: { id: 0x0c, off: 0x2d, type: "u8" }, // 0 Pedal, 1 Single FS, 2 Double FS (LT: EXP/FS 2)
  exp1Mode: { id: 0x0d, off: 0x2c, type: "u8" }, // LT only: EXP/FS 1
  midiInSource: { id: 0x0e, off: 0x1c, type: "u16" }, // 0 DIN/TRS, 1 USB, 2 Mixed
  midiInChannelDin: { id: 0x0f, off: 0x1e, type: "i16" }, // 0 Omni, 1..16
  midiInChannelUsb: { id: 0x10, off: 0x20, type: "i16" },
  midiOutChannelDin: { id: 0x11, off: 0x22, type: "i16" }, // -1 off, 0 Omni, 1..16
  midiOutChannelUsb: { id: 0x12, off: 0x24, type: "i16" },
  clockSource: { id: 0x13, off: 0x26, type: "u16" }, // 0 Internal, 1 DIN/TRS, 2 USB, 3 External, 4 Mixed
  clockOutDin: { id: 0x14, off: 0x28, type: "u16" },
  clockOutUsb: { id: 0x15, off: 0x2a, type: "u16" },
  fsMode: { id: 0x18, off: 0x30, type: "u16" }, // 0 Preset, 1 Stomp, 2 User
  exp1AB: { id: 0x19, off: null, type: "u8" }, // 0 A, 1 B (stored in the current patch)
  extFs1: { id: 0x1a, off: 0x32, type: "u8" }, // LT: EXT FS 1 function
  extFs2: { id: 0x1c, off: 0x34, type: "u8" }, // LT: EXT FS 2 function
  globalEq: { id: 0x1e, off: 0x3a, type: "u16" },
  extFs1Tap: { id: 0x1f, off: 0x3c, type: "u16" }, // LT: EXT FS 3
  extFs2Tap: { id: 0x21, off: 0x40, type: "u16" }, // LT: EXT FS 4
  bankSelectMode: { id: 0x23, off: 0x44, type: "u16" }, // 0 Wait, 1 Direct
  autoCabMatch: { id: 0x24, off: 0x46, type: "u16" },
  displayMode: { id: 0x28, off: 0x39, type: "u8" }, // 0 Footswitch, 1 Patch, 2 Signal Chain
});
const GLOBAL_BY_ID = new Map(Object.entries(GLOBALS).map(([name, g]) => [g.id, name]));
export const globalNameById = (id) => GLOBAL_BY_ID.get(id) ?? null;
/** 0x1008 ids that destroy data: delete User IR, reset footswitch settings, delete SnapTone. */
export const DESTRUCTIVE_GLOBAL_IDS = Object.freeze([0x17, 0x27, 0x29]);
export const SELECT_ID = 0x00;
export const GLOBALS_RECORD_SIZE = 72;
export const GLOBAL_EQ_BANDS = 31;
/** Global EQ (0x1004 f32[31]) layout. */
export const GLOBAL_EQ_INDEX = Object.freeze({
  lowCut: { en: 0, freq: 1 },
  lowShelf: { en: 3, freq: 4, q: 5, gain: 6 },
  band1: { en: 7, freq: 8, q: 9, gain: 10 },
  band2: { en: 11, freq: 12, q: 13, gain: 14 },
  band3: { en: 15, freq: 16, q: 17, gain: 18 },
  band4: { en: 19, freq: 20, q: 21, gain: 22 },
  highShelf: { en: 23, freq: 24, q: 25, gain: 26 },
  highCut: { en: 27, freq: 28 },
  level: 30,
});

/** User IR record facts: 20 slots of 1024 int32 samples (24-bit, 44.1 kHz). */
export const USER_IR = Object.freeze({ SLOTS: 20, SAMPLES: 1024, DATA_BYTES: 4096, RATE: 44100, FXID_BASE: 0x0a100000 });
/** Size of the SnapTone blob field in record 0x1013. */
export const SNAPTONE_FIELD = 0x2000;

// ------------------------------------------------------------------------------------------- bytes

export const u16le = (v) => [v & 0xff, (v >>> 8) & 0xff];
export const u32le = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
export function f32le(v) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v, true);
  return [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
}
export const readU16 = (b, o) => b[o] | (b[o + 1] << 8);
export const readI16 = (b, o) => (readU16(b, o) << 16) >> 16;
export const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const readF32 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);
export const byteSum = (bytes) => bytes.reduce((s, x) => (s + x) >>> 0, 0);
const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Fixed-width ASCII field (zero padded). Callers sanitize first: see sanitizeName. */
export function asciiField(text, width) {
  const out = new Array(width).fill(0);
  const s = String(text ?? "");
  for (let i = 0; i < Math.min(width, s.length); i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}
export function readAscii(b, o, width) {
  let s = "";
  for (let i = o; i < o + width && b[i]; i++) s += String.fromCharCode(b[i]);
  return s;
}
/** Names on the GP-200 are printable ASCII (0x20-0x7E), at most `width` characters. */
export function sanitizeName(name, width = NAME_FIELD) {
  return Array.from(String(name ?? ""))
    .filter((c) => c >= " " && c <= "~")
    .join("")
    .slice(0, width);
}

export function toHex(bytes, sep = " ") {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(sep);
}
export function fromHex(hex) {
  const s = String(hex).replace(/[^0-9a-f]/gi, "");
  if (s.length % 2) throw new RangeError("hex string has an odd number of digits");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

// ------------------------------------------------------------------------------------------- framing

/**
 * Message -> wire frames. msg = { cmd, payload, len? } (len defaults to payload length) or { cmd, address, data? }.
 * `chunk` is the decoded bytes per frame: 183 for the host, 185 for the device (simulator).
 */
export function encodeFrames(msg, chunk = CHUNK.HOST) {
  if (msg.address) return [Uint8Array.from([...SYSEX_ID, msg.cmd, ...msg.address, ...(msg.data ?? []), 0xf7])];
  const p = toBytes(msg.payload ?? []);
  const len = msg.len ?? p.length;
  if (len > MAX_MESSAGE) throw new RangeError(`message of ${len} bytes exceeds the 14-bit length field`);
  const frames = [];
  for (let off = 0; off === 0 || off < p.length; off += chunk) {
    const part = p.subarray(off, off + chunk);
    const f = new Uint8Array(HEAD + 2 * part.length + 1);
    f.set(SYSEX_ID);
    f[8] = msg.cmd;
    f[9] = len & 0x7f;
    f[10] = (len >> 7) & 0x7f;
    f[11] = off & 0x7f;
    f[12] = (off >> 7) & 0x7f;
    for (let i = 0; i < part.length; i++) {
      f[HEAD + 2 * i] = part[i] >> 4;
      f[HEAD + 2 * i + 1] = part[i] & 0x0f;
    }
    f[f.length - 1] = 0xf7;
    frames.push(f);
  }
  return frames;
}

const isGp2 = (b) => b.length >= 10 && b[0] === 0xf0 && b[b.length - 1] === 0xf7 && SYSEX_ID.every((x, i) => b[i] === x);
const addressIs = (b, a) => a.every((x, i) => b[9 + i] === x);

/**
 * One wire frame -> { kind: "data", cmd, len, off, data } | { kind: "address", cmd, address, data } |
 * { kind: "flush", cmd } | null (not a GP-200 frame or malformed).
 */
export function decodeFrame(bytes) {
  const b = toBytes(bytes);
  if (!isGp2(b)) return null;
  const cmd = b[8];
  if (cmd === CMD.FLUSH) return { kind: "flush", cmd };
  if (b.length >= 14 && b.length <= 16) {
    // SOFTWARE_STATE replies are 15/16 bytes with raw state/type bytes; the editor matches on the address only
    if (addressIs(b, ADDRESS.SOFTWARE_STATE)) return { kind: "address", cmd, address: "softwareState", data: b.slice(13, -1) };
    if (addressIs(b, ADDRESS.SOFTWARE_JUMP)) return { kind: "address", cmd, address: "softwareJump", data: b.slice(13, -1) };
  }
  const nibbles = b.length - HEAD - 1;
  if (nibbles < 0 || nibbles % 2) return null;
  const data = new Uint8Array(nibbles / 2);
  for (let i = 0; i < data.length; i++) data[i] = ((b[HEAD + 2 * i] << 4) | b[HEAD + 2 * i + 1]) & 0xff;
  return { kind: "data", cmd, len: b[9] | (b[10] << 7), off: b[11] | (b[12] << 7), data };
}

/**
 * Chunk reassembly, strictly by OFF (editor RX): OFF 0 starts a message, a chunk whose OFF differs from the bytes
 * received so far is dropped, the message completes at LEN, a partial message goes stale after `staleMs`.
 * `shortChunkEnds` (simulator side): a host chunk shorter than 183 bytes ends the message, because queries may
 * declare the length of the record they ask for but carry fewer bytes.
 */
export class Reassembler {
  #buf = null;
  #cmd = 0;
  #got = 0;
  #at = 0;
  #staleMs;
  #now;
  #shortChunk;

  constructor({ staleMs = 600, now = () => Date.now(), shortChunkEnds = 0 } = {}) {
    this.#staleMs = staleMs;
    this.#now = now;
    this.#shortChunk = shortChunkEnds;
  }

  reset() {
    this.#buf = null;
    this.#got = 0;
  }

  /** Feed a decodeFrame() result of kind "data"; returns { cmd, payload } when a message is complete, else null. */
  push(frame) {
    const t = this.#now();
    if (this.#buf && t - this.#at > this.#staleMs) this.reset();
    if (frame.off === 0) {
      this.#buf = new Uint8Array(frame.len);
      this.#cmd = frame.cmd;
      this.#got = 0;
    } else if (!this.#buf || frame.off !== this.#got || frame.len !== this.#buf.length || frame.cmd !== this.#cmd) {
      return null;
    }
    const n = Math.min(frame.data.length, this.#buf.length - this.#got);
    this.#buf.set(frame.data.subarray(0, n), this.#got);
    this.#got += n;
    this.#at = t;
    const short = this.#shortChunk > 0 && this.#cmd === CMD.QUERY && frame.data.length < this.#shortChunk; // a SET may arrive in small chunks
    if (this.#got < this.#buf.length && !short) return null;
    const out = { cmd: this.#cmd, payload: this.#buf.slice(0, this.#got) };
    this.reset();
    return out;
  }
}

/**
 * Splits a MIDI byte stream into whole messages. Chromium on Linux (ALSA sequencer) and RtMidi may deliver a
 * 380-byte SysEx in fragments; short messages (CC/PC) arrive whole. Real-time bytes inside SysEx are dropped.
 */
export class SysexAssembler {
  #buf = null;

  push(bytes) {
    const b = toBytes(bytes);
    if (!this.#buf && b[0] !== 0xf0) return b.length ? [b] : [];
    const out = [];
    for (const x of b) {
      if (x === 0xf0) this.#buf = [x];
      else if (!this.#buf || x >= 0xf8) continue;
      else {
        this.#buf.push(x);
        if (x === 0xf7) {
          out.push(Uint8Array.from(this.#buf));
          this.#buf = null;
        }
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------- TLV

/** One TLV record; `declaredLen` covers records whose header claims more than is sent (0x0013). */
export function tlv(type, data = [], declaredLen) {
  const d = toBytes(data);
  return Uint8Array.from([...u16le(type), ...u16le(declaredLen ?? d.length), ...d]);
}

/** Walk a TLV payload: [{ type, len, offset, data, truncated }]. A short last record is returned with truncated = true. */
export function walkTlv(payload) {
  const p = toBytes(payload);
  const out = [];
  for (let o = 0; o + 4 <= p.length; ) {
    const type = readU16(p, o);
    const len = readU16(p, o + 2);
    const end = Math.min(p.length, o + 4 + len);
    out.push({ type, len, offset: o, data: p.subarray(o + 4, end), truncated: end < o + 4 + len });
    o = o + 4 + len;
  }
  return out;
}

/**
 * Patch image with the slot written into 0x0002 (+0) and 0x0008 (+0), as the editor does before a full write.
 * Returns a copy.
 */
export function imageWithSlot(image, slot) {
  const out = toBytes(image).slice();
  for (const r of walkTlv(out)) {
    if ((r.type === REC.INFO || r.type === REC.CHAIN) && r.data.length >= 2) out.set(u16le(slot), r.offset + 4);
  }
  return out;
}

// ------------------------------------------------------------------------------------------- record builders

const nameRecord = (type, slot, text, width = NAME_FIELD) => tlv(type, [...u16le(slot), 0, 0, ...asciiField(text, width)]);
const i16 = (v) => u16le(Math.trunc(v) & 0xffff);

/** Record builders: each returns the TLV bytes of one record. Bytes the editor leaves uninitialised are 0. */
export const rec = {
  header: (a, b) => tlv(REC.HEADER, [...u16le(a), ...u16le(b)]),
  /** 0x0001 read request / write preamble: slot or 0xFFFF for the edit buffer. */
  read: (slot) => tlv(REC.READ, [...u16le(slot), 0, 0]),
  param: ({ block, paramId, fxid, value }) => tlv(REC.PARAM, [block, paramId, 0, 0, ...u32le(fxid), ...f32le(value)]),
  patchSetting: (target, value) => tlv(REC.PATCH_SETTING, [...u16le(target), ...i16(value)]),
  name: (slot, text) => nameRecord(REC.NAME, slot, text),
  /** 0x0008 chain / FX loop; the editor sends 4 zero bytes after the record. */
  chain: (slot, { sendPos, returnPos, order }) => concat([tlv(REC.CHAIN, [...u16le(slot), sendPos, returnPos, ...order, 0]), new Uint8Array(4)]),
  author: (slot, text) => nameRecord(REC.AUTHOR, slot, text),
  styleName: (index, text) => nameRecord(REC.STYLE_NAME, index, text),
  note: (slot, text) => nameRecord(REC.NOTE, slot, text, 40),
  /** EXP slot: key = exp << 4 | para (exp 0 EXP1A, 1 EXP1B, 2 EXP2), block 0xFF = none. */
  exp: ({ key, block, param, max, min }) => tlv(REC.EXP, [key, block, ...u16le(param), ...f32le(max), ...f32le(min)]),
  expRange: (which, key, value) => tlv(REC.EXP_RANGE, [which === "max" ? 1 : 0, key, 0, 0, ...f32le(value)]),
  ctrl: (index, state, mask) => tlv(REC.CTRL, [index, state, 0, 0, ...u16le(mask), 0, 0]),
  quickAccess: (index, block, param) => tlv(REC.QUICK_ACCESS, [index, block, ...u16le(param)]),
  /** 0x0013 declares 8 bytes but the editor sends 4. */
  focus: (block) => tlv(REC.FOCUS, [block, 0, 0, 0], 8),
  block: ({ block, enabled, fxid, params, opaque = 0x000f }) =>
    tlv(REC.BLOCK, [block, enabled ? 1 : 0, ...u16le(opaque), ...u32le(fxid), ...Array.from({ length: PARAM_COUNT }, (_, i) => f32le(params?.[i] ?? 0)).flat()]),
  blockOn: (block, on) => tlv(REC.BLOCK_ON, [block, on ? 1 : 0, 0, 0]),
  model: (block, fxid) => tlv(REC.MODEL, [block, 0, 0, 0, ...u32le(fxid)]),
  /** 0x1000 drum/EXP state query: the editor sends 6 uninitialised bytes. */
  drumStateQuery: () => tlv(REC.DRUM_STATE, new Uint8Array(6)),
  drumState: ({ playing, flag = 0, exp1AB = 0 }) => tlv(REC.DRUM_STATE, [...u16le(playing ? 1 : 0), ...u16le(flag), ...u16le(exp1AB)]),
  drum: (id, value) => tlv(REC.DRUM, [...u16le(id), ...u16le(value)]),
  globalEq: (index, value) => tlv(REC.GLOBAL_EQ, [...u16le(index), 0, 0, ...f32le(value)]),
  stateDump: () => tlv(REC.STATE_DUMP),
  /** 0x1007 state record (device -> host only: a host write overwrites every global). */
  globals: (bytes72) => tlv(REC.GLOBALS, bytes72),
  system: (id, value) => tlv(REC.SYSTEM, [...u16le(id), ...i16(value)]),
  irNameQuery: (slot) => tlv(REC.IR_NAME, [...u16le(slot), ...u16le(1), ...new Array(20).fill(0)]),
  snapToneNameQuery: (slot) => tlv(REC.SNAPTONE_NAME, [...u16le(slot), ...u16le(1), ...new Array(20).fill(0)]),
  /** 0x1009 / 0x1012 reply {slot, flag, u32 sum, name[16]}. */
  nameEntry: (type, slot, flag, sum, name) => tlv(type, [...u16le(slot), ...u16le(flag), ...u32le(sum), ...asciiField(name, NAME_FIELD)]),
  uploadResult: (type, slot, status) => tlv(type, [...u16le(slot), ...u16le(status), 0, 0, 0, 0]),
  irRename: (slot, text) => nameRecord(REC.IR_RENAME, slot, text),
  snapToneRename: (slot, text) => nameRecord(REC.SNAPTONE_RENAME, slot, text),
  fsFunction: (fsMode, record, func) => tlv(REC.FS_FUNCTION, [...u16le(fsMode), record, func]),
  status: (sub, value) => tlv(REC.STATUS, [...u16le(sub), ...u16le(value)]),
  identity: () => tlv(REC.IDENTITY),
  identityReply: (state, type) => tlv(REC.IDENTITY, [...u16le(state), ...u16le(type)]),
  save: (slot, text) => nameRecord(REC.SAVE, slot, text),
  favourite: (slot, add) => tlv(REC.FAVOURITE, [...u16le(slot), add ? 1 : 0, 0]),
  move: (from, to) => tlv(REC.MOVE, [...u16le(from), ...u16le(to)]),
  moveCommit: () => tlv(REC.MOVE_COMMIT, [1, 0, 0, 0]),
  deletePatch: (slot) => tlv(REC.DELETE, [...u16le(slot), 0, 0]),
  /** User IR record 0x100A: {slot, 0, u32 sum of the 4096 PCM bytes, name[16], int32[1024]} (samples zero-padded). */
  userIr: (slot, name, samples) => {
    if (samples.length > USER_IR.SAMPLES) throw new RangeError(`a User IR holds ${USER_IR.SAMPLES} samples, got ${samples.length}`);
    const pcm = new Uint8Array(USER_IR.DATA_BYTES);
    const dv = new DataView(pcm.buffer);
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      if (!Number.isInteger(v) || v < -0x800000 || v > 0x7fffff) throw new RangeError(`User IR sample ${i} is not a 24-bit integer: ${v}`);
      dv.setInt32(4 * i, v, true);
    }
    return tlv(REC.IR_UPLOAD, [...u16le(slot), 0, 0, ...u32le(byteSum(pcm)), ...asciiField(name, NAME_FIELD), ...pcm]);
  },
  /** SnapTone record 0x1013: {slot, 0, u32 sum of the blob field, name[16], blob zero-padded to 0x2000}. */
  snapTone: (slot, name, blob) => {
    const b = toBytes(blob);
    if (b.length > SNAPTONE_FIELD) throw new RangeError(`SnapTone blob of ${b.length} bytes exceeds ${SNAPTONE_FIELD}`);
    const field = new Uint8Array(SNAPTONE_FIELD);
    field.set(b);
    return tlv(REC.SNAPTONE_UPLOAD, [...u16le(slot), 0, 0, ...u32le(byteSum(field)), ...asciiField(name, NAME_FIELD), ...field]);
  },
};

// ------------------------------------------------------------------------------------------- host messages

const query = (...records) => ({ cmd: CMD.QUERY, payload: concat(records) });
const set = (...records) => ({ cmd: CMD.SET, payload: concat(records) });
const edit = (cur, ...records) => set(rec.header(0, cur), ...records);

/** Host messages ({ cmd, payload } or an address frame). `cur` = the current slot (edit-buffer header {0, cur}). */
export const encode = {
  identity: () => query(rec.identity()),
  softwareState: () => ({ cmd: CMD.QUERY, address: ADDRESS.SOFTWARE_STATE }),
  stateDump: () => query(rec.stateDump()),
  drumState: () => query(rec.drumStateQuery()),
  irName: (slot) => query(rec.irNameQuery(slot)),
  snapToneName: (slot) => query(rec.snapToneNameQuery(slot)),
  /** Style-group name query: 0x000A as a query with an empty name (layout inferred from the set record). */
  styleName: (index) => query(rec.styleName(index, "")),
  readStored: (slot) => query(rec.header(1, slot), rec.read(slot)),
  readEditBuffer: (cur) => query(rec.header(0, cur), rec.read(0xffff)),
  select: (slot) => set(rec.system(SELECT_ID, slot)),
  param: (cur, p) => edit(cur, rec.param(p)),
  blockEnabled: (cur, block, on) => edit(cur, rec.blockOn(block, on)),
  model: (cur, block, fxid) => edit(cur, rec.model(block, fxid)),
  chain: (cur, chain) => edit(cur, rec.chain(cur, chain)),
  patchSetting: (cur, target, value) => edit(cur, rec.patchSetting(target, value)),
  patchName: (cur, name) => edit(cur, rec.name(cur, name)),
  author: (cur, text) => edit(cur, rec.author(cur, text)),
  note: (cur, text) => edit(cur, rec.note(cur, text)),
  exp: (cur, slotDef) => edit(cur, rec.exp(slotDef)),
  expRange: (cur, which, key, value) => edit(cur, rec.expRange(which, key, value)),
  ctrl: (cur, index, state, mask) => edit(cur, rec.ctrl(index, state, mask)),
  quickAccess: (cur, index, block, param) => edit(cur, rec.quickAccess(index, block, param)),
  focus: (cur, block) => edit(cur, rec.focus(block)),
  /** Store the edit buffer into absolute slot `slot`; the device echoes the record when done. */
  save: (slot, name) => set(rec.save(slot, name)),
  /** Full write: preamble {1,slot}{slot,0} + 1168-byte image with the slot set inside (LEN 1184, 7 frames). */
  fullWrite: (slot, image) => set(rec.header(1, slot), rec.read(slot), imageWithSlot(image, slot)),
  global: (id, value) => set(rec.system(id, value)),
  globalEq: (index, value) => set(rec.globalEq(index, value)),
  drumPlay: (on) => set(rec.status(STATUS.DRUM, on ? 1 : 0)),
  drum: (id, value) => set(rec.drum(id, value)),
  setStyleName: (index, name) => set(rec.styleName(index, name)),
  userIr: (slot, name, samples) => set(rec.userIr(slot, name, samples)),
  irRename: (slot, name) => set(rec.irRename(slot, name)),
  snapTone: (slot, name, blob) => set(rec.snapTone(slot, name, blob)),
  snapToneRename: (slot, name) => set(rec.snapToneRename(slot, name)),
  fsFunction: (fsMode, record, func) => set(rec.fsFunction(fsMode, record, func)),
  favourite: (slot, add) => set(rec.favourite(slot, add)),
  move: (from, to) => set(rec.move(from, to)),
  moveCommit: () => set(rec.moveCommit()),
  deletePatch: (slot) => set(rec.header(1, slot), rec.deletePatch(slot)),
};

// ------------------------------------------------------------------------------------------- safety

/**
 * Why a wire frame must never be sent, or null when it is allowed:
 * the bootloader updater (F0 7E 48 ...), SOFTWARE_JUMP, the 0x2000 firmware-jump prelude, a 0x1007 write
 * (overwrites every global) and the destructive 0x1008 ids (delete IR / delete SnapTone / reset footswitches).
 * Only the first chunk of a message can be inspected; dangerOfMessage checks whole messages.
 */
export function dangerOf(bytes) {
  const b = toBytes(bytes);
  if (b[0] === 0xf0 && b[1] === 0x7e && b[2] === 0x48) return "bootloader updater frame (F0 7E 48)";
  const f = decodeFrame(b);
  if (!f) return null;
  if (f.kind === "address") return f.address === "softwareJump" ? "SOFTWARE_JUMP (reboots into firmware-update mode)" : null;
  if (f.kind !== "data" || f.off !== 0) return null;
  return dangerOfRecords(f.cmd, f.data);
}

/** dangerOf for a whole message ({ cmd, payload } or an address message). */
export function dangerOfMessage(msg) {
  if (msg.address) return addressIs([...SYSEX_ID, msg.cmd, ...msg.address], ADDRESS.SOFTWARE_JUMP) ? "SOFTWARE_JUMP (reboots into firmware-update mode)" : null;
  return dangerOfRecords(msg.cmd, toBytes(msg.payload));
}

function dangerOfRecords(cmd, payload) {
  for (const r of walkTlv(payload)) {
    if (r.type === REC.FIRMWARE_JUMP) return "0x2000 firmware-jump prelude";
    if (r.type === REC.GLOBALS && cmd === CMD.SET) return "0x1007 write (overwrites every global setting)";
    if (r.type === REC.SYSTEM && r.data.length >= 2 && DESTRUCTIVE_GLOBAL_IDS.includes(readU16(r.data, 0))) {
      return `destructive 0x1008 id 0x${readU16(r.data, 0).toString(16)} (delete IR / delete SnapTone / reset footswitches)`;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------- decoding

const readTyped = (d, off, type) => (type === "u8" ? d[off] : type === "i16" ? readI16(d, off) : readU16(d, off));

/** 0x1007 payload -> { currentSlot, values: { [GLOBALS name]: number } }. */
export function decodeGlobals(d) {
  const values = {};
  for (const [name, g] of Object.entries(GLOBALS)) if (g.off !== null && g.off + (g.type === "u8" ? 1 : 2) <= d.length) values[name] = readTyped(d, g.off, g.type);
  return { currentSlot: d.length >= 6 ? readU16(d, 4) : null, values };
}

/** Inverse of decodeGlobals (simulator). */
export function encodeGlobals({ currentSlot, values }) {
  const d = new Uint8Array(GLOBALS_RECORD_SIZE);
  d.set([0x00, 0x06, 0x01, 0x00], 0); // the first 4 bytes of every 0x1007 seen (GP-200 1.8.0, JR 1.8.0): not a firmware version, #136
  d.set(u16le(currentSlot), 4);
  for (const [name, g] of Object.entries(GLOBALS)) {
    const v = values[name];
    if (g.off === null || v === undefined) continue;
    if (g.type === "u8") d[g.off] = v & 0xff;
    else d.set(u16le(v & 0xffff), g.off);
  }
  return d;
}

const nameEntry = (d) => ({ slot: readU16(d, 0), flag: readU16(d, 2), sum: readU32(d, 4), name: readAscii(d, 8, NAME_FIELD) });
const expKey = (key) => ({ key, pedal: key >> 4, para: key & 0x0f });

/** One TLV record -> a plain object with `kind` (also used as the session event type). */
export function decodeRecord({ type, data: d }) {
  switch (type) {
    case REC.HEADER:
      return { kind: "header", a: readU16(d, 0), b: readU16(d, 2) };
    case REC.READ:
      return { kind: "read", slot: readU16(d, 0) };
    case REC.INFO:
      return { kind: "patchInfo", slot: readU16(d, 0), name: readAscii(d, 16, NAME_FIELD) };
    case REC.PARAM:
      return { kind: "param", block: d[0], paramId: d[1], fxid: readU32(d, 4), value: readF32(d, 8) };
    case REC.PATCH_SETTING:
      return { kind: "patchSetting", target: readU16(d, 0), value: readU16(d, 0) === PATCH_SETTING.PAN ? readI16(d, 2) : readU16(d, 2) };
    case REC.NAME:
      return { kind: "patchName", slot: readU16(d, 0), name: readAscii(d, 4, NAME_FIELD) };
    case REC.CHAIN:
      return { kind: "chain", slot: readU16(d, 0), sendPos: d[2], returnPos: d[3], order: Array.from(d.subarray(4, 15)) };
    case REC.AUTHOR:
      return { kind: "author", slot: readU16(d, 0), text: readAscii(d, 4, NAME_FIELD) };
    case REC.STYLE_NAME:
      return { kind: "styleName", index: readU16(d, 0), name: readAscii(d, 4, NAME_FIELD) };
    case REC.NOTE:
      return { kind: "note", slot: readU16(d, 0), text: readAscii(d, 4, 40) };
    case REC.EXP:
      return { kind: "exp", ...expKey(d[0]), block: d[1] === TARGET.NONE ? null : d[1], param: readU16(d, 2), max: readF32(d, 4), min: readF32(d, 8) };
    case REC.EXP_RANGE:
      return { kind: "expRange", which: d[0] === 1 ? "max" : "min", ...expKey(d[1]), value: readF32(d, 4) };
    case REC.CTRL:
      return { kind: "ctrl", index: d[0], state: d[1], mask: readU16(d, 4) & 0x7ff };
    case REC.QUICK_ACCESS:
      return { kind: "quickAccess", index: d[0], block: d[1] === TARGET.NONE ? null : d[1], param: d[2] };
    case REC.FOCUS:
      return { kind: "focus", block: d[0] };
    case REC.BLOCK:
      return { kind: "block", block: d[0], enabled: d[1] === 1, fxid: readU32(d, 4), params: Array.from({ length: PARAM_COUNT }, (_, i) => readF32(d, 8 + 4 * i)) };
    case REC.BLOCK_ON:
      return { kind: "blockEnabled", block: d[0], enabled: d[1] === 1 };
    case REC.MODEL:
      return { kind: "model", block: d[0], fxid: readU32(d, 4) };
    case REC.DRUM_STATE:
      return { kind: "drumState", playing: readU16(d, 0) === 1, flag: readU16(d, 2), exp1AB: readU16(d, 4) };
    case REC.DRUM:
      return { kind: "drum", id: readU16(d, 0), value: readU16(d, 2) };
    case REC.GLOBAL_EQ_ALL:
      return { kind: "globalEqAll", values: Array.from({ length: Math.floor(d.length / 4) }, (_, i) => readF32(d, 4 * i)) };
    case REC.GLOBAL_EQ:
      return { kind: "globalEq", index: readU16(d, 0), value: readF32(d, 4) };
    case REC.STATE_DUMP:
      return { kind: "stateDump" };
    case REC.GLOBALS:
      return { kind: "globals", ...decodeGlobals(d) };
    case REC.SYSTEM: {
      const id = readU16(d, 0);
      const value = readI16(d, 2);
      return id === SELECT_ID ? { kind: "patchChanged", slot: readU16(d, 2) } : { kind: "global", id, name: globalNameById(id), value };
    }
    case REC.IR_NAME:
      return { kind: "irName", ...nameEntry(d) };
    case REC.SNAPTONE_NAME:
      return { kind: "snapToneName", ...nameEntry(d) };
    case REC.IR_RESULT:
      return { kind: "irResult", slot: readU16(d, 0), status: readU16(d, 2), ok: readU16(d, 2) === 1 };
    case REC.SNAPTONE_RESULT:
      return { kind: "snapToneResult", slot: readU16(d, 0), status: readU16(d, 2), ok: readU16(d, 2) === 1 };
    case REC.IR_RENAME:
      return { kind: "irRename", slot: readU16(d, 0), name: readAscii(d, 4, NAME_FIELD) };
    case REC.SNAPTONE_RENAME:
      return { kind: "snapToneRename", slot: readU16(d, 0), name: readAscii(d, 4, NAME_FIELD) };
    case REC.IR_UPLOAD:
      return { kind: "irUpload", slot: readU16(d, 0), sum: readU32(d, 4), name: readAscii(d, 8, NAME_FIELD), pcm: d.subarray(24) };
    case REC.SNAPTONE_UPLOAD:
      return { kind: "snapToneUpload", slot: readU16(d, 0), sum: readU32(d, 4), name: readAscii(d, 8, NAME_FIELD), blob: d.subarray(24) };
    case REC.FS_FUNCTION:
      return { kind: "fsFunction", fsMode: readU16(d, 0), record: d[2], func: d[3] };
    case REC.STATUS: {
      const sub = readU16(d, 0);
      const v = readU16(d, 2);
      if (sub === STATUS.DIRTY) return { kind: "dirty", dirty: v !== 0 };
      if (sub === STATUS.EXP1_AB) return { kind: "exp1AB", value: v };
      return sub === STATUS.DRUM ? { kind: "drumPlaying", playing: v !== 0 } : { kind: "status", sub, value: v };
    }
    case REC.IDENTITY:
      return d.length >= 4 ? { kind: "identity", state: readU16(d, 0), deviceType: readU16(d, 2) } : { kind: "identityQuery" };
    case REC.SAVE:
      return { kind: "saved", slot: readU16(d, 0), name: readAscii(d, 4, NAME_FIELD) };
    case REC.RESET_PROGRESS:
      return { kind: "resetProgress", percent: readU16(d, 0) };
    case REC.FAVOURITE:
      return { kind: "slotModified", slot: readU16(d, 0), flag: d[2] };
    case REC.MOVE:
      return { kind: "move", from: readU16(d, 0), to: readU16(d, 2) };
    case REC.MOVE_COMMIT:
      return { kind: "moveCommit" };
    case REC.DELETE:
      return { kind: "delete", slot: readU16(d, 0) };
    default:
      return { kind: "unknown", type, data: d };
  }
}

/**
 * Reassembled message -> { cmd, header, records, patch }. `patch` is set for a patch reply (header + 0x0002):
 * { stored: header.a === 1, slot: header.b, image } where image = everything after the header record.
 */
export function decodeMessage({ cmd, payload }) {
  const raw = walkTlv(payload);
  const records = raw.filter((r) => !r.truncated && !(r.type === 0 && r.len === 0)).map(decodeRecord);
  const header = records[0]?.kind === "header" ? records[0] : null;
  const info = raw.find((r) => r.type === REC.INFO);
  const patch = header && info && cmd !== CMD.QUERY ? { stored: header.a === 1, slot: header.b, image: payload.slice(info.offset) } : null;
  return { cmd, header, records: header ? records.slice(1) : records, patch, payload };
}

/** SOFTWARE_STATE reply data -> { state (1 normal, 0 updater), deviceType | null }. */
export const decodeSoftwareState = (data) => ({ state: data[0] ?? null, deviceType: data.length > 1 ? data[1] : null });
