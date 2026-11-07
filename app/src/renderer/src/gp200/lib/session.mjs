// Gp200Session: transport-agnostic, paced, serialized request/response layer for the Valeton GP-200 family.
// Same transport contract as the GP-5 toolkit:
//   { name: string, send(bytes: Uint8Array): void, onMessage(cb: (bytes: Uint8Array) => void): void, close(): void|Promise<void> }
//
// Rules from the editor RE and OSS hardware work:
//  - no ACKs exist: never wait for one. Replies exist only for queries, the 0x2003 save echo and upload results.
//  - pace like the editor: >= 10 ms between frames, 1 s after the last chunk of a multi-chunk message (also covers the
//    ~0.8 s the pedal ignores commands after a write burst); one request in flight; queries 1000 ms x 3 resends.
//  - verify every full write by reading the slot back twice, ignoring the volatile bytes; retry the write.
//  - writing the active slot leaves the edit buffer stale: select another slot first, re-select afterwards.
//  - never send the frames dangerOf() rejects; in updater mode send nothing at all.

import {
  DEVICE_TYPES,
  GLOBALS,
  PATCH_SETTING,
  Reassembler,
  STYLE_COUNT,
  SysexAssembler,
  USER_IR,
  dangerOf,
  dangerOfMessage,
  decodeFrame,
  decodeMessage,
  decodeSoftwareState,
  encode,
  encodeFrames,
  imageWithSlot,
  sanitizeName,
  slotLabel,
  BLOCK,
} from "./protocol.mjs";
import { applyPatchEdits, buildPrst, firstDifference, imageOf, parsePatch, withEightCtrl } from "./prst.mjs";
import { SNAPTONE, isSnapToneSlot, toGp200SnapTone } from "./snaptone.mjs";

/** Longest SnapTone / User IR name a rename writes: the 16-byte field keeps a terminating NUL. */
export const SLOT_NAME_MAX = 15;

export const DEFAULT_TIMING = Object.freeze({
  frameGapMs: 10, // the editor pumps its TX queue with a 10 ms timer, one frame per tick
  multiChunkPauseMs: 1000, // the editor sleeps 1 s after any multi-chunk message
  identityGapMs: 100, // 0x2001 query -> SOFTWARE_STATE
  replyTimeoutMs: 1000, // per query (sync step)
  resends: 3, // per query
  globalsPushMs: 4000, // wait for the pushed 0x1007 after SOFTWARE_STATE (editor: 4 x 1 s)
  saveTimeoutMs: 3000, // 0x2003 echo
  uploadTimeoutMs: 8000, // 0x100B / 0x1014
  selectSettleMs: 150, // the pedal fades a new patch in over 113 ms
  writeAttempts: 3,
  verifyReads: 2,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Gp200Error extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "timeout" | "length" | "verify" | "unsafe" | "closed" | "updater"
  }
}

const blockOf = (b) => {
  const i = typeof b === "number" ? b : BLOCK[String(b).toUpperCase()];
  if (!Number.isInteger(i) || i < 0 || i > 10) throw new RangeError(`unknown block ${b}`);
  return i;
};
const kindIs = (kind, pred = () => true) => (m) => m.records?.some((r) => r.kind === kind && pred(r));
const recordOf = (m, kind) => m.records.find((r) => r.kind === kind);

export class Gp200Session extends EventTarget {
  #t;
  #timing;
  #log;
  #chain = Promise.resolve();
  #nextSendAt = 0;
  #sysex = new SysexAssembler();
  #reasm = new Reassembler();
  #waiters = new Set();
  #closed = false;
  #updater = false;
  #flushes = 0;
  #deviceType = null;
  #globals = null;
  #current = null;
  #dirty = false;

  /** @param opts { timing?: Partial<DEFAULT_TIMING>, log?: (dir, bytes, decoded?) => void } */
  constructor(transport, opts = {}) {
    super();
    this.#t = transport;
    this.#timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.#log = opts.log;
    transport.onMessage((bytes) => this.#onBytes(bytes));
  }

  get transportName() {
    return this.#t.name;
  }
  /** "gp200" | "gp200lt" | "gp200jr" once connected, else null. */
  get device() {
    return DEVICE_TYPES[this.#deviceType]?.key ?? null;
  }
  get deviceType() {
    return this.#deviceType;
  }
  get deviceName() {
    return DEVICE_TYPES[this.#deviceType]?.name ?? null;
  }
  get isUpdater() {
    return this.#updater;
  }
  /** "major.minor.patch" from the last 0x1007, or null. */
  get firmware() {
    return this.#globals?.firmware ?? null;
  }
  /** Last known globals { [name]: value } (0x1007 + echoes), or null before connect. */
  get globals() {
    return this.#globals ? { ...this.#globals.values } : null;
  }
  get currentSlot() {
    return this.#current;
  }
  /** Edit buffer differs from the stored slot (device 0x1011 sub 1). */
  get dirty() {
    return this.#dirty;
  }
  /** 256 (GP-200, LT) or 255 (JR); 256 before connect. */
  get slotCount() {
    return DEVICE_TYPES[this.#deviceType]?.slots ?? 256;
  }

  // ------------------------------------------------------------------------------------------- receive

  #onBytes(bytes) {
    for (const m of this.#sysex.push(bytes)) this.#onMessage(m);
  }

  #onMessage(bytes) {
    if (bytes[0] !== 0xf0) {
      this.#log?.("rx", bytes);
      this.dispatchEvent(Object.assign(new Event("midi"), { data: bytes }));
      return;
    }
    const frame = decodeFrame(bytes);
    if (!frame) {
      this.#log?.("rx-bad", bytes);
      this.dispatchEvent(Object.assign(new Event("badframe"), { data: bytes }));
      return;
    }
    if (frame.kind === "flush") {
      // the device asks the host to drop its TX queue: the message being sent stops (writes get verified anyway)
      this.#flushes++;
      this.#log?.("rx", bytes, { kind: "flush" });
      this.#deliver({ cmd: frame.cmd, header: null, records: [{ kind: "flush" }], patch: null });
      return;
    }
    if (frame.kind === "address") {
      const rec = frame.address === "softwareState" ? { kind: "softwareState", ...decodeSoftwareState(frame.data) } : { kind: "softwareJump" };
      this.#log?.("rx", bytes, rec);
      this.#deliver({ cmd: frame.cmd, header: null, records: [rec], patch: null });
      return;
    }
    const msg = this.#reasm.push(frame);
    if (!msg) return;
    const decoded = decodeMessage(msg);
    this.#log?.("rx", bytes, decoded);
    this.#observe(decoded);
    this.#deliver(decoded);
  }

  /** Keep the session's view of the pedal current from anything it says. */
  #observe(m) {
    for (const r of m.records) {
      if (r.kind === "globals") {
        this.#globals = { firmware: r.firmware, values: { ...r.values } };
        if (r.currentSlot !== null && r.currentSlot < this.slotCount) this.#current = r.currentSlot;
      } else if (r.kind === "patchChanged") {
        this.#current = r.slot;
        this.#dirty = false;
      } else if (r.kind === "global" && r.name && this.#globals) {
        this.#globals = { ...this.#globals, values: { ...this.#globals.values, [r.name]: r.value } };
      } else if (r.kind === "dirty") this.#dirty = r.dirty;
      else if (r.kind === "identity" && DEVICE_TYPES[r.deviceType]) this.#deviceType ??= r.deviceType;
    }
  }

  #deliver(m) {
    let consumed = false;
    for (const w of this.#waiters) if (w.match(m)) (consumed = true), w.resolve(m);
    if (consumed) return;
    // "message" = unsolicited traffic: pedal knobs/footswitches, echoes, late replies
    if (m.patch) return this.dispatchEvent(Object.assign(new Event("message"), { message: { kind: "patch", ...m.patch, header: m.header } }));
    for (const r of m.records) this.dispatchEvent(Object.assign(new Event("message"), { message: { ...r, header: m.header } }));
  }

  #waitFor(match, timeoutMs, what) {
    let w;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(w);
        reject(new Gp200Error("timeout", `${what}: no reply within ${timeoutMs} ms`));
      }, timeoutMs);
      w = {
        match,
        resolve: (m) => {
          clearTimeout(timer);
          this.#waiters.delete(w);
          resolve(m);
        },
        cancel: () => {
          clearTimeout(timer);
          this.#waiters.delete(w);
        },
      };
      this.#waiters.add(w);
    });
    promise.catch(() => {}); // awaited later; avoid an unhandled rejection while frames are still being sent
    return { promise, cancel: () => w.cancel() };
  }

  // ------------------------------------------------------------------------------------------- send

  async #waitUntil(t) {
    for (let now = Date.now(); now < t; now = Date.now()) await sleep(t - now);
  }

  async #sendFrame(bytes) {
    if (this.#closed) throw new Gp200Error("closed", "session closed");
    if (this.#updater) throw new Gp200Error("updater", "the pedal is in firmware-update mode; nothing is sent");
    const why = dangerOf(bytes);
    if (why) throw new Gp200Error("unsafe", `refusing to send ${why}`);
    await this.#waitUntil(this.#nextSendAt);
    this.#log?.("tx", bytes);
    this.#t.send(bytes);
    this.#nextSendAt = Date.now() + this.#timing.frameGapMs;
  }

  /** Frame and send one message; returns the number of frames sent (fewer when the pedal asked for a flush). */
  async #sendMessage(msg, onFrame) {
    const why = dangerOfMessage(msg);
    if (why) throw new Gp200Error("unsafe", `refusing to send ${why}`);
    const frames = encodeFrames(msg);
    const flushes = this.#flushes;
    let sent = 0;
    for (const f of frames) {
      if (this.#flushes !== flushes) break;
      await this.#sendFrame(f);
      sent++;
      onFrame?.(sent, frames.length);
    }
    if (frames.length > 1) this.#nextSendAt = Math.max(this.#nextSendAt, Date.now() + this.#timing.multiChunkPauseMs);
    return sent;
  }

  /** Serialize fn behind every previous exchange. */
  exclusive(fn) {
    const run = this.#chain.then(fn, fn);
    this.#chain = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /**
   * Send `msg` (a host message, or a function that sends several) and wait for a reply matching `match`; resend on
   * timeout (editor: 1000 ms x 3).
   */
  async #query(msg, match, what, { timeoutMs = this.#timing.replyTimeoutMs, resends = this.#timing.resends } = {}) {
    const send = typeof msg === "function" ? msg : () => this.#sendMessage(msg);
    for (let attempt = 0; ; attempt++) {
      const reply = this.#waitFor(match, timeoutMs, what);
      try {
        await send();
        return await reply.promise;
      } catch (e) {
        reply.cancel();
        if (e.code !== "timeout" || attempt >= resends) throw e.code === "timeout" ? new Gp200Error("timeout", `${what}: no reply after ${attempt + 1} tries`) : e;
        this.#log?.("warn", new Uint8Array(), { kind: "resend", what, attempt: attempt + 1 });
      }
    }
  }

  /** Send a host message (paced, guarded); no reply is awaited. */
  send(msg) {
    return this.exclusive(() => this.#sendMessage(msg));
  }

  /** Raw short MIDI message (CC/PC), paced like everything else. */
  sendShort(bytes) {
    return this.exclusive(() => this.#sendFrame(Uint8Array.from(bytes)));
  }

  async close() {
    this.#closed = true;
    await this.#chain.catch(() => {});
    for (const w of this.#waiters) w.cancel();
    await this.#t.close();
  }

  // ------------------------------------------------------------------------------------------- connect

  /**
   * Connect FSM (editor @0x1001231b0): 0x2001 query, 100 ms, SOFTWARE_STATE ("enter editor mode"), resent together
   * like any query. The 0x2001 reply `{state, deviceType}` identifies the pedal; SOFTWARE_STATE has no reply in normal
   * mode (USB captures of the editor and a GP-200 on firmware 1.8.0, phash/gp200editor), so only an update-mode answer
   * `{0, type}` is taken from it. State 0 = updater mode -> Gp200Error "updater" and the session sends nothing else.
   * Then wait for the pushed 0x1007 (firmware + globals + current slot), falling back to a 0x1006 state-dump request.
   */
  connect() {
    return this.exclusive(async () => {
      this.#globals = null;
      const { identityGapMs, replyTimeoutMs } = this.#timing;
      const hello = async () => {
        await this.#sendMessage(encode.identity());
        await sleep(identityGapMs);
        await this.#sendMessage(encode.softwareState());
      };
      const answer = (m) => kindIs("identity")(m) || kindIs("softwareState", (r) => r.state === 0)(m);
      const m = await this.#query(hello, answer, "0x2001 identity", { timeoutMs: identityGapMs + replyTimeoutMs });
      const { state, deviceType: type } = recordOf(m, "identity") ?? recordOf(m, "softwareState");
      if (state === 0) {
        this.#updater = true;
        throw new Gp200Error("updater", "The GP-200 is in firmware-update mode. Update or restart it with Valeton's tool, then reconnect.");
      }
      if (!DEVICE_TYPES[type]) throw new Gp200Error("unsafe", `unknown GP-200 device type ${type}; refusing to continue`);
      this.#deviceType = type;
      if (!this.#globals) {
        const push = this.#waitFor(kindIs("globals"), this.#timing.globalsPushMs, "0x1007 push");
        await push.promise.catch(() => this.#query(encode.stateDump(), kindIs("globals"), "0x1006 state dump"));
      }
      return { device: this.device, deviceType: type, name: this.deviceName, firmware: this.firmware, currentSlot: this.#current, globals: this.globals };
    });
  }

  // ------------------------------------------------------------------------------------------- reads

  #checkSlot(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCount) throw new RangeError(`slot must be 0..${this.slotCount - 1}, got ${slot}`);
  }

  #imageFrom(m, what) {
    try {
      parsePatch(m.patch.image);
    } catch (e) {
      throw new Gp200Error("length", `${what}: ${e.message}`);
    }
    return m.patch.image;
  }

  async #readStoredNow(slot) {
    const m = await this.#query(encode.readStored(slot), (x) => x.patch?.stored && x.patch.slot === slot, `read slot ${slotLabel(slot)}`);
    return this.#imageFrom(m, `slot ${slotLabel(slot)}`);
  }

  /** Stored image (1168 bytes) of `slot`; does not change the active patch. */
  readStored(slot) {
    this.#checkSlot(slot);
    return this.exclusive(() => this.#readStoredNow(slot));
  }

  /** Live edit buffer of the current slot: { slot, image }. */
  readEditBuffer() {
    return this.exclusive(async () => {
      const cur = this.#cur();
      const m = await this.#query(encode.readEditBuffer(cur), (x) => x.patch && !x.patch.stored, "read edit buffer");
      return { slot: m.patch.slot, image: this.#imageFrom(m, "edit buffer") };
    });
  }

  /** Stored slot as { slot, label, name, image, prst }. */
  async readPreset(slot) {
    const image = await this.readStored(slot);
    return { slot, label: slotLabel(slot), name: parsePatch(image).name, image, prst: buildPrst(image) };
  }

  /** Read every slot: [{ slot, label, name, image, prst }]. Reads stored slots: nothing is selected. */
  async backupAll({ onProgress } = {}) {
    const wanted = Array.from({ length: this.slotCount }, (_, i) => i);
    const out = [];
    for (const slot of wanted) {
      const entry = await this.readPreset(slot);
      out.push(entry);
      onProgress?.(out.length, wanted.length, entry);
    }
    return out;
  }

  /** Names of every slot (the GP-200 has no name table: each slot is read). */
  async readPresetNames({ onProgress } = {}) {
    const all = await this.backupAll({ onProgress });
    return all.map(({ slot, label, name }) => ({ slot, label, name }));
  }

  #readNames(count, msgOf, kind, what) {
    return this.exclusive(async () => {
      const out = [];
      for (let i = 0; i < count; i++) {
        const m = await this.#query(msgOf(i), kindIs(kind, (r) => r.slot === i), `${what} ${i + 1}`);
        const { slot, flag, sum, name } = recordOf(m, kind);
        out.push({ slot, flag, sum, name });
      }
      return out;
    });
  }

  /** User IR names (20): [{ slot, flag, sum, name }]. */
  readIrNames() {
    return this.#readNames(USER_IR.SLOTS, encode.irName, "irName", "User IR name");
  }
  /** SnapTone names (10; 0-4 AMP, 5-9 DST): [{ slot, flag, sum, name }]. */
  readSnapToneNames() {
    return this.#readNames(SNAPTONE.SLOTS, encode.snapToneName, "snapToneName", "SnapTone name");
  }
  /**
   * Drum style-group names (20); entries the pedal does not answer are null (the query layout is inferred). No reply to
   * the first one: the pedal doesn't answer the query, so the others aren't asked (all null, logged as skipped).
   */
  readStyleNames() {
    return this.exclusive(async () => {
      const out = [];
      for (let i = 0; i < STYLE_COUNT; i++) {
        const m = await this.#query(encode.styleName(i), kindIs("styleName", (r) => r.index === i), `style name ${i + 1}`).catch((e) => {
          if (e.code !== "timeout") throw e;
          return null;
        });
        if (!m && i === 0) {
          this.#log?.("warn", new Uint8Array(), { kind: "skipped", what: "drum style names" });
          return new Array(STYLE_COUNT).fill(null);
        }
        out.push(m ? recordOf(m, "styleName").name : null);
      }
      return out;
    });
  }
  /** { playing, flag, exp1AB } from 0x1000. */
  readDrumState() {
    return this.exclusive(async () => {
      const { playing, flag, exp1AB } = recordOf(await this.#query(encode.drumState(), kindIs("drumState"), "0x1000 drum state"), "drumState");
      return { playing, flag, exp1AB };
    });
  }
  /** 0x1006 state dump -> { firmware, currentSlot, values }. */
  readGlobals() {
    return this.exclusive(async () => {
      const g = recordOf(await this.#query(encode.stateDump(), kindIs("globals"), "0x1006 state dump"), "globals");
      return { firmware: g.firmware, currentSlot: g.currentSlot, values: g.values };
    });
  }
  /**
   * An optional read (sync tables, the name read-back after an upload): no reply after the resends means this pedal
   * doesn't answer that query (a GP-200LT on firmware 1.6.0 never answered 0x1009), so it yields null and a "skipped"
   * warning instead of failing. A list stops at its first unanswered entry: a silent pedal costs one entry's tries, not 20 x 4 s.
   */
  async #optional(read, what) {
    try {
      return await read();
    } catch (e) {
      if (e.code !== "timeout") throw e;
      this.#log?.("warn", new Uint8Array(), { kind: "skipped", what });
      return null;
    }
  }

  /**
   * Full sync in the editor's order: 0x1000, IR names x 20, every slot, style names x 20, edit buffer,
   * SnapTone names x 10 (308 steps on a GP-200). onProgress(done, total, step). Drum state and the name tables are
   * optional (null when the pedal doesn't answer them, styles all null); slots and the edit buffer are not.
   */
  async sync({ onProgress } = {}) {
    const total = 1 + USER_IR.SLOTS + this.slotCount + STYLE_COUNT + 1 + SNAPTONE.SLOTS;
    let done = 0;
    const step = (name, n = 1) => onProgress?.((done += n), total, name);
    const drum = await this.#optional(() => this.readDrumState(), "drum state");
    step("drum");
    const irNames = await this.#optional(() => this.readIrNames(), "User IR names");
    step("irNames", USER_IR.SLOTS);
    const presets = await this.backupAll({ onProgress: () => step("presets") });
    const styles = await this.readStyleNames();
    step("styles", STYLE_COUNT);
    const editBuffer = await this.readEditBuffer();
    step("editBuffer");
    const snapToneNames = await this.#optional(() => this.readSnapToneNames(), "SnapTone names");
    step("snapToneNames", SNAPTONE.SLOTS);
    return { device: this.device, firmware: this.firmware, currentSlot: this.#current, globals: this.globals, drum, irNames, presets, styles, editBuffer, snapToneNames };
  }

  // ------------------------------------------------------------------------------------------- select + live edits

  #cur() {
    if (this.#current === null) throw new Gp200Error("unsafe", "current slot unknown; call connect() first");
    return this.#current;
  }

  /** Select `slot` with 0x1008 {0, slot} (CC0 polarity is unverified, so no CC/PC). */
  selectPreset(slot) {
    this.#checkSlot(slot);
    return this.exclusive(async () => {
      await this.#sendMessage(encode.select(slot));
      this.#current = slot;
      this.#dirty = false;
      await sleep(this.#timing.selectSettleMs);
      return slot;
    });
  }

  #edit(build) {
    return this.exclusive(async () => {
      await this.#sendMessage(build(this.#cur()));
    });
  }

  /** Param `paramId` (XML ID) of the model `fxid` in `block`, in display units. */
  setParam(block, paramId, fxid, value) {
    return this.#edit((cur) => encode.param(cur, { block: blockOf(block), paramId, fxid, value }));
  }
  setBlockEnabled(block, on) {
    return this.#edit((cur) => encode.blockEnabled(cur, blockOf(block), on));
  }
  /** Model change; send the new model's params after it (the pedal does not keep the old ones). */
  setModel(block, fxid) {
    return this.#edit((cur) => encode.model(cur, blockOf(block), fxid));
  }
  setChain({ order, sendPos, returnPos }) {
    return this.#edit((cur) => encode.chain(cur, { order, sendPos, returnPos }));
  }
  setPatchSetting(target, value) {
    return this.#edit((cur) => encode.patchSetting(cur, target, value));
  }
  setPatchVolume(v) {
    return this.setPatchSetting(PATCH_SETTING.VOL, v);
  }
  /** Patch tempo, BPM 40-250. */
  setTempo(bpm) {
    return this.setPatchSetting(PATCH_SETTING.TEMPO, bpm);
  }
  /** Name of the edit buffer (live; save or write to keep it). */
  setPatchName(name) {
    return this.#edit((cur) => encode.patchName(cur, sanitizeName(name)));
  }
  /** EXP slot { key (exp << 4 | para), block (0xFF none), param, max, min }. */
  setExp(slotDef) {
    return this.#edit((cur) => encode.exp(cur, slotDef));
  }
  setExpRange(which, key, value) {
    return this.#edit((cur) => encode.expRange(cur, which, key, value));
  }
  /** CTRL `index` (0-7): the whole block mask (bits 0-10). */
  setCtrl(index, mask, state = 0) {
    return this.#edit((cur) => encode.ctrl(cur, index, state, mask & 0x7ff));
  }
  /** Quick-Access knob 0-2 -> block 0-10, 0x0B patch VOL, 0x0C tempo, 0xFF off. */
  setQuickAccess(index, block, param) {
    return this.#edit((cur) => encode.quickAccess(cur, index, block, param));
  }

  /** Global by name (protocol GLOBALS). Destructive ids are not reachable from here. */
  setGlobal(name, value) {
    const g = GLOBALS[name];
    if (!g) throw new RangeError(`unknown global ${name}; one of ${Object.keys(GLOBALS).join(", ")}`);
    return this.exclusive(async () => {
      await this.#sendMessage(encode.global(g.id, value));
      if (this.#globals) this.#globals = { ...this.#globals, values: { ...this.#globals.values, [name]: value } };
    });
  }
  /** Global EQ element 0-30 (protocol GLOBAL_EQ_INDEX). */
  setGlobalEq(index, value) {
    if (!Number.isInteger(index) || index < 0 || index > 30) throw new RangeError(`global EQ index must be 0..30, got ${index}`);
    return this.send(encode.globalEq(index, value));
  }

  // ------------------------------------------------------------------------------------------- persistent writes

  #guard(confirm, what) {
    if (confirm !== true) throw new Gp200Error("unsafe", `${what} overwrites pedal memory; pass { confirm: true } after backing up`);
  }

  /** Store the edit buffer into absolute slot `slot` as `name`; resolves on the pedal's 0x2003 echo. */
  async savePreset(slot, name, { confirm } = {}) {
    this.#guard(confirm, "savePreset");
    this.#checkSlot(slot);
    const label = sanitizeName(name);
    await this.exclusive(() => this.#query(encode.save(slot, label), kindIs("saved", (r) => r.slot === slot), `save to ${slotLabel(slot)}`, { timeoutMs: this.#timing.saveTimeoutMs, resends: 0 }));
    return { slot, name: label };
  }

  /**
   * Rename slot `slot`. The current slot: rename the edit buffer and save it (pending live edits are saved too, as
   * on the pedal). Any other slot: read it, change the name, full write + verify.
   */
  async renamePreset(slot, name, { confirm } = {}) {
    this.#guard(confirm, "renamePreset");
    this.#checkSlot(slot);
    const label = sanitizeName(name);
    if (slot === this.#current) {
      await this.setPatchName(label);
      return this.savePreset(slot, label, { confirm });
    }
    await this.writePreset(slot, applyPatchEdits(await this.readStored(slot), { name: label }), { confirm });
    return { slot, name: label };
  }

  /**
   * Full write of a patch image or .prst into `slot` (7 frames, no ACK), then read the slot back `verifyReads` times;
   * every read must match outside the volatile bytes, else the write is repeated (up to `attempts`). The active slot
   * is never written while active: another slot is selected first and `slot` re-selected afterwards.
   */
  async writePreset(slot, data, { confirm, verify = true, attempts = this.#timing.writeAttempts, onProgress } = {}) {
    this.#guard(confirm, "writePreset");
    this.#checkSlot(slot);
    let image;
    try {
      image = imageWithSlot(withEightCtrl(imageOf(data)), slot);
    } catch (e) {
      throw new Gp200Error("length", `not a GP-200 patch: ${e.message}`);
    }
    const reselect = slot === this.#cur();
    if (reselect) await this.selectPreset((slot + 1) % this.slotCount);
    try {
      for (let attempt = 1; ; attempt++) {
        const frames = await this.exclusive(() => this.#sendMessage(encode.fullWrite(slot, image), onProgress));
        if (!verify) return { frames, attempts: attempt, verified: false };
        const diff = await this.#verifyStored(slot, image);
        if (diff === -1) return { frames, attempts: attempt, verified: true };
        this.#log?.("warn", new Uint8Array(), { kind: "verify", slot, attempt, offset: diff });
        if (attempt >= attempts) {
          const why = diff === -2 ? "the pedal did not answer the read-back" : `the read-back differs at image byte ${diff}`;
          throw new Gp200Error("verify", `slot ${slotLabel(slot)} not verified after ${attempts} writes: ${why}`);
        }
      }
    } finally {
      if (reselect) await this.selectPreset(slot).catch(() => {});
    }
  }

  /** -1 when `verifyReads` read-backs all match `image`, else the first differing offset (or -2: no reply). */
  async #verifyStored(slot, image) {
    for (let i = 0; i < this.#timing.verifyReads; i++) {
      let back;
      try {
        back = await this.readStored(slot);
      } catch (e) {
        if (e.code !== "timeout" && e.code !== "length") throw e;
        return -2;
      }
      const diff = firstDifference(image, back);
      if (diff !== -1) return diff;
    }
    return -1;
  }

  /**
   * Upload a User IR into slot 0-19: `samples` = up to 1024 24-bit samples at 44.1 kHz (int32 values). Waits for the
   * pedal's 0x100B result (status 1 = ok, strict), then re-reads the slot's name (optional: entry null when the pedal
   * doesn't answer 0x1009, logged as skipped). Result: { slot, name, frames, entry }.
   */
  async uploadUserIr(slot, name, samples, { confirm, onProgress } = {}) {
    this.#guard(confirm, "uploadUserIr");
    if (!Number.isInteger(slot) || slot < 0 || slot >= USER_IR.SLOTS) throw new Gp200Error("unsafe", `User IR slot must be 0..${USER_IR.SLOTS - 1}, got ${slot}`);
    const label = sanitizeName(name) || `IR ${slot + 1}`;
    const frames = await this.#upload(encode.userIr(slot, label, samples), "irResult", slot, "User IR", onProgress);
    const what = `User IR name ${slot + 1}`;
    const m = await this.#optional(() => this.exclusive(() => this.#query(encode.irName(slot), kindIs("irName", (r) => r.slot === slot), what)), what);
    return { slot, name: label, frames, entry: m && recordOf(m, "irName") };
  }

  /**
   * Upload a SnapTone into slot 0-9 (0-4 AMP, 5-9 DST): `blob` = a 0x2288 clone (cut to the GP-200's 1024 taps here)
   * or a 0x1288 GP-200 blob. Waits for 0x1014 (strict), then re-reads the name (optional, like uploadUserIr).
   * Result: { slot, name, frames, entry }.
   */

  async uploadSnapTone(slot, name, blob, { confirm, onProgress } = {}) {
    this.#guard(confirm, "uploadSnapTone");
    if (!isSnapToneSlot(slot)) throw new Gp200Error("unsafe", `SnapTone slot must be 0..${SNAPTONE.SLOTS - 1}, got ${slot}`);
    let data;
    try {
      data = toGp200SnapTone(blob);
    } catch (e) {
      throw new Gp200Error("length", e.message);
    }
    const label = sanitizeName(name) || `SnapTone ${slot + 1}`;
    const frames = await this.#upload(encode.snapTone(slot, label, data), "snapToneResult", slot, "SnapTone", onProgress);
    const what = `SnapTone name ${slot + 1}`;
    const m = await this.#optional(() => this.exclusive(() => this.#query(encode.snapToneName(slot), kindIs("snapToneName", (r) => r.slot === slot), what)), what);
    return { slot, name: label, frames, entry: m && recordOf(m, "snapToneName") };
  }

  /**
   * Rename a stored SnapTone (slot 0-9) or User IR (slot 0-19): 0x1015 / 0x100c with { slot, 2 bytes, 16-byte name }, the
   * layout Valeton's editor uses for these records. Names are printable ASCII up to 15 characters, so the field keeps a
   * terminating NUL. The slot's name is then read back and must match (strict, "verify" otherwise).
   * Result: the name as stored.
   */
  async renameSnapTone(slot, name, { confirm } = {}) {
    this.#guard(confirm, "renameSnapTone");
    if (!isSnapToneSlot(slot)) throw new Gp200Error("unsafe", `SnapTone slot must be 0..${SNAPTONE.SLOTS - 1}, got ${slot}`);
    return this.#renameSlot(encode.snapToneRename, encode.snapToneName, "snapToneName", slot, name, `SnapTone ${slot + 1}`);
  }

  async renameUserIr(slot, name, { confirm } = {}) {
    this.#guard(confirm, "renameUserIr");
    if (!Number.isInteger(slot) || slot < 0 || slot >= USER_IR.SLOTS) throw new Gp200Error("unsafe", `User IR slot must be 0..${USER_IR.SLOTS - 1}, got ${slot}`);
    return this.#renameSlot(encode.irRename, encode.irName, "irName", slot, name, `User IR ${slot + 1}`);
  }

  #renameSlot(renameMsg, readMsg, kind, slot, name, what) {
    const label = sanitizeName(name, SLOT_NAME_MAX).trim();
    if (!label) throw new Gp200Error("unsafe", `${what}: the new name is empty`);
    return this.exclusive(async () => {
      await this.#sendMessage(renameMsg(slot, label));
      const stored = recordOf(await this.#query(readMsg(slot), kindIs(kind, (r) => r.slot === slot), `${what} name`), kind).name;
      if (stored !== label) throw new Gp200Error("verify", `${what} reads back as "${stored}" after renaming it to "${label}"`);
      return stored;
    });
  }

  #upload(msg, resultKind, slot, what, onProgress) {
    return this.exclusive(async () => {
      const result = this.#waitFor(kindIs(resultKind, (r) => r.slot === slot), this.#timing.uploadTimeoutMs, `${what} upload result`);
      let frames;
      try {
        frames = await this.#sendMessage(msg, onProgress);
        const r = recordOf(await result.promise, resultKind);
        if (!r.ok) throw new Gp200Error("verify", `${what} upload to slot ${slot + 1} failed (status ${r.status})`);
      } catch (e) {
        result.cancel();
        throw e;
      }
      return frames;
    });
  }
}
