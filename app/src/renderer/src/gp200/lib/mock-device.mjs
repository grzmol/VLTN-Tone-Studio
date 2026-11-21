// In-memory GP-200 / GP-200LT / GP-200JR simulator speaking the USB protocol of protocol.mjs (GP-200 editor 1.8.0 RE).
// Use it for unit tests, UI development and as a virtual MIDI device.
// It models what the editor RE, captures and OSS hardware work show; unknown requests stay silent so host timeouts
// get exercised. Every reply is produced by this toolkit's own encoder. The bank is generated: Valeton's factory
// presets are never bundled (pass `images`, and a `catalog` for the generated patches' param defaults).

import {
  ADDRESS,
  BLOCKS,
  CHUNK,
  CMD,
  DESTRUCTIVE_GLOBAL_IDS,
  DEVICE_TYPES,
  GLOBALS,
  GLOBAL_EQ_BANDS,
  PARAM_COUNT,
  PATCH_SETTING,
  REC,
  Reassembler,
  SELECT_ID,
  SNAPTONE_FIELD,
  STATUS,
  STYLE_COUNT,
  SYSEX_ID,
  SysexAssembler,
  USER_IR,
  byteSum,
  concat,
  decodeFrame,
  decodeMessage,
  deviceByKey,
  encodeFrames,
  encodeGlobals,
  globalNameById,
  readU16,
  readU32,
  rec,
  slotLabel,
  readAscii,
  tlv,
  walkTlv,
} from "./protocol.mjs";
import { applyPatchEdits, encodePatchImage, expIndex, imageOf, normalizeStored, parsePatch } from "./prst.mjs";
import { SNAPTONE, checkGp200SnapTone } from "./snaptone.mjs";
import { defaultParams } from "./catalog.mjs";
import {
  FEATURE,
  NOTIFY,
  NO_SCENE,
  OP as MOD_OP,
  RECORD_CHUNK,
  SCENE_RECORD_MAX,
  SERVICE_TYPE,
  STATUS as MOD_STATUS,
  TARGET_INDEX,
  bitsToFloat,
  decodeSceneRecord,
  decodeServiceData,
  decodeSettingsRecord,
  encodeReply,
} from "./mod-service.mjs";

const MOD_INDICES = 42; // record-store indices 258-299
const MOD_DEFAULTS = Object.freeze({ name: "cenas", letter: "C", version: "0.7.0", firmwareTag: "V182", features: 0x7f, guests: {} });

/** One fxid per block for generated patches (ids seen in an editor-written patch of the RE vectors). */
const INIT_FXIDS = Object.freeze([0x00000001, 0x05000001, 0x03000000, 0x0700003a, 0x0000001b, 0x0a000024, 0x0100003c, 0x04000002, 0x0b00001f, 0x0c000001, 0x06000003]);
const STYLES = ["Rock", "Pop", "Blues", "Funk", "Jazz", "Metal", "Latin", "Country"];
const KINDS = ["Clean", "Crunch", "Lead", "Ambient"];
/** Global EQ defaults of the editor's model constructor (editor 1.8.0 RE). */
const GLOBAL_EQ_DEFAULTS = Object.freeze([1, 19, 0.71, 1, 20, 0.71, 0, 1, 100, 0.71, 0, 1, 500, 0.71, 0, 1, 1600, 0.71, 0, 1, 5000, 0.71, 0, 1, 20000, 0.71, 0, 1, 20001, 0.71, 50]);
const GLOBAL_DEFAULTS = Object.freeze({ inputMode: 1, recModeL: 1, recModeR: 1, midiInSource: 2, clockSource: 4 });
const BLOCK_CC = Object.freeze({ 48: 0, 49: 2, 50: 3, 51: 4, 52: 5, 53: 6, 54: 7, 55: 8, 56: 9, 57: 1 }); // CC -> block
const CTRL_CC = Object.freeze([69, 70, 71, 72, 76, 77, 78, 79]);
const FULL_WRITE_PREAMBLE = 16;

const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));

/** Generated patch for `slot`: blocks on/off by flavour, a few params, readable name. */
export function generatePatch(slot, { catalog } = {}) {
  const kind = slot % KINDS.length;
  const on = { 0: [2, 3, 5, 9], 1: [2, 3, 4, 5, 8], 2: [0, 2, 3, 4, 5, 8, 9], 3: [3, 5, 7, 8, 9] }[kind];
  return encodePatchImage({
    slot,
    name: `${KINDS[kind]} ${slotLabel(slot)}`,
    tempo: 100 + (slot % 8) * 5,
    volume: 50,
    style: slot % STYLES.length,
    chain: { order: BLOCKS.map((_, i) => i), sendPos: 4, returnPos: 4 },
    blocks: INIT_FXIDS.map((fxid, i) => ({
      fxid,
      enabled: on.includes(i),
      params: catalog ? defaultParams(catalog, fxid, i) : [50, 50, 50 + (slot % 5) * 5],
    })),
    ctrl: Array.from({ length: 8 }, (_, i) => ({ mask: i === 0 ? 1 << 2 : 0 })),
  });
}

export class MockGp200 {
  /**
   * @param opts {
   *   type: "gp200" | "gp200lt" | "gp200jr" | 2 | 3 | 4 = "gp200", state = 1 (0 = updater mode), firmware = "1.8.0",
   *   images?: (image | .prst)[] seeding slots 0.. (others generated), catalog? (params of generated patches),
   *   latencyMs = 1, minGapMs = 10, deafMs = 800, push1007 = true, verifyGlitch = 0 (probability of a corrupt byte
   *   at file offset 0x9F in stored reads after a write), loseWrites = 0 (next N full writes are lost),
   *   fragmentSysex = 0 (deliver frames in pieces of N bytes), flushAfter = 0 (emit CMD 0x03
   *   after N host frames), ackWaitMs = 200 (chunk gaps above this flag a host waiting for ACKs),
   *   failUploads = false, emitKnobNotify = false, bankPolarity = "manual" | "inverted",
   *   silentQueries = [] (record types, e.g. REC.IR_NAME, whose queries get no reply: a pedal that doesn't answer them),
   *   mod = null (true or { version, letter, features, guests: { [block]: [{ fxid, fromBlock, fromPos, sliceKb }] },
   *   scenes: { [slot]: record bytes }, settings: record bytes }: answer the GrooveGurus mod service, 0x200C, like the
   *   firmware of gp-200-re RFC-0030; the record number of slot n is n + 2) }
   */
  constructor({
    type = "gp200",
    state = 1,
    firmware = "1.8.0",
    images = [],
    catalog,
    latencyMs = 1,
    minGapMs = 10,
    deafMs = 800,
    push1007 = true,
    verifyGlitch = 0,
    loseWrites = 0,
    fragmentSysex = 0,
    flushAfter = 0,
    ackWaitMs = 200,
    failUploads = false,
    emitKnobNotify = false,
    bankPolarity = "manual",
    silentQueries = [],
    mod = null,
  } = {}) {
    const dev = typeof type === "number" ? DEVICE_TYPES[type] : deviceByKey(type);
    if (!dev) throw new Error(`MockGp200: unknown type ${type}; use gp200, gp200lt or gp200jr`);
    this.type = dev.type;
    this.device = dev.key;
    this.name = dev.name;
    this.slotCount = dev.slots;
    this.state = state;
    this.firmware = firmware;
    this.catalog = catalog;
    this.slots = Array.from({ length: dev.slots }, (_, i) => normalizeStored(images[i] ? imageOf(images[i]) : generatePatch(i, { catalog }), i));
    this.current = 0;
    this.editBuffer = this.slots[0].slice();
    this.dirty = false;
    this.globals = Object.fromEntries(Object.keys(GLOBALS).map((k) => [k, GLOBAL_DEFAULTS[k] ?? 0]));
    this.globalEq = [...GLOBAL_EQ_DEFAULTS];
    this.userIr = Array.from({ length: USER_IR.SLOTS }, (_, i) => ({ name: `User IR ${i + 1}`, sum: 0, data: null }));
    this.snapTone = Array.from({ length: SNAPTONE.SLOTS }, (_, i) => ({ name: `SnapTone ${i + 1}`, sum: 0, data: null }));
    this.styles = Array.from({ length: STYLE_COUNT }, (_, i) => STYLES[i % STYLES.length]);
    this.drum = { playing: false, rhythm: 0, volume: 50, bpm: 120 };
    this.exp1AB = 0;
    this.pendingMoves = [];
    Object.assign(this, { latencyMs, minGapMs, deafMs, push1007, verifyGlitch, loseWrites, fragmentSysex, flushAfter, ackWaitMs });
    Object.assign(this, { failUploads, emitKnobNotify, bankPolarity, silentQueries });
    this.mod = mod ? this.#modInit(mod === true ? {} : mod) : null;
    this.log = []; // decoded host messages { cmd, records, header }, newest last
    this.violations = []; // { kind: "gap" | "deaf" | "danger" | "ackWait" | "hostBug", ... }
  }
  #listener = null;
  #sysex = new SysexAssembler();
  #reasm = new Reassembler({ shortChunkEnds: CHUNK.HOST });
  #lastRx = 0;
  #lastChunkAt = 0;
  #deafUntil = 0;
  #framesSeen = 0;
  #writtenSlots = new Set();
  #bank = 0;
  #tempoHi = null;

  /** Transport for Gp200Session (host side). */
  transport() {
    return {
      name: `${this.name} MIDI (mock)`,
      send: (bytes) => this.receive(toBytes(bytes)),
      onMessage: (cb) => {
        this.#listener = cb;
      },
      close: () => {
        this.#listener = null;
      },
    };
  }

  /** Attach any sink for device->host bytes (used by the virtual-port bridge). */
  setOutput(cb) {
    this.#listener = cb;
  }

  #emit(bytes) {
    const b = toBytes(bytes);
    const n = this.fragmentSysex;
    const parts = n > 0 && b[0] === 0xf0 ? Array.from({ length: Math.ceil(b.length / n) }, (_, i) => b.slice(i * n, (i + 1) * n)) : [b];
    for (const p of parts) setTimeout(() => this.#listener?.(p), this.latencyMs);
  }
  #reply(...records) {
    for (const f of encodeFrames({ cmd: CMD.SET, payload: concat(records) }, CHUNK.DEVICE)) this.#emit(f);
  }

  // ------------------------------------------------------------------------------------------- host -> device

  /** Bytes from the host (whole messages or fragments). */
  receive(bytes) {
    for (const m of this.#sysex.push(bytes)) this.#receiveMessage(m);
  }

  #receiveMessage(m) {
    const now = Date.now();
    if (this.#lastRx && now - this.#lastRx < this.minGapMs) this.violations.push({ kind: "gap", gapMs: now - this.#lastRx });
    this.#lastRx = now;
    if (now < this.#deafUntil) {
      this.violations.push({ kind: "deaf", msLeft: this.#deafUntil - now });
      return; // the pedal ignores commands for ~0.8 s after a write burst (OSS HW)
    }
    if (m[0] === 0xf0 && m[1] === 0x7e && m[2] === 0x48) return this.#refuse("bootloader updater frame (F0 7E 48)", m);
    if (m[0] !== 0xf0) return this.state === 1 ? this.#short(m) : undefined;
    const frame = decodeFrame(m);
    if (!frame) return;
    if (frame.kind === "address") {
      if (frame.address === "softwareState") this.#softwareState();
      else this.#refuse("SOFTWARE_JUMP", m);
      return;
    }
    if (this.state !== 1 || frame.kind !== "data") return; // updater mode answers SOFTWARE_STATE only
    this.#countFrame(frame, now);
    const msg = this.#reasm.push(frame);
    if (msg) this.#handle(msg);
  }

  #countFrame(frame, now) {
    if (frame.off > 0 && now - this.#lastChunkAt > this.ackWaitMs) this.violations.push({ kind: "ackWait", gapMs: now - this.#lastChunkAt });
    this.#lastChunkAt = now;
    if (this.flushAfter > 0 && ++this.#framesSeen >= this.flushAfter) {
      this.flushAfter = 0;
      this.#emit(Uint8Array.from([...SYSEX_ID, CMD.FLUSH, 0, 0, 0, 0, 0xf7]));
    }
  }

  /**
   * SOFTWARE_STATE ("enter editor mode"): USB captures of the editor and a GP-200 on firmware 1.8.0 (phash/gp200editor)
   * show no reply in normal mode; the pedal is identified by its 0x2001 reply. Only update mode answers `{0, type}`.
   */
  #softwareState() {
    if (this.state !== 1) return this.#emit(encodeFrames({ cmd: CMD.SET, address: ADDRESS.SOFTWARE_STATE, data: [this.state, this.type] })[0]);
    if (this.push1007) this.#pushGlobals();
  }

  #pushGlobals() {
    this.#reply(rec.globals(encodeGlobals({ firmware: this.firmware, currentSlot: this.current, values: this.globals })));
  }

  #handle({ cmd, payload }) {
    const m = decodeMessage({ cmd, payload });
    this.log.push({ cmd, header: m.header, records: m.records });
    if (cmd === CMD.QUERY && walkTlv(payload).some((r) => this.silentQueries.includes(r.type))) return;
    if (m.header) return this.#patchScoped(cmd, m, payload);
    for (const r of walkTlv(payload)) {
      if (r.truncated) continue;
      this.#system(cmd, r);
    }
  }

  #patchScoped(cmd, m, payload) {
    const { a, b } = m.header;
    const kinds = m.records.map((r) => r.kind);
    if (a === 1) {
      if (cmd === CMD.QUERY && kinds.includes("read")) return this.#readStored(b);
      if (cmd === CMD.SET && m.patch) return this.#fullWrite(b, m, payload);
      if (cmd === CMD.SET && kinds.includes("delete") && b < this.slotCount) this.slots[b] = normalizeStored(generatePatch(b, { catalog: this.catalog }), b);
      return;
    }
    if (b !== this.current) {
      this.violations.push({ kind: "hostBug", what: `edit-buffer header names slot ${b}, current is ${this.current}` });
      return;
    }
    if (cmd === CMD.QUERY && kinds.includes("read")) return this.#reply(rec.header(0, this.current), this.editBuffer.slice());
    if (cmd === CMD.SET) this.#applyEdits(m.records);
  }

  #readStored(slot) {
    if (slot >= this.slotCount) return;
    const image = this.slots[slot].slice();
    if (this.#writtenSlots.has(slot) && Math.random() < this.verifyGlitch) image[0x9f - 0x30] ^= 0x5a; // file 0x9F (DP HW)
    this.#reply(rec.header(1, slot), image);
  }

  #fullWrite(slot, m, payload) {
    this.#deafUntil = Date.now() + this.deafMs;
    const pre = walkTlv(payload.subarray(0, FULL_WRITE_PREAMBLE));
    if (slot >= this.slotCount || pre[1]?.type !== REC.READ || readU16(pre[1].data, 0) !== slot) {
      this.violations.push({ kind: "hostBug", what: `full write with an invalid preamble for slot ${slot}` });
      return;
    }
    if (this.loseWrites > 0) {
      this.loseWrites--;
      return;
    }
    try {
      parsePatch(m.patch.image);
    } catch (e) {
      this.violations.push({ kind: "hostBug", what: `full write of a broken image: ${e.message}` });
      return;
    }
    // writing the active slot leaves the edit buffer stale (OSS HW): only the stored copy changes
    this.slots[slot] = normalizeStored(m.patch.image, slot);
    this.#writtenSlots.add(slot);
  }

  // ------------------------------------------------------------------------------------------- edit buffer

  #setBuffer(edits) {
    this.editBuffer = applyPatchEdits(this.editBuffer, edits);
    if (this.dirty) return;
    this.dirty = true;
    this.#reply(rec.status(STATUS.DIRTY, 1));
  }

  #blockOf(index) {
    return parsePatch(this.editBuffer).blocks[index];
  }

  #applyEdits(records) {
    for (const r of records) {
      const e = this.#editOf(r);
      if (e) this.#setBuffer(e);
    }
  }

  #editOf(r) {
    switch (r.kind) {
      case "param": {
        const blk = this.#blockOf(r.block);
        if (!blk || blk.fxid !== r.fxid) {
          this.violations.push({ kind: "hostBug", what: `param for fxid 0x${r.fxid.toString(16)} but block ${r.block} holds 0x${blk?.fxid.toString(16)}` });
          return null;
        }
        return { blocks: { [r.block]: { params: { [r.paramId]: r.value } } } };
      }
      case "blockEnabled":
        return { blocks: { [r.block]: { enabled: r.enabled } } };
      case "model": // the old model's params are not kept: the host sends the new ones after this record
        return { blocks: { [r.block]: { fxid: r.fxid, params: this.catalog ? defaultParams(this.catalog, r.fxid, r.block) : new Array(PARAM_COUNT).fill(0) } } };
      case "chain":
        return { chain: { order: r.order, sendPos: r.sendPos, returnPos: r.returnPos } };
      case "patchSetting":
        return this.#settingEdit(r.target, r.value);
      case "patchName":
        return { name: r.name };
      case "author":
        return { author: r.text };
      case "note":
        return { note: r.text };
      case "exp":
        return { exp: { [expIndex(r.key)]: { block: r.block, param: r.param, max: r.max, min: r.min } } };
      case "expRange":
        return { exp: { [expIndex(r.key)]: { [r.which]: r.value } } };
      case "ctrl":
        return { ctrl: { [r.index]: { state: r.state, mask: r.mask } } };
      case "quickAccess":
        return { quickAccess: { [r.index]: { block: r.block, param: r.param } } };
      default:
        return null; // focus and unknown records do not change the patch
    }
  }

  #settingEdit(target, value) {
    const key = { [PATCH_SETTING.VOL]: "volume", [PATCH_SETTING.TEMPO]: "tempo", [PATCH_SETTING.STYLE]: "style", [PATCH_SETTING.SEND]: "sendLevel", [PATCH_SETTING.RETURN]: "returnLevel", [PATCH_SETTING.LOOP_MODE]: "loopMode", [PATCH_SETTING.PAN]: "pan" }[target];
    return key ? { [key]: value } : null;
  }

  // ------------------------------------------------------------------------------------------- system records

  #system(cmd, r) {
    const d = r.data;
    const u16 = (o) => readU16(d, o);
    switch (r.type) {
      case REC.FIRMWARE_JUMP:
        return this.#refuse("0x2000 firmware-jump prelude", d);
      case REC.GLOBALS:
        return cmd === CMD.SET ? this.#refuse("0x1007 write (all globals)", d) : undefined;
      case REC.IDENTITY:
        return this.#reply(rec.identityReply(1, this.type));
      case SERVICE_TYPE:
        return this.#modService(d);
      case REC.STATE_DUMP:
        return this.#pushGlobals();
      case REC.DRUM_STATE:
        return this.#reply(rec.drumState({ playing: this.drum.playing, exp1AB: this.exp1AB }));
      case REC.IR_NAME:
        return u16(0) < USER_IR.SLOTS ? this.#nameReply(REC.IR_NAME, u16(0), this.userIr[u16(0)]) : undefined;
      case REC.SNAPTONE_NAME:
        return u16(0) < SNAPTONE.SLOTS ? this.#nameReply(REC.SNAPTONE_NAME, u16(0), this.snapTone[u16(0)]) : undefined;
      case REC.STYLE_NAME:
        if (u16(0) >= STYLE_COUNT) return;
        if (cmd === CMD.QUERY) return this.#reply(rec.styleName(u16(0), this.styles[u16(0)]));
        this.styles = this.styles.map((s, i) => (i === u16(0) ? readName(d, 4) : s));
        return;
      case REC.SYSTEM:
        return this.#systemValue(u16(0), (u16(2) << 16) >> 16);
      case REC.GLOBAL_EQ:
        if (u16(0) < GLOBAL_EQ_BANDS) this.globalEq = this.globalEq.map((v, i) => (i === u16(0) ? new DataView(d.buffer, d.byteOffset + 4, 4).getFloat32(0, true) : v));
        return this.#reply(rec.globalEq(u16(0), this.globalEq[u16(0)] ?? 0));
      case REC.STATUS:
        if (u16(0) === STATUS.DRUM) this.drum = { ...this.drum, playing: u16(2) !== 0 };
        return;
      case REC.DRUM:
        this.drum = { ...this.drum, [["rhythm", "volume", "bpm"][u16(0)] ?? "unknown"]: u16(2) };
        return;
      case REC.SAVE:
        return this.#save(u16(0), readName(d, 4), d);
      case REC.IR_UPLOAD:
        return this.#irUpload(d);
      case REC.SNAPTONE_UPLOAD:
        return this.#snapToneUpload(d);
      case REC.IR_RENAME:
        if (u16(0) < USER_IR.SLOTS) this.userIr = this.userIr.map((x, i) => (i === u16(0) ? { ...x, name: readName(d, 4) } : x));
        return;
      case REC.SNAPTONE_RENAME:
        if (u16(0) < SNAPTONE.SLOTS) this.snapTone = this.snapTone.map((x, i) => (i === u16(0) ? { ...x, name: readName(d, 4) } : x));
        return;
      case REC.MOVE:
        this.pendingMoves = [...this.pendingMoves, [u16(0), u16(2)]];
        return;
      case REC.MOVE_COMMIT:
        return this.#commitMoves();
      default:
        return; // unknown: stay silent like the pedal
    }
  }

  #nameReply(type, slot, entry) {
    this.#reply(rec.nameEntry(type, slot, entry.data ? 1 : 0, entry.sum, entry.name));
  }

  /** Dangerous frames are recorded and never change state. */
  #refuse(what, bytes) {
    this.violations.push({ kind: "danger", what, bytes: Uint8Array.from(bytes) });
  }

  #systemValue(id, value) {
    if (id === SELECT_ID) return this.#select(value & 0xffff, true);
    if (DESTRUCTIVE_GLOBAL_IDS.includes(id)) return this.#refuse(`destructive 0x1008 id 0x${id.toString(16)}`, rec.system(id, value));
    const name = globalNameById(id);
    if (name === "exp1AB") this.exp1AB = value;
    else if (name) this.globals = { ...this.globals, [name]: value };
    this.#reply(rec.system(id, value)); // the device echoes every global write
  }

  #select(slot, notify) {
    if (slot >= this.slotCount) return;
    this.current = slot;
    this.editBuffer = this.slots[slot].slice();
    this.dirty = false;
    if (notify) this.#reply(rec.system(SELECT_ID, slot));
  }

  #save(slot, name, d) {
    if (slot >= this.slotCount) return;
    const named = name ? applyPatchEdits(this.editBuffer, { name }) : this.editBuffer;
    this.slots[slot] = normalizeStored(named, slot);
    if (slot === this.current) {
      this.editBuffer = this.slots[slot].slice();
      this.dirty = false;
    }
    this.#reply(tlv(REC.SAVE, d)); // echoed as confirmation
  }

  #irUpload(d) {
    const slot = readU16(d, 0);
    const sum = readU32(d, 4);
    const pcm = d.slice(24);
    const ok = slot < USER_IR.SLOTS && pcm.length === USER_IR.DATA_BYTES && byteSum(pcm) === sum && !this.failUploads;
    if (ok) this.userIr = this.userIr.map((x, i) => (i === slot ? { name: readName(d, 8), sum, data: pcm } : x));
    this.#reply(rec.uploadResult(REC.IR_RESULT, slot, ok ? 1 : 0));
  }

  #snapToneUpload(d) {
    const slot = readU16(d, 0);
    const sum = readU32(d, 4);
    const field = d.slice(24);
    const blob = field.slice(0, SNAPTONE.BLOB_SIZE);
    const ok = slot < SNAPTONE.SLOTS && field.length === SNAPTONE_FIELD && byteSum(field) === sum && checkGp200SnapTone(blob) === null && !this.failUploads;
    if (ok) this.snapTone = this.snapTone.map((x, i) => (i === slot ? { name: readName(d, 8), sum, data: blob } : x));
    this.#reply(rec.uploadResult(REC.SNAPTONE_RESULT, slot, ok ? 1 : 0));
  }

  /** 0x2007 {from, to} moves applied on 0x2008 commit (reorder semantics inferred: take `from`, insert at `to`). */
  #commitMoves() {
    let slots = [...this.slots];
    for (const [from, to] of this.pendingMoves) {
      if (from >= slots.length || to >= slots.length) continue;
      const [moved] = slots.splice(from, 1);
      slots.splice(to, 0, moved);
    }
    this.slots = slots.map((img, i) => normalizeStored(img, i));
    this.pendingMoves = [];
  }

  // ------------------------------------------------------------------------------------------- CC / PC

  #short([status, d1, d2]) {
    const kind = status & 0xf0;
    if (kind === 0xc0) return this.#select(this.#bankBase() + d1, true);
    if (kind !== 0xb0) return;
    if (d1 === 0) this.#bank = d2 ? 1 : 0;
    else if (d1 === 7) this.#setBuffer({ volume: Math.round((d2 * 100) / 127) });
    else if (d1 in BLOCK_CC) this.toggleBlock(BLOCK_CC[d1], d2 >= 64);
    else if (CTRL_CC.includes(d1)) this.#toggleCtrl(CTRL_CC.indexOf(d1));
    else if (d1 === 73) this.#tempoHi = d2;
    else if (d1 === 74 && this.#tempoHi !== null) this.tapTempo(this.#tempoHi * 128 + d2);
  }

  /** Manual: CC0 = 1 selects 01-A..32-D; "inverted" is the open alternative (CC0 = 0 for 01-A). */
  #bankBase() {
    const first = this.bankPolarity === "manual" ? this.#bank === 1 : this.#bank === 0;
    return first ? 0 : 128;
  }

  #toggleCtrl(index) {
    const ctrl = parsePatch(this.editBuffer).ctrl[index];
    if (!ctrl) return;
    for (let k = 0; k < BLOCKS.length; k++) if (ctrl.mask & (1 << k)) this.toggleBlock(k);
  }

  // ------------------------------------------------------------------------------------------- hardware helpers

  /** Footswitch / PC on the pedal: switch patch and notify like the real unit (0x1008 {0, slot}). */
  pressPreset(slot) {
    this.#select(slot, true);
  }

  /** Knob on the pedal: changes the edit buffer; the 0x0005 notification is behind `emitKnobNotify` (unproven on HW). */
  turnKnob(block, paramId, value) {
    const blk = parsePatch(this.editBuffer).blocks[block];
    this.#setBuffer({ blocks: { [block]: { params: { [paramId]: value } } } });
    if (this.emitKnobNotify) this.#reply(rec.header(0, this.current), rec.param({ block, paramId, fxid: blk.fxid, value }));
  }

  /** Block on/off on the pedal (toggle when `on` is omitted) -> 0x0015 notify. */
  toggleBlock(block, on) {
    const enabled = on ?? !parsePatch(this.editBuffer).blocks[block].enabled;
    this.#setBuffer({ blocks: { [block]: { enabled } } });
    this.#reply(rec.header(0, this.current), rec.blockOn(block, enabled));
  }

  /** Tap tempo on the pedal -> 0x0006 {1, bpm}. */
  tapTempo(bpm) {
    this.#setBuffer({ tempo: bpm });
    this.#reply(rec.header(0, this.current), rec.patchSetting(PATCH_SETTING.TEMPO, bpm));
  }

  // ------------------------------------------------------------------------------------------- GrooveGurus mod service

  #modInit(opts) {
    const m = { ...MOD_DEFAULTS, ...opts, records: new Array(MOD_INDICES).fill(null), settings: opts.settings ?? null };
    m.sceneMode = false;
    m.activeScene = NO_SCENE;
    m.hello = false;
    m.writes = 0;
    m.transfer = null;
    m.notifySeq = 0;
    for (const [slot, bytes] of Object.entries(opts.scenes ?? {})) m.records[Number(slot)] = Uint8Array.from(bytes);
    delete m.scenes;
    return m;
  }

  /** Record number of a slot (the firmware's preset -> record table; n + 2 on a fresh pedal). */
  modOwner(slot) {
    return slot + 2;
  }

  #modIndexOf(owner) {
    return this.mod.records.findIndex((r) => r && (r[6] | (r[7] << 8)) === owner);
  }

  /** Scene record of `slot` in the simulated store, or null. */
  modScenes(slot) {
    const i = this.#modIndexOf(this.modOwner(slot));
    return i < 0 ? null : this.mod.records[i].slice();
  }

  #modReply(op, seq, status, arg, payload = []) {
    this.#reply(encodeReply({ op, seq, status, arg, payload }));
  }

  #modService(d) {
    const r = decodeServiceData(d);
    if (!this.mod || !r || r.kind !== "modService") return; // stock firmware: 0x200C is an empty table entry
    const { op, seq, arg, payload } = r;
    if (r.version !== 1) return this.#modReply(op, seq, MOD_STATUS.VERSION, arg);
    const m = this.mod;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const used = () => m.records.filter(Boolean).length;
    switch (op) {
      case MOD_OP.HELLO: {
        m.hello = true;
        const [maj, min, pat] = m.version.split(".").map(Number);
        const name = Array.from({ length: 8 }, (_, i) => m.name.charCodeAt(i) || 0);
        const fw = Array.from({ length: 4 }, (_, i) => m.firmwareTag.charCodeAt(i) || 0);
        const f = m.features >>> 0;
        return this.#modReply(op, seq, MOD_STATUS.OK, 0, [...name, m.letter.charCodeAt(0), maj, min, pat, ...fw, f & 0xff, (f >>> 8) & 0xff, (f >>> 16) & 0xff, f >>> 24,
          used(), MOD_INDICES - used(), MOD_INDICES, 0, ...u16(SCENE_RECORD_MAX), ...u16(3)]);
      }
      case MOD_OP.SCENE_LIST: {
        const out = [];
        m.records.forEach((rec, i) => {
          if (!rec) return;
          const owner = rec[6] | (rec[7] << 8);
          const slot = owner - 2 < this.slotCount ? owner - 2 : 0xffff;
          out.push(...u16(owner), ...u16(slot), i, rec[4], rec[10], 0, ...u16(16 + (rec[8] | (rec[9] << 8))), 0, 0);
        });
        return this.#modReply(op, seq, MOD_STATUS.OK, arg, [out.length / 12, MOD_INDICES - used(), MOD_INDICES, 0, ...out]);
      }
      case MOD_OP.SCENE_READ: {
        const target = arg & 0xffff;
        const offset = arg >>> 16;
        let owner;
        let i;
        if (target >= TARGET_INDEX) {
          i = target - TARGET_INDEX;
          if (i >= MOD_INDICES) return this.#modReply(op, seq, MOD_STATUS.ARG, arg);
          owner = m.records[i] ? m.records[i][6] | (m.records[i][7] << 8) : 0;
        } else {
          if (target >= this.slotCount) return this.#modReply(op, seq, MOD_STATUS.ARG, arg);
          owner = this.modOwner(target);
          i = this.#modIndexOf(owner);
        }
        const rec = i >= 0 ? m.records[i] : null;
        const size = rec ? rec.length : 0;
        if (offset > size) return this.#modReply(op, seq, MOD_STATUS.ARG, arg);
        return this.#modReply(op, seq, MOD_STATUS.OK, arg, [...u16(size), ...u16(owner), ...(rec ? rec.subarray(offset, offset + RECORD_CHUNK) : [])]);
      }
      case MOD_OP.SCENE_WRITE:
        return this.#modWrite(seq, arg, payload);
      case MOD_OP.SCENE_DELETE: {
        if (arg >= this.slotCount) return this.#modReply(op, seq, MOD_STATUS.ARG, arg);
        this.#modDelete(arg);
        return this.#modReply(op, seq, MOD_STATUS.OK, arg);
      }
      case MOD_OP.SETTINGS_READ: {
        const s = m.settings;
        return this.#modReply(op, seq, MOD_STATUS.OK, arg, [...u16(s ? s.length : 0), ...u16(s ? 299 : 0), ...(s ?? [])]);
      }
      case MOD_OP.SETTINGS_WRITE: {
        const rec = payload.subarray(4);
        try {
          decodeSettingsRecord(rec);
        } catch {
          return this.#modReply(op, seq, MOD_STATUS.CHECKSUM, arg);
        }
        m.settings = Uint8Array.from(rec);
        this.#modNotify(NOTIFY.SETTINGS);
        return this.#modReply(op, seq, MOD_STATUS.OK, arg);
      }
      case MOD_OP.GUESTS: {
        if (arg > 10) return this.#modReply(op, seq, MOD_STATUS.ARG, arg);
        const list = m.guests[arg] ?? [];
        const out = list.flatMap((g) => [g.fxid & 0xff, (g.fxid >>> 8) & 0xff, (g.fxid >>> 16) & 0xff, g.fxid >>> 24, g.fromBlock, g.fromPos, ...u16(g.sliceKb ?? 0)]);
        return this.#modReply(op, seq, MOD_STATUS.OK, arg, [list.length, 0, 0, 0, ...out]);
      }
      default:
        return this.#modReply(op, seq, MOD_STATUS.OP, arg);
    }
  }

  #modDelete(slot) {
    const i = this.#modIndexOf(this.modOwner(slot));
    if (i < 0) return;
    this.mod.records[i] = null;
    this.#modWritten(slot);
  }

  #modWritten(slot) {
    this.mod.writes++;
    if (slot === this.current) {
      // the firmware reloads the active preset on its next tick: the base plays, the new scenes apply on the next change
      this.mod.activeScene = NO_SCENE;
      this.#modPlay();
    }
    this.#modNotify(NOTIFY.RECORD | (slot === this.current ? NOTIFY.SCENE : 0));
  }

  /** What the mod's tick puts in the edit buffer: the stored preset, plus the active scene in scene mode (`compoe`). */
  #modPlay() {
    const m = this.mod;
    const stored = this.modScenes(this.current);
    let scene = null;
    if (m.sceneMode && m.activeScene !== NO_SCENE && stored) {
      try {
        scene = decodeSceneRecord(stored).scenes[m.activeScene];
      } catch {
        scene = null;
      }
    }
    let image = this.slots[this.current].slice();
    if (scene) {
      const blocks = {};
      const block = (i) => (blocks[i] ??= {});
      const was = parsePatch(image).blocks;
      if (scene.mask !== null) was.forEach((b, i) => { if (!!(scene.mask & (1 << i)) !== b.enabled) block(i).enabled = !!(scene.mask & (1 << i)); });
      for (const p of scene.params) if (!scene.reserve[p.block]) (block(p.block).params ??= {})[p.slot] = bitsToFloat(p.bits);
      for (const [b, r] of Object.entries(scene.reserve)) Object.assign(block(Number(b)), { fxid: r.fxid, params: r.params.map(bitsToFloat) });
      image = applyPatchEdits(image, { blocks, ...(scene.volume !== null ? { volume: scene.volume } : {}), ...(scene.bpm !== null ? { tempo: scene.bpm } : {}) });
    }
    this.editBuffer = image;
    const dirty = !!scene;
    if (dirty !== this.dirty) this.#reply(rec.status(STATUS.DIRTY, dirty ? 1 : 0));
    this.dirty = dirty;
  }

  #modWrite(seq, arg, payload) {
    const m = this.mod;
    const op = MOD_OP.SCENE_WRITE;
    const slot = arg & 0xffff;
    const offset = arg >>> 16;
    const ack = (status, n) => this.#modReply(op, seq, status, arg, [n & 0xff, n >>> 8, 0, 0]);
    if (payload.length < 4) return ack(MOD_STATUS.LENGTH, 0);
    const total = payload[0] | (payload[1] << 8);
    const piece = payload.subarray(4);
    if (slot >= this.slotCount) return ack(MOD_STATUS.ARG, 0);
    if (total < 16 || total > SCENE_RECORD_MAX || offset + piece.length > total) return (m.transfer = null), ack(MOD_STATUS.LENGTH, 0);
    if (offset === 0) m.transfer = { slot, total, buf: new Uint8Array(total), got: 0 };
    else if (!m.transfer || m.transfer.slot !== slot || m.transfer.total !== total || m.transfer.got !== offset) return ack(MOD_STATUS.ARG, m.transfer?.got ?? 0);
    m.transfer.buf.set(piece, offset);
    m.transfer.got = offset + piece.length;
    if (m.transfer.got < total) return ack(MOD_STATUS.OK, m.transfer.got);
    const bytes = m.transfer.buf;
    m.transfer = null;
    let rec;
    try {
      rec = decodeSceneRecord(bytes);
    } catch {
      return ack(MOD_STATUS.CHECKSUM, total);
    }
    if (rec.owner !== this.modOwner(slot)) return ack(MOD_STATUS.OWNER, total);
    if (rec.scenes.every((x) => !x) && !rec.pre2) {
      this.#modDelete(slot);
      return ack(MOD_STATUS.OK, total);
    }
    let i = this.#modIndexOf(rec.owner);
    if (i < 0) i = m.records.indexOf(null);
    if (i < 0) return ack(MOD_STATUS.NO_SPACE, total);
    m.records[i] = Uint8Array.from(bytes);
    this.#modWritten(slot);
    return ack(MOD_STATUS.OK, total);
  }

  #modNotify(events) {
    const m = this.mod;
    if (!m?.hello || !(m.features & FEATURE.NOTIFY)) return;
    const rec = this.modScenes(this.current);
    const owner = this.modOwner(this.current);
    m.notifySeq = (m.notifySeq + 1) & 0xffff;
    this.#reply(encodeReply({ op: MOD_OP.NOTIFY, seq: m.notifySeq, arg: events,
      payload: [events, m.sceneMode ? 1 : 0, m.sceneMode ? m.activeScene : NO_SCENE, rec ? rec[10] : 0, this.current & 0xff, this.current >> 8, owner & 0xff, owner >> 8] }));
  }

  /** Scene mode on the pedal (double tap on CTRL 1) -> NOTIFY. */
  setSceneMode(on) {
    this.mod.sceneMode = on;
    this.mod.activeScene = NO_SCENE;
    this.#modPlay();
    this.#modNotify(NOTIFY.SCENE);
  }

  /** A-D on the pedal in scene mode -> NOTIFY. */
  selectScene(k) {
    this.mod.activeScene = k;
    this.#modPlay();
    this.#modNotify(NOTIFY.SCENE);
  }
}

const readName = (d, o) => readAscii(d, o, 16);
