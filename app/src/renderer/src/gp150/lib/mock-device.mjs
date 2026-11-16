// Simulated GP-150 for tests and `?mock=gp150`: answers like the pedal in the GP-180 captures of
// majabojarska/Valeton-GP180-Rev-Eng (hello reply, an ACK for every message, replies with the same command, P=09 after
// uploads, the edit buffer pushed when a preset is selected). Its bank is generated from the effect catalog; its settings
// start from the 0x2000 reply of a GP-180 on firmware 1.1.1.

import {
  CMD,
  CONTROL,
  EDIT_BUFFER,
  GLOBAL_RECORDS,
  NAME_FIELD,
  P,
  SLOTS,
  decodeFrame,
  decodeMessage,
  encodeControl,
  encodeMessage,
  nameField,
  nextSeq,
  packetize,
  readF32,
  readName,
  readU16,
  readU32,
  Reassembler,
  toBytes,
  u16le,
  u32le,
} from "./protocol.mjs";
import { applyPatchEdits, blankPrst, forImport, normalize, OFFSET, parsePrst } from "./prst.mjs";
import { defaultParams, modelsForBlock } from "./catalog.mjs";
import { GP150_CATALOG } from "./catalog-data.mjs";

/** Data of the 0x2000 reply (firmware string, then the settings records 0x2010..0x2070). */
const GLOBALS_HEX =
  "56312e312e3100001020800001000000000048420000803f000020428fc2353f000000000000a0418fc2353f000000000000803f0000c8428fc2353f00000000" +
  "0000803f0000fa438fc2353f000000000000803f00007a448fc2353f000000000000803f00409c458fc2353f000000000000000000409c468fc2353f00000000" +
  "0000803f00429c468fc2353f20201000000001000000000032000000000000003020100000000000ebff01000100000000000000402016000200000000000000" +
  "00000000000004000000000000005020180002000100000000000000101000000000006400000000010060200800680013000001000170207800b80101000000" +
  "0000000000000000000000000000902000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000";
const hexBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

const STYLES = ["Clean", "Crunch", "Drive", "Lead", "Ambient", "Blues", "Metal", "Funk", "Jazz", "Bass"];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Records [cmd][len][data] of a settings reply, after its 8-byte firmware field. */
function splitRecords(data) {
  const out = new Map();
  for (let o = 8; o + 4 <= data.length; ) {
    const cmd = readU16(data, o);
    const len = readU16(data, o + 2);
    if (!cmd) break;
    out.set(cmd, data.slice(o + 4, o + 4 + len));
    o += 4 + len;
  }
  return out;
}

export class MockGp150 {
  /** 200 preset files, by slot */
  presets = [];
  editBuffer;
  activeSlot = 0;
  modified = false;
  irNames = Array.from({ length: SLOTS.USER_IRS }, (_, i) => ({ name: `User IR ${i + 1}`, empty: true }));
  snapToneNames = Array.from({ length: SLOTS.SNAPTONES + 1 }, (_, i) =>
    i === 0 ? { name: "None", empty: false } : i <= 50 ? { name: `Factory ${i}`, empty: false } : { name: `Empty ${i - 50}`, empty: true },
  );
  /** Captured NAM layout: None at 0, then 100 user slots. */
  namNames = Array.from({ length: SLOTS.NAMS + 1 }, (_, i) =>
    i === 0 ? { name: "None", empty: true } : i <= 3 ? { name: `NAM ${i}`, empty: false } : { name: `NAM Slot ${i}`, empty: true },
  );
  /** IR and SnapTone uploads: { cmd, slot, name, data } */
  uploads = [];
  /** Every logical message the host sent, decoded */
  received = [];
  records;
  firmwareField;
  #catalog;
  #latencyMs;
  #name;
  #rx = new Reassembler();
  #seq = 1;
  #listener = () => {};
  /** Host messages not to ACK (fault injection): count */
  dropAcks = 0;

  constructor(opts = {}) {
    this.#catalog = opts.catalog ?? GP150_CATALOG;
    this.#latencyMs = opts.latencyMs ?? 0;
    this.#name = opts.name ?? "GP-150";
    const g = hexBytes(GLOBALS_HEX);
    this.firmwareField = g.slice(0, 8);
    this.records = splitRecords(g);
    for (let slot = 0; slot < SLOTS.PRESETS; slot++) this.presets.push(this.#generate(slot));
    this.editBuffer = this.presets[0].slice();
  }

  /** A preset built from the catalog: amp, cab, drive, reverb and the gate in the default chain. */
  #generate(slot) {
    const pick = (block, k) => {
      const models = modelsForBlock(this.#catalog, block).filter((m) => (m.code >>> 24) !== 0x06);
      return models.length ? models[k % models.length] : null;
    };
    const amp = pick("AMP", slot * 7);
    const blocks = {};
    const use = (index, block, k, enabled) => {
      const m = pick(block, k);
      if (!m) return;
      blocks[index] = { enabled, fxid: m.code, params: Object.fromEntries(defaultParams(this.#catalog, m.code, block).map((v, i) => [i, v])) };
    };
    use(4, "AMP", slot * 7, true);
    use(6, "CAB", slot * 5, true);
    use(2, "DST", slot * 3, slot % 3 === 0);
    use(5, "NR", slot, true);
    use(10, "RVB", slot, slot % 2 === 0);
    use(9, "DLY", slot * 2, slot % 4 === 1);
    const name = `${amp ? amp.name.split(" ")[0] : "Tone"} ${STYLES[slot % STYLES.length]}`.slice(0, 15);
    return applyPatchEdits(blankPrst(slot, name), { blocks, tempo: 80 + (slot % 9) * 10, footswitches: [[2], [9], [10]] });
  }

  /** The host side of the connection. */
  transport() {
    return {
      name: `${this.#name} (simulated)`,
      send: (bytes) => void this.#receive(toBytes(bytes)),
      onMessage: (cb) => {
        this.#listener = cb;
      },
      close: () => {},
    };
  }

  async #out(bytes) {
    if (this.#latencyMs) await delay(this.#latencyMs);
    this.#listener(bytes);
  }

  /** Send one message to the host (packets numbered from 1). */
  async #push(msg) {
    const seq = this.#seq;
    this.#seq = nextSeq(seq);
    for (const p of packetize(msg, seq, false)) await this.#out(p);
  }

  /** Reply / report: [cmd][len][data] (`len` = data length unless given). */
  #record(cmd, data, len = data.length, p = P.QUERY) {
    return encodeMessage({ p, cmd, payload: [...u16le(cmd), ...u16le(len), ...data] });
  }

  async #receive(bytes) {
    const f = decodeFrame(bytes);
    if (!f) return;
    if (f.kind === "control") {
      if (f.type === CONTROL.HELLO) await this.#out(encodeControl({ type: CONTROL.HELLO_REPLY, arg: f.arg }));
      return;
    }
    const done = this.#rx.push(f);
    if (!done) return;
    const msg = decodeMessage(done.bytes);
    if (!msg || !msg.crcOk) return;
    this.received.push(msg);
    if (this.dropAcks > 0) {
      this.dropAcks--;
      return;
    }
    await this.#out(encodeControl({ type: CONTROL.ACK, seq: done.seq }));
    await this.#handle(msg);
  }

  async #handle(msg) {
    const d = msg.payload.subarray(4);
    if (msg.p === P.QUERY) return this.#answer(msg.cmd, d);
    if (msg.p === P.UPLOAD) return this.#upload(msg);
    if (msg.p !== P.SET) return;
    switch (msg.cmd) {
      case CMD.PARAM: {
        const block = d[8];
        const param = d[9];
        this.editBuffer = applyPatchEdits(this.editBuffer, { blocks: { [block]: { params: { [param]: readF32(d, 4) } } } });
        return this.#edited();
      }
      case CMD.BLOCK_ON:
        this.editBuffer = applyPatchEdits(this.editBuffer, { blocks: { [d[0]]: { enabled: d[1] === 1 } } });
        return this.#edited();
      case CMD.MODEL: {
        const fxid = readU32(d, 0);
        const block = readU32(d, 4);
        const params = Object.fromEntries(defaultParams(this.#catalog, fxid, block).map((v, i) => [i, v]));
        this.editBuffer = applyPatchEdits(this.editBuffer, { blocks: { [block]: { fxid, params } } });
        return this.#edited();
      }
      case CMD.PATCH_SETTINGS: {
        const b = this.editBuffer.slice();
        b.set(d.subarray(0, 80), OFFSET.SETTINGS + 4);
        this.editBuffer = b;
        return this.#edited();
      }
      case CMD.KNOBS:
        this.editBuffer = applyPatchEdits(this.editBuffer, { knobs: Object.fromEntries([0, 1, 2].map((k) => [k, { target: readU32(d, 4 * k), param: 0 }])) });
        return this.#edited();
      case CMD.CTRL: {
        const b = this.editBuffer.slice();
        b.set(d.subarray(0, 36), OFFSET.CTRL + 4);
        this.editBuffer = b;
        return this.#edited();
      }
      case CMD.IR_RENAME:
      case CMD.NAM_RENAME:
      case CMD.SNAPTONE_RENAME: {
        const list = msg.cmd === CMD.IR_RENAME ? this.irNames : msg.cmd === CMD.NAM_RENAME ? this.namNames : this.snapToneNames;
        const slot = readU32(d, 0);
        if (list[slot]) list[slot] = { ...list[slot], name: readName(d, 4, NAME_FIELD) };
        return;
      }
      default:
        if (GLOBAL_RECORDS.includes(msg.cmd) || msg.cmd === CMD.GLOBAL_EQ) this.records.set(msg.cmd, Uint8Array.from(d));
    }
  }

  async #edited() {
    if (this.modified) return;
    this.modified = true;
    await this.#push(this.#record(CMD.PATCH_STATE, u32le(1)));
  }

  #names(list, firstSlot) {
    return list.flatMap((e, i) => [...u16le(i + firstSlot), ...u16le(e.empty ? 1 : 0), ...nameField(e.name)]);
  }

  async #answer(cmd, args) {
    switch (cmd) {
      case CMD.STATE:
        return this.#push(this.#record(cmd, u32le(1), 8));
      case CMD.DEVICE_ID:
        return this.#push(this.#record(cmd, new Array(132).fill(0)));
      case CMD.GLOBALS: {
        const data = [...this.firmwareField];
        for (const [c, r] of this.records) data.push(...u16le(c), ...u16le(r.length), ...r);
        while (data.length < 396) data.push(0);
        return this.#push(this.#record(cmd, data));
      }
      case CMD.PRESET_NAMES:
        return this.#push(this.#record(cmd, this.presets.flatMap((p, slot) => [...u32le(slot), ...nameField(parsePrst(p).name)])));
      case CMD.IR_NAMES:
        return this.#push(this.#record(cmd, this.#names(this.irNames, 0)));
      case CMD.SNAPTONE_NAMES:
        return this.#push(this.#record(cmd, this.#names(this.snapToneNames, 0)));
      case CMD.NAM_NAMES:
        return this.#push(this.#record(cmd, this.#names(this.namNames, 0)));
      case CMD.PATCH: {
        const slot = readU16(args, 0);
        const select = args[2] === 0;
        if (slot === EDIT_BUFFER) return this.#push(this.#patch(this.editBuffer));
        if (slot >= SLOTS.PRESETS) return;
        if (!select) return this.#push(this.#patch(this.presets[slot]));
        this.#select(slot);
        await this.#push(this.#patch(this.editBuffer));
        return;
      }
      default:
        if (GLOBAL_RECORDS.includes(cmd) && this.records.has(cmd)) return this.#push(this.#record(cmd, this.records.get(cmd)));
    }
  }

  #patch(prst) {
    return encodeMessage({ p: P.QUERY, cmd: CMD.PATCH, payload: [...prst] });
  }

  #select(slot) {
    this.activeSlot = slot;
    this.editBuffer = this.presets[slot].slice();
    this.modified = false;
  }

  async #upload(msg) {
    const d = msg.payload.subarray(4);
    const result = (cmd) => this.#push(this.#record(cmd, [0, 0, 0, 0], 4, P.DONE));
    if (msg.cmd === CMD.PATCH) {
      const prst = normalize(msg.payload);
      const slot = parsePrst(prst).slot;
      if (slot < SLOTS.PRESETS) this.presets[slot] = prst;
      return result(CMD.PATCH);
    }
    if (msg.cmd !== CMD.IR_UPLOAD && msg.cmd !== CMD.SNAPTONE_UPLOAD) return;
    const slot = readU32(d, 0);
    const name = readName(d, 8, NAME_FIELD);
    const list = msg.cmd === CMD.IR_UPLOAD ? this.irNames : this.snapToneNames;
    if (list[slot]) list[slot] = { name, empty: false };
    this.uploads.push({ cmd: msg.cmd, slot, name, data: d.slice(8 + NAME_FIELD) });
    return result(msg.cmd);
  }

  // ----------------------------------------------------------------------------------------- pedal-side actions

  /** Turn a knob on the pedal: the param report the pedal sends. */
  async turnKnob(block, param, value) {
    const fxid = parsePrst(this.editBuffer).blocks[block].fxid;
    this.editBuffer = applyPatchEdits(this.editBuffer, { blocks: { [block]: { params: { [param]: value } } } });
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, fxid, true);
    view.setFloat32(4, value, true);
    data[8] = block;
    data[9] = param;
    await this.#push(this.#record(CMD.PARAM, [...data]));
    await this.#edited();
  }

  /** Switch a module with its footswitch. */
  async switchBlock(block, on) {
    this.editBuffer = applyPatchEdits(this.editBuffer, { blocks: { [block]: { enabled: on } } });
    await this.#push(this.#record(CMD.BLOCK_ON, [block, on ? 1 : 0, 0, 0]));
    await this.#edited();
  }

  /** Select a preset on the pedal: the edited flag and the new edit buffer. */
  async selectOnPedal(slot) {
    this.#select(slot);
    await this.#push(this.#record(CMD.PATCH_STATE, u32le(0)));
    await this.#push(this.#patch(this.editBuffer));
  }

  /** Push a NAM list, as an unsolicited pedal-side list change (tests). */
  async reportNamNames() {
    await this.#answer(CMD.NAM_NAMES, []);
  }

  /** Save the edit buffer into `slot` on the pedal: the saved event and the name list. */
  async saveOnPedal(slot = this.activeSlot) {
    this.presets[slot] = applyPatchEdits(this.editBuffer, { slot });
    this.modified = false;
    const name = parsePrst(this.presets[slot]).name;
    await this.#push(this.#record(CMD.PATCH_STATE, u32le(0)));
    await this.#push(encodeMessage({ p: P.EVENT, t: 0x10, cmd: CMD.SAVED, payload: [...u32le(slot), ...nameField(name), 0, 0, 0, 0] }));
    await this.#answer(CMD.PRESET_NAMES, []);
  }

  /** Stored preset with the import's length field, as Suite would send it (tests). */
  importFile(slot) {
    return forImport(this.presets[slot], slot);
  }
}
