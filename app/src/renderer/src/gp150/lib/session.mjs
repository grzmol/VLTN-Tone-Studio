// GP-150 session over any MIDI transport ({ name, send(bytes), onMessage(cb), close() }). Pure, isomorphic ESM.
// Flow (GP-180 USB captures of majabojarska/Valeton-GP180-Rev-Eng): hello, then one request at a time; the pedal ACKs
// every message we send (ACK seq = our message number) and we ACK every message it completes. A query is answered with
// the same command, an upload with P=09. Lost packets are asked for again with a resend request, as Suite does.
// Safety: requests are serialized; the factory reset command is refused by the codec; memory writes need
// { confirm: true } and are verified by reading back.

import {
  CMD,
  CONTROL,
  EDIT_BUFFER,
  GLOBAL_RECORDS,
  P,
  SLOTS,
  ack,
  decodeBlockOn,
  decodeChain,
  decodeFrame,
  decodeGlobals,
  decodeMessage,
  decodeModel,
  decodeNames,
  decodeParam,
  decodeSaved,
  eqRecord,
  eqValues,
  globalsOf,
  hello,
  importPatch,
  nextSeq,
  packetize,
  query,
  readPatch,
  readU32,
  Reassembler,
  rename as renameMessage,
  resendRequest,
  setBlockOn,
  setGlobalRecord,
  setKnobs,
  setModel,
  setParam,
  setPatchSettings,
  toBytes,
  upload,
  writeGlobal,
  CHUNK,
} from "./protocol.mjs";
import { applyPatchEdits, forImport, imagesMatch, isGp150Prst, normalize, parsePrst, PRST_SIZE, settingsRecord } from "./prst.mjs";

export const DEFAULT_TIMING = Object.freeze({
  /** Pause between the packets of one message */
  frameGapMs: 2,
  /** Wait for the pedal's hello reply */
  helloTimeoutMs: 1500,
  /** Wait for the ACK of a message */
  ackTimeoutMs: 1000,
  /** Wait for a reply after the ACK */
  replyTimeoutMs: 3000,
  /** Wait for the P=09 result of an upload or preset write */
  uploadTimeoutMs: 10000,
  /** Times a message is sent again when no ACK comes */
  resends: 2,
});

export class Gp150Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Gp150Error";
    this.code = code;
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const needConfirm = (opts, what) => {
  if (opts?.confirm !== true) throw new Gp150Error("unsafe", `${what} changes the pedal's memory and needs { confirm: true }`);
};
const checkSlot = (slot, count, what) => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= count) throw new RangeError(`${what} ${slot} is outside 0..${count - 1}`);
};

/** The device's name entries by kind: IR slots 0-19; SnapTone entry 0 is "None", slots 1-100. */
const toEntries = (list) => list.map((e) => ({ slot: e.slot, name: e.name, empty: e.empty }));

export class Gp150Session extends EventTarget {
  #transport;
  #timing;
  #log;
  #seq = 0;
  #rx = new Reassembler();
  /** our messages by seq, kept for the pedal's resend requests */
  #sent = new Map();
  #acks = new Map();
  #waiters = [];
  #helloWaiter = null;
  #queue = Promise.resolve();
  #closed = false;
  #firmware = null;
  #currentSlot = null;
  #modified = false;
  #records = new Map();

  constructor(transport, opts = {}) {
    super();
    this.#transport = transport;
    this.#timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.#log = opts.log ?? (() => {});
    transport.onMessage((bytes) => this.#receive(toBytes(bytes)));
  }

  get transportName() {
    return this.#transport.name;
  }
  get firmware() {
    return this.#firmware;
  }
  get currentSlot() {
    return this.#currentSlot;
  }
  /** The pedal's "edited" flag of the active preset (0x3070). */
  get modified() {
    return this.#modified;
  }
  get slotCount() {
    return SLOTS.PRESETS;
  }

  /** Run `fn` with the session to itself (requests never interleave). */
  exclusive(fn) {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  async close() {
    this.#closed = true;
    for (const w of this.#waiters.splice(0)) w.reject(new Gp150Error("closed", "The connection was closed"));
    for (const a of this.#acks.values()) a.reject(new Gp150Error("closed", "The connection was closed"));
    this.#acks.clear();
    await this.#transport.close();
  }

  // ----------------------------------------------------------------------------------------- receive

  #emit(message) {
    const ev = new Event("message");
    ev.message = message;
    this.dispatchEvent(ev);
  }

  #raw(bytes) {
    this.#log("tx", bytes);
    this.#transport.send(bytes);
  }

  #receive(bytes) {
    if (bytes[0] !== 0xf0) {
      const ev = new Event("midi");
      ev.data = bytes;
      this.dispatchEvent(ev);
      return;
    }
    const f = decodeFrame(bytes);
    if (!f) {
      this.#log("rx", bytes);
      const ev = new Event("badframe");
      ev.data = bytes;
      this.dispatchEvent(ev);
      return;
    }
    if (f.kind === "control") {
      this.#log("rx", bytes, { control: f.type, seq: f.seq });
      if (f.type === CONTROL.ACK) this.#acks.get(f.seq)?.resolve();
      else if (f.type === CONTROL.HELLO_REPLY) this.#helloWaiter?.();
      else if (f.type === CONTROL.RESEND) this.#resend(f);
      return;
    }
    const before = this.#rx.pending(f.seq);
    if (before && f.offset > before.offset) {
      // A packet went missing: ask for it again (the pedal sends the rest after it).
      this.#raw(resendRequest(f.seq, f.index - 1, before.offset, Math.min(CHUNK, before.total - before.offset)));
    }
    const done = this.#rx.push(f);
    if (!done) {
      this.#log("rx", bytes);
      return;
    }
    const msg = decodeMessage(done.bytes);
    this.#log("rx", bytes, msg ?? undefined);
    this.#raw(ack(done.seq));
    if (!msg || !msg.crcOk) return;
    const i = this.#waiters.findIndex((w) => w.match(msg));
    if (i >= 0) {
      const [w] = this.#waiters.splice(i, 1);
      clearTimeout(w.timer);
      this.#track(msg);
      w.resolve(msg);
      return;
    }
    this.#track(msg);
    const event = this.#toEvent(msg);
    if (event) this.#emit(event);
  }

  /** Keep the state the session reports (edited flag, settings records). The active slot: reads and pushed patches. */
  #track(msg) {
    const d = msg.payload.subarray(4);
    if (msg.cmd === CMD.PATCH_STATE && msg.p === P.QUERY && d.length >= 4) this.#modified = readU32(d, 0) === 1;
    else if (msg.cmd === CMD.GLOBALS && msg.p === P.QUERY) {
      const g = decodeGlobals(msg.payload);
      this.#firmware = g.firmware || this.#firmware;
      for (const [cmd, r] of g.records) this.#records.set(cmd, r);
    } else if ((GLOBAL_RECORDS.includes(msg.cmd) || msg.cmd === CMD.GLOBAL_EQ) && msg.p === P.QUERY) this.#records.set(msg.cmd, Uint8Array.from(d));
  }

  #toEvent(msg) {
    if (msg.p === P.EVENT && msg.cmd === CMD.SAVED) return { kind: "saved", ...decodeSaved(msg.payload) };
    if (msg.p !== P.QUERY) return null;
    const d = msg.payload.subarray(4);
    switch (msg.cmd) {
      case CMD.PARAM:
        return { kind: "param", ...decodeParam(msg.payload) };
      case CMD.BLOCK_ON:
        return { kind: "block", ...decodeBlockOn(msg.payload) };
      case CMD.MODEL:
        return { kind: "model", ...decodeModel(msg.payload) };
      case CMD.CHAIN:
        return { kind: "chain", chain: decodeChain(msg.payload) };
      case CMD.PATCH_STATE:
        return { kind: "modified", modified: this.#modified };
      case CMD.PATCH_SETTINGS:
        return { kind: "patchSettings", tempo: d[0] | (d[1] << 8), volume: d[2] | (d[3] << 8), namMode: d[6] | (d[7] << 8) };
      case CMD.PATCH: {
        // The pedal pushes the edit buffer when another preset becomes active.
        if (!isGp150Prst(msg.payload)) return null;
        const prst = normalize(msg.payload);
        const slot = readU32(prst, 4);
        if (slot < SLOTS.PRESETS) this.#currentSlot = slot;
        return { kind: "patch", prst };
      }
      case CMD.KNOBS:
      case CMD.EXP:
      case CMD.CTRL:
        return { kind: "patchRecord", cmd: msg.cmd };
      case CMD.PRESET_NAMES:
        return { kind: "names", names: decodeNames(msg.cmd, msg.payload) };
      case CMD.SNAPTONE_NAMES:
      case CMD.IR_NAMES:
        return { kind: "listChanged", cmd: msg.cmd };
      case CMD.GLOBAL_EQ:
        return { kind: "globalEq", values: eqValues(d) };
      case CMD.IO:
      case CMD.USB:
      case CMD.MIDI:
      case CMD.SYSTEM:
        return { kind: "globals", cmd: msg.cmd, values: globalsOf(new Map([[msg.cmd, d]])) };
      default:
        return null;
    }
  }

  /** The pedal lost part of one of our messages: send that part again. */
  #resend(f) {
    const msg = this.#sent.get(f.seq);
    if (!msg || f.extra.length < 6) return;
    const offset = f.extra[2] | (f.extra[3] << 7);
    const p = packetize(msg, f.seq, true).find((_, i) => i * CHUNK === offset);
    if (p) this.#raw(p);
  }

  // ----------------------------------------------------------------------------------------- send

  /** Send one logical message and wait for its ACK (sent again up to `resends` times). */
  async #send(msg) {
    if (this.#closed) throw new Gp150Error("closed", "The connection was closed");
    const seq = this.#seq;
    this.#seq = nextSeq(seq);
    this.#sent.set(seq, msg);
    if (this.#sent.size > 8) this.#sent.delete(this.#sent.keys().next().value);
    const packets = packetize(msg, seq, true);
    for (let attempt = 0; ; attempt++) {
      const acked = new Promise((resolve, reject) => this.#acks.set(seq, { resolve, reject }));
      // A transport can reject a send, or close during a frame gap before we await its ACK.
      void acked.catch(() => {});
      let timer;
      let ok;
      try {
        for (let i = 0; i < packets.length; i++) {
          if (i && this.#timing.frameGapMs) await delay(this.#timing.frameGapMs);
          this.#transport.send(packets[i]);
          this.#log("tx", packets[i], i === packets.length - 1 ? decodeMessage(msg) : undefined);
        }
        const timeout = new Promise((r) => (timer = setTimeout(() => r(false), this.#timing.ackTimeoutMs)));
        ok = await Promise.race([acked.then(() => true), timeout]);
      } finally {
        clearTimeout(timer);
        this.#acks.delete(seq);
      }
      if (ok) return seq;
      if (attempt >= this.#timing.resends) throw new Gp150Error("timeout", "The pedal didn't acknowledge a message");
    }
  }

  /** Register a reply waiter before sending, so a fast reply can't slip past. */
  #expect(match, timeoutMs, what) {
    let waiter;
    const promise = new Promise((resolve, reject) => {
      waiter = { match, resolve, reject, timer: null };
      this.#waiters.push(waiter);
    });
    waiter.arm = () => {
      // Already answered (the reply came with the ACK) or cancelled: no timer.
      if (!this.#waiters.includes(waiter)) return;
      waiter.timer = setTimeout(() => {
        const i = this.#waiters.indexOf(waiter);
        if (i >= 0) this.#waiters.splice(i, 1);
        waiter.reject(new Gp150Error("timeout", `The pedal didn't answer (${what})`));
      }, timeoutMs);
    };
    waiter.cancel = () => {
      const i = this.#waiters.indexOf(waiter);
      if (i >= 0) this.#waiters.splice(i, 1);
      clearTimeout(waiter.timer);
    };
    return { waiter, promise };
  }

  async #request(msg, match, what, timeoutMs = this.#timing.replyTimeoutMs) {
    const { waiter, promise } = this.#expect(match, timeoutMs, what);
    try {
      await this.#send(msg);
    } catch (e) {
      waiter.cancel();
      throw e;
    }
    waiter.arm();
    return promise;
  }

  /** Query `cmd` and return its reply. */
  #query(cmd, args = [], what = `0x${cmd.toString(16)}`) {
    return this.#request(query(cmd, args), (m) => m.p === P.QUERY && m.cmd === cmd, what);
  }

  /** Send a set (no reply beyond the ACK). */
  set(msg) {
    return this.exclusive(() => this.#send(msg));
  }

  // ----------------------------------------------------------------------------------------- reads

  /** Hello, the pedal's state, its settings (firmware). */
  connect() {
    return this.exclusive(async () => {
      let ok = false;
      for (let attempt = 0; attempt <= this.#timing.resends && !ok; attempt++) {
        ok = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), this.#timing.helloTimeoutMs);
          this.#helloWaiter = () => {
            clearTimeout(timer);
            resolve(true);
          };
          this.#raw(hello());
        });
      }
      this.#helloWaiter = null;
      if (!ok) throw new Gp150Error("timeout", "The pedal didn't answer the connection request");
      await this.#query(CMD.STATE, [], "state");
      const g = decodeGlobals((await this.#query(CMD.GLOBALS, [], "settings")).payload);
      return { firmware: g.firmware, globals: globalsOf(g.records), eq: g.records.has(CMD.GLOBAL_EQ) ? eqValues(g.records.get(CMD.GLOBAL_EQ)) : null };
    });
  }

  readPresetNames() {
    return this.exclusive(async () => decodeNames(CMD.PRESET_NAMES, (await this.#query(CMD.PRESET_NAMES, [], "preset names")).payload).map((e) => ({ slot: e.slot, name: e.name })));
  }

  readIrNames() {
    return this.exclusive(async () => toEntries(decodeNames(CMD.IR_NAMES, (await this.#query(CMD.IR_NAMES, [], "User IR names")).payload)));
  }

  /** SnapTone slots 1-100 (the list's entry 0, "None", is left out). */
  readSnapToneNames() {
    return this.exclusive(async () =>
      toEntries(decodeNames(CMD.SNAPTONE_NAMES, (await this.#query(CMD.SNAPTONE_NAMES, [], "SnapTone names")).payload)).filter((e) => e.slot >= 1),
    );
  }

  readGlobals() {
    return this.exclusive(async () => {
      const g = decodeGlobals((await this.#query(CMD.GLOBALS, [], "settings")).payload);
      return { firmware: g.firmware, values: globalsOf(g.records), eq: g.records.has(CMD.GLOBAL_EQ) ? eqValues(g.records.get(CMD.GLOBAL_EQ)) : null };
    });
  }

  async #readPatch(slot, select) {
    const reply = await this.#request(readPatch(slot, select), (m) => m.p === P.QUERY && m.cmd === CMD.PATCH && isGp150Prst(m.payload), "preset");
    return normalize(reply.payload);
  }

  /** The edit buffer (active preset with its edits); its slot field names the active slot. */
  readEditBuffer() {
    return this.exclusive(async () => {
      const prst = await this.#readPatch(EDIT_BUFFER, false);
      const slot = parsePrst(prst).slot;
      if (slot < SLOTS.PRESETS) this.#currentSlot = slot;
      return { slot, prst };
    });
  }

  /** Stored preset of `slot`, without selecting it. */
  readPreset(slot) {
    checkSlot(slot, SLOTS.PRESETS, "Preset slot");
    return this.exclusive(() => this.#readPatch(slot, false));
  }

  /** Make `slot` the active preset; resolves with its file. */
  selectPreset(slot) {
    checkSlot(slot, SLOTS.PRESETS, "Preset slot");
    return this.exclusive(async () => {
      const prst = await this.#readPatch(slot, true);
      this.#currentSlot = slot;
      this.#modified = false;
      return prst;
    });
  }

  async backupAll(opts = {}) {
    const names = await this.readPresetNames();
    const out = [];
    for (const n of names) {
      const prst = await this.readPreset(n.slot);
      out.push({ slot: n.slot, name: parsePrst(prst).name, prst });
      opts.onProgress?.(out.length, names.length);
    }
    return out;
  }

  // ----------------------------------------------------------------------------------------- live edits

  setParam(block, param, fxid, value) {
    return this.set(setParam(block, param, fxid, value));
  }
  setBlockEnabled(block, on) {
    return this.set(setBlockOn(block, on));
  }
  setModel(block, fxid) {
    return this.set(setModel(block, fxid));
  }
  /** Patch settings record of the active preset with `edits` ({ tempo, volume, namMode, name }) applied. */
  async setPatchSettings(current, edits) {
    return this.set(setPatchSettings(settingsRecord(applyPatchEdits(current, edits))));
  }
  setKnobs(targets) {
    return this.set(setKnobs(targets));
  }

  /** One setting: its record as last reported, with the value changed. */
  setGlobal(name, value, spec) {
    return this.exclusive(async () => {
      const record = this.#records.get(spec.cmd);
      if (!record) throw new Gp150Error("length", `The pedal hasn't reported its settings record 0x${spec.cmd.toString(16)} yet`);
      const next = writeGlobal(record, name, value);
      await this.#send(setGlobalRecord(spec.cmd, next));
      this.#records.set(spec.cmd, next);
    });
  }

  /** The whole Global EQ (32 values). */
  setGlobalEq(values) {
    return this.exclusive(async () => {
      const record = eqRecord(values);
      await this.#send(setGlobalRecord(CMD.GLOBAL_EQ, record));
      this.#records.set(CMD.GLOBAL_EQ, record);
    });
  }

  // ----------------------------------------------------------------------------------------- memory writes

  /** Write `prst` into `slot` (the import Suite does), then read it back. `slot` is active afterwards. */
  writePreset(slot, prst, opts) {
    needConfirm(opts, "Writing a preset");
    checkSlot(slot, SLOTS.PRESETS, "Preset slot");
    return this.exclusive(async () => {
      const file = forImport(prst, slot);
      await this.#request(importPatch(file), (m) => m.p === P.DONE && m.cmd === CMD.PATCH, "preset write", this.#timing.uploadTimeoutMs);
      opts.onProgress?.(1, 2);
      let verified = false;
      if (opts.verify !== false) {
        const back = await this.#readPatch(slot, false);
        if (!imagesMatch(back, file)) throw new Gp150Error("verify", `Slot ${slot + 1} reads back different from what was written`);
        verified = true;
      }
      await this.#readPatch(slot, true);
      this.#currentSlot = slot;
      this.#modified = false;
      opts.onProgress?.(2, 2);
      return { verified };
    });
  }

  async renamePreset(slot, name, opts) {
    needConfirm(opts, "Renaming a preset");
    const prst = await this.readPreset(slot);
    await this.writePreset(slot, applyPatchEdits(prst, { name }), opts);
    return { slot, name: parsePrst(await this.readPreset(slot)).name };
  }

  async #upload(cmd, listCmd, slot, name, data, opts) {
    await this.exclusive(() => this.#request(upload(cmd, slot, name, data), (m) => m.p === P.DONE && m.cmd === cmd, "upload", this.#timing.uploadTimeoutMs));
    opts.onProgress?.(1, 1);
    const list = listCmd === CMD.IR_NAMES ? await this.readIrNames() : await this.readSnapToneNames();
    const entry = list.find((e) => e.slot === slot);
    if (!entry) throw new Gp150Error("verify", `Slot ${slot} is missing from the list after the upload`);
    return entry;
  }

  /** User IR slot 0-19: up to 2048 24-bit samples as int32 (Suite sends 683 at 44.1 kHz, zero-filled). */
  uploadUserIr(slot, name, samples, opts) {
    needConfirm(opts, "Uploading a User IR");
    checkSlot(slot, SLOTS.USER_IRS, "User IR slot");
    if (samples.length > 2048) throw new RangeError(`A GP-150 User IR is up to 2048 samples; got ${samples.length}`);
    const data = new Uint8Array(0x2000);
    const view = new DataView(data.buffer);
    for (let i = 0; i < samples.length; i++) view.setInt32(4 * i, samples[i], true);
    return this.#upload(CMD.IR_UPLOAD, CMD.IR_NAMES, slot, name, data, opts);
  }

  /** SnapTone slot 1-100: the 2696-byte SnapTone file of the GP-5 family (VTSI). */
  uploadSnapTone(slot, name, file, opts) {
    needConfirm(opts, "Uploading a SnapTone");
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOTS.SNAPTONES) throw new RangeError(`SnapTone slot ${slot} is outside 1..${SLOTS.SNAPTONES}`);
    return this.#upload(CMD.SNAPTONE_UPLOAD, CMD.SNAPTONE_NAMES, slot, name, file, opts);
  }

  /** Rename a User IR (0-19) or SnapTone (1-100) slot. */
  renameListSlot(kind, slot, name, opts) {
    needConfirm(opts, "Renaming a slot");
    return this.set(renameMessage(kind === "ir" ? CMD.IR_RENAME : CMD.SNAPTONE_RENAME, slot, name));
  }
}
