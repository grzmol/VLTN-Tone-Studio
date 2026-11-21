// The GrooveGurus firmware's mod service (gp-200-re RFC-0030; living spec: mods/cenas/src/servico.h there).
//
// The mod answers its own TLV record, 0x200C, inside the normal editor frames. 0x200C is an empty entry of the
// firmware's record handler table in V1.8.2, so a stock pedal skips it silently: a request just times out.
//
// Record data, little-endian: 12-byte header { u16 magic 0x4747 ("GG"), u8 service version, u8 op, u16 seq,
// u16 status, u32 arg } + payload (<= 1024 B). A reply repeats op and seq and is sent with cmd 0x12. NOTIFY is
// unsolicited, with the pedal's own seq, and only after a HELLO on the open port.
//
// Scene and settings records travel exactly as stored in the pedal's record store; this module also encodes and
// decodes them (format of gp-200-re src/gp200/cenas.py and mods/cenas/src/registro.c, versions 1-3).

import { concat, readU16, readU32, tlv, u16le, u32le } from "./protocol.mjs";

export const SERVICE_TYPE = 0x200c;
export const SERVICE_MAGIC = 0x4747;
export const SERVICE_VERSION = 1;
export const SERVICE_HEADER = 12;
export const SERVICE_PAYLOAD_MAX = 1024;
/** Record bytes per SCENE_READ / SCENE_WRITE message (payload minus the 4-byte prefix). */
export const RECORD_CHUNK = SERVICE_PAYLOAD_MAX - 4;
/** SCENE_READ target >= this reads the record-store index 258 + (target - 0x100) directly (orphans, backups). */
export const TARGET_INDEX = 0x100;

export const OP = Object.freeze({
  HELLO: 0x00,
  SCENE_LIST: 0x10,
  SCENE_READ: 0x11,
  SCENE_WRITE: 0x12,
  SCENE_DELETE: 0x13,
  SETTINGS_READ: 0x20,
  SETTINGS_WRITE: 0x21,
  GUESTS: 0x30,
  NOTIFY: 0x40,
});

export const STATUS = Object.freeze({
  OK: 0,
  VERSION: 1,
  OP: 2,
  BUSY: 3,
  NO_SPACE: 4,
  CHECKSUM: 5,
  OWNER: 6,
  LENGTH: 7,
  ARG: 8,
});
const STATUS_TEXT = Object.freeze({
  [STATUS.OK]: "ok",
  [STATUS.VERSION]: "the pedal doesn't speak this service version",
  [STATUS.OP]: "the pedal's mod doesn't know this request",
  [STATUS.BUSY]: "the pedal is busy (saving a scene, or reloading the active preset's scenes)",
  [STATUS.NO_SPACE]: "no free record for scenes on the pedal (42 presets with scenes at most)",
  [STATUS.CHECKSUM]: "the pedal refused the record as invalid",
  [STATUS.OWNER]: "the record belongs to another preset",
  [STATUS.LENGTH]: "wrong length",
  [STATUS.ARG]: "argument out of range",
});
export const statusText = (status) => STATUS_TEXT[status] ?? `status ${status}`;

/** HELLO feature bits. */
export const FEATURE = Object.freeze({
  HELLO: 1 << 0,
  SCENES_READ: 1 << 1,
  SCENES_WRITE: 1 << 2,
  SETTINGS_READ: 1 << 3,
  GUESTS: 1 << 4,
  NOTIFY: 1 << 5,
  SETTINGS_WRITE: 1 << 6,
});

/** NOTIFY event bits. */
export const NOTIFY = Object.freeze({ SCENE: 1 << 0, RECORD: 1 << 1, SETTINGS: 1 << 2 });

/** Active scene "none" (the preset plays its base). */
export const NO_SCENE = 0xff;

// ------------------------------------------------------------------------------------------- envelope

/** A 0x200C request record (TLV bytes). */
export function encodeRequest({ op, seq, arg = 0, payload = [], version = SERVICE_VERSION, magic = SERVICE_MAGIC }) {
  const p = Uint8Array.from(payload);
  return tlv(SERVICE_TYPE, concat([Uint8Array.from([...u16le(magic), version, op, ...u16le(seq), 0, 0, ...u32le(arg >>> 0)]), p]));
}

/** A 0x200C reply record (TLV bytes), as the pedal sends it: for simulators and tests. */
export function encodeReply({ op, seq, status = 0, arg = 0, payload = [] }) {
  const p = Uint8Array.from(payload);
  return tlv(SERVICE_TYPE, concat([Uint8Array.from([...u16le(SERVICE_MAGIC), SERVICE_VERSION, op, ...u16le(seq), ...u16le(status), ...u32le(arg >>> 0)]), p]));
}

/**
 * Data of a 0x200C record -> { kind: "modService" | "modNotify", op, seq, status, arg, payload }, or null when it is
 * not ours (no magic, too short).
 */
export function decodeServiceData(d) {
  if (d.length < SERVICE_HEADER || readU16(d, 0) !== SERVICE_MAGIC) return null;
  const op = d[3];
  return {
    kind: op === OP.NOTIFY ? "modNotify" : "modService",
    version: d[2],
    op,
    seq: readU16(d, 4),
    status: readU16(d, 6),
    arg: readU32(d, 8),
    payload: d.subarray(SERVICE_HEADER),
  };
}

/** A decoded protocol record ({ kind: "unknown", type, data }) -> service record, or the record unchanged. */
export function withModService(r) {
  if (r.kind !== "unknown" || r.type !== SERVICE_TYPE) return r;
  const s = decodeServiceData(r.data);
  if (!s) return r;
  return s.kind === "modNotify" ? { ...s, ...decodeNotify(s.payload) } : s;
}

const ascii = (b) => String.fromCharCode(...b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));

// ------------------------------------------------------------------------------------------- payloads

/** HELLO reply payload (28 B). */
export function decodeHello(p) {
  if (p.length < 28) throw new RangeError(`HELLO: ${p.length} bytes, expected 28`);
  const features = readU32(p, 16);
  return {
    name: ascii(p.subarray(0, 8)),
    letter: String.fromCharCode(p[8]),
    version: `${p[9]}.${p[10]}.${p[11]}`,
    firmwareTag: ascii(p.subarray(12, 16)),
    features,
    has: Object.fromEntries(Object.entries(FEATURE).map(([k, bit]) => [k, (features & bit) !== 0])),
    scenes: { used: p[20], free: p[21], total: p[22] },
    maxRecord: readU16(p, 24),
    maxFormat: readU16(p, 26),
  };
}

/** SCENE_LIST reply payload -> { free, total, records: [{ owner, slot | null, index, format, scenes, size }] }. */
export function decodeSceneList(p) {
  const n = p[0];
  const records = [];
  for (let i = 0, o = 4; i < n; i++, o += 12) {
    const slot = readU16(p, o + 2);
    records.push({ owner: readU16(p, o), slot: slot === 0xffff ? null : slot, index: p[o + 4], format: p[o + 5], scenes: p[o + 6], size: readU16(p, o + 8) });
  }
  return { free: p[1], total: p[2], records };
}

/** SCENE_READ / SETTINGS_READ reply payload -> { size, owner | index, bytes }. */
export function decodeRecordChunk(p) {
  return { size: readU16(p, 0), ref: readU16(p, 2), bytes: p.subarray(4) };
}

/** GUESTS reply payload -> [{ fxid, fromBlock, fromPos, sliceKb }]. */
export function decodeGuests(p) {
  return Array.from({ length: p[0] }, (_, i) => {
    const o = 4 + 8 * i;
    return { fxid: readU32(p, o), fromBlock: p[o + 4], fromPos: p[o + 5], sliceKb: readU16(p, o + 6) };
  });
}

/** NOTIFY payload (8 B). */
export function decodeNotify(p) {
  if (p.length < 8) return { events: 0 };
  return { events: p[0], sceneMode: p[1] === 1, activeScene: p[2] === NO_SCENE ? null : p[2], savedScenes: p[3], slot: readU16(p, 4), owner: readU16(p, 6) };
}

/** SCENE_WRITE payload of one chunk: u16 total | u16 0 | bytes. */
export const encodeWriteChunk = (total, bytes) => concat([Uint8Array.from([...u16le(total), 0, 0]), Uint8Array.from(bytes)]);

// ------------------------------------------------------------------------------------------- crc32

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** zlib crc32 (the firmware mod uses the same). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------------------------------- scene record

export const SCENE_MAGIC = "GPSC";
export const SCENE_FORMAT_MAX = 3;
export const SCENE_RECORD_MAX = 0x54c;
export const SCENE_COUNT = 4;
export const SCENE_NAME = 16;
const BLOCKS = 11;
const SLOTS = 15;
const RESERVE_BLOCKS = new Set([0, 3, 5]); // PRE, AMP, CAB
const F = Object.freeze({ MASK: 1, VOLUME: 2, BPM: 4, RESERVE: 8, PRE2: 16 });
const P2 = Object.freeze({ EXISTS: 1, ENABLED: 2 });

export class SceneRecordError extends Error {}

/** Default scene name ("CENA A".."CENA D"), as the pedal names an unnamed scene. */
export const defaultSceneName = (k) => `CENA ${"ABCD"[k]}`;

/**
 * Scene record bytes -> { format, owner, scenes: [scene | null] x 4, pre2: { fxid, enabled, params } | null }.
 * scene: { name, mask, volume, bpm (null = as the base), params: [{ block, slot, bits }], reserve: { [block]: { fxid,
 * params } }, pre2: boolean | null }. Values are raw f32 bits (u32), as stored. Throws SceneRecordError.
 */
export function decodeSceneRecord(data) {
  const d = Uint8Array.from(data);
  const fail = (why) => {
    throw new SceneRecordError(why);
  };
  if (d.length < 16) fail("too short for a header");
  if (ascii(d.subarray(0, 4)) !== SCENE_MAGIC) fail("not a scene record (magic)");
  const format = readU16(d, 4);
  if (format < 1 || format > SCENE_FORMAT_MAX) fail(`unknown format ${format}`);
  const owner = readU16(d, 6);
  const size = readU16(d, 8);
  const present = d[10];
  if (16 + size > d.length || 16 + size > SCENE_RECORD_MAX) fail("inconsistent size");
  const body = d.subarray(16, 16 + size);
  if (crc32(body) !== readU32(d, 12)) fail("checksum mismatch");
  let o = 0;
  const need = (n) => {
    if (o + n > body.length) fail("truncated body");
  };
  const u8 = () => (need(1), body[o++]);
  const u16 = () => (need(2), (o += 2), readU16(body, o - 2));
  const u32 = () => (need(4), (o += 4), readU32(body, o - 4));
  const u32s = (n) => Array.from({ length: n }, u32);
  const rec = { format, owner, scenes: [null, null, null, null], pre2: null };
  const reserves = {};
  if (format === 3) {
    const flags = u8();
    if (flags & ~(P2.EXISTS | P2.ENABLED)) fail("unknown PRE 2 flags");
    if (flags & P2.EXISTS) rec.pre2 = { fxid: u32(), enabled: (flags & P2.ENABLED) !== 0, params: u32s(SLOTS) };
    else if (flags) fail("PRE 2 enabled without a PRE 2");
  }
  if (format >= 2) {
    for (let n = u8(); n > 0; n--) {
      const block = u8();
      const fxid = u32();
      if (!RESERVE_BLOCKS.has(block) || block in reserves) fail(`bad reserve on block ${block}`);
      reserves[block] = fxid;
    }
  }
  for (let k = 0; k < SCENE_COUNT; k++) {
    if (!((present >> k) & 1)) continue;
    need(SCENE_NAME + 2);
    const name = ascii(body.subarray(o, o + SCENE_NAME));
    o += SCENE_NAME;
    const flags = u8();
    const n = u8();
    if (flags & ~(F.MASK | F.VOLUME | F.BPM | F.RESERVE | F.PRE2)) fail("unknown scene fields");
    const s = { name, mask: null, volume: null, bpm: null, params: [], reserve: {}, pre2: null };
    if (flags & F.MASK) s.mask = u16();
    if (flags & F.VOLUME) s.volume = u16();
    if (flags & F.BPM) s.bpm = u16();
    for (let i = 0; i < n; i++) {
      const block = u8();
      const slot = u8();
      if (block >= BLOCKS || slot >= SLOTS) fail(`parameter out of range (${block}, ${slot})`);
      s.params.push({ block, slot, bits: u32() });
    }
    if (flags & F.RESERVE) {
      if (format === 1) fail("reserve in a format 1 record");
      const blocks = u16();
      if (blocks >> BLOCKS) fail("reserve block out of range");
      for (let b = 0; b < BLOCKS; b++) {
        if (!((blocks >> b) & 1)) continue;
        if (!(b in reserves)) fail(`scene uses the reserve of block ${b}, missing from the table`);
        s.reserve[b] = { fxid: reserves[b], params: u32s(SLOTS) };
      }
    }
    if (flags & F.PRE2) {
      if (format !== 3 || !rec.pre2) fail("scene PRE 2 without the preset's PRE 2");
      const v = u8();
      if (v > 1) fail("scene PRE 2 out of range");
      s.pre2 = v === 1;
    }
    rec.scenes[k] = s;
  }
  if (o !== size) fail("bytes left after the last scene");
  return rec;
}

const isEmptyScene = (s) => s.mask == null && s.volume == null && s.bpm == null && !s.params?.length && !Object.keys(s.reserve ?? {}).length && s.pre2 == null;

/**
 * Scene record -> bytes, in the lowest format that holds it (1: plain; 2: reserves; 3: PRE 2), byte-identical to the
 * pedal's writer. Empty scenes are left out (saving a scene equal to the base deletes it).
 */
export function encodeSceneRecord({ owner, scenes = [], pre2 = null }) {
  if (!Number.isInteger(owner) || owner < 2 || owner > 257) throw new RangeError(`owner ${owner} is not a preset record (2-257)`);
  const reserves = {};
  for (const s of scenes) {
    for (const [b, r] of Object.entries(s?.reserve ?? {})) {
      const block = Number(b);
      if (!RESERVE_BLOCKS.has(block)) throw new SceneRecordError(`block ${block} has no reserve`);
      if ((reserves[block] ?? r.fxid) !== r.fxid) throw new SceneRecordError(`two scenes use different effects in the reserve of block ${block}`);
      if (r.params.length !== SLOTS) throw new SceneRecordError(`the reserve of block ${block} needs ${SLOTS} parameters`);
      reserves[block] = r.fxid;
    }
  }
  const scenePre2 = scenes.some((s) => s && s.pre2 != null);
  if (scenePre2 && !pre2) throw new SceneRecordError("a scene turns PRE 2 on or off, but the preset has no PRE 2");
  const v3 = !!pre2 || scenePre2;
  const reserveBlocks = Object.keys(reserves).map(Number).sort((a, b) => a - b);
  const body = [];
  const p16 = (v) => body.push(...u16le(v));
  const p32 = (v) => body.push(...u32le(v >>> 0));
  if (v3) {
    if (pre2.params.length !== SLOTS) throw new SceneRecordError(`PRE 2 needs ${SLOTS} parameters`);
    body.push(P2.EXISTS | (pre2.enabled ? P2.ENABLED : 0));
    p32(pre2.fxid);
    pre2.params.forEach(p32);
  }
  if (reserveBlocks.length || v3) {
    body.push(reserveBlocks.length);
    for (const b of reserveBlocks) body.push(b), p32(reserves[b]);
  }
  let present = 0;
  scenes.slice(0, SCENE_COUNT).forEach((s, k) => {
    if (!s || isEmptyScene(s)) return;
    const params = [...(s.params ?? [])].sort((a, b) => a.block - b.block || a.slot - b.slot);
    if (params.length > 255) throw new SceneRecordError("a scene can't have more than 255 changed parameters");
    const name = Array.from(s.name || defaultSceneName(k), (c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 0x3f)).slice(0, SCENE_NAME);
    body.push(...name, ...Array(SCENE_NAME - name.length).fill(0));
    const rb = Object.keys(s.reserve ?? {}).map(Number).sort((a, b) => a - b);
    const flags = (s.mask != null ? F.MASK : 0) | (s.volume != null ? F.VOLUME : 0) | (s.bpm != null ? F.BPM : 0) | (rb.length ? F.RESERVE : 0) | (s.pre2 != null ? F.PRE2 : 0);
    body.push(flags, params.length);
    if (s.mask != null) p16(s.mask);
    if (s.volume != null) p16(s.volume);
    if (s.bpm != null) p16(s.bpm);
    for (const p of params) body.push(p.block, p.slot), p32(p.bits);
    if (rb.length) {
      p16(rb.reduce((m, b) => m | (1 << b), 0));
      for (const b of rb) s.reserve[b].params.forEach(p32);
    }
    if (s.pre2 != null) body.push(s.pre2 ? 1 : 0);
    present |= 1 << k;
  });
  if (16 + body.length > SCENE_RECORD_MAX) throw new SceneRecordError(`the scenes take ${16 + body.length} B; a record holds ${SCENE_RECORD_MAX} B`);
  const format = v3 ? 3 : reserveBlocks.length ? 2 : 1;
  const b = Uint8Array.from(body);
  return concat([Uint8Array.from([0x47, 0x50, 0x53, 0x43, ...u16le(format), ...u16le(owner), ...u16le(b.length), present, 0, ...u32le(crc32(b))]), b]);
}

// ------------------------------------------------------------------------------------------- settings record

/** Mod settings record ("GPAJ", gp-200-re ADR-0030): { tapTempo: "preset" | "global" }. */
export function decodeSettingsRecord(data) {
  const d = Uint8Array.from(data);
  if (d.length < 20 || ascii(d.subarray(0, 4)) !== "GPAJ" || readU16(d, 4) !== 1 || readU16(d, 8) !== 4) throw new SceneRecordError("not a settings record");
  if (crc32(d.subarray(16, 20)) !== readU32(d, 12)) throw new SceneRecordError("settings checksum mismatch");
  return { tapTempo: d[16] === 1 ? "global" : "preset" };
}

export function encodeSettingsRecord({ tapTempo = "preset" } = {}) {
  const body = Uint8Array.from([tapTempo === "global" ? 1 : 0, 0, 0, 0]);
  return concat([Uint8Array.from([0x47, 0x50, 0x41, 0x4a, 1, 0, 0, 0, 4, 0, 0, 0, ...u32le(crc32(body))]), body]);
}

/** f32 bits <-> number, for the raw values of scene parameters. */
export function bitsToFloat(bits) {
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, bits >>> 0, true);
  return v.getFloat32(0, true);
}
export function floatToBits(x) {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, x, true);
  return v.getUint32(0, true);
}
