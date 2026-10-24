// DeviceDriver for the GP-150 and GP-180: an adapter over Gp150Session, plus the simulator (MockGp150). Facts: the
// GP-180 captures of majabojarska/Valeton-GP180-Rev-Eng (one protocol for both). Safety: the session serializes requests,
// waits for the pedal's ACK of every message, verifies full writes by reading back, and never builds the factory reset.
import { Gp150Session, type Gp150Event, type Gp150Timing, type Gp150Transport, type ListEntry } from "@/gp150/lib/session.mjs";
import { MockGp150, type MockGp150Options } from "@/gp150/lib/mock-device.mjs";
import { CMD, GLOBALS, GLOBAL_EQ } from "@/gp150/lib/protocol.mjs";
import { applyPatchEdits, parsePrst } from "@/gp150/lib/prst.mjs";
import { connectWebMidi } from "@/gp5/lib/transport-webmidi.mjs";
import { deviceForPortName, profileFor, type DeviceKey } from "@shared/devices";
import type { BackupEntry, DeviceFeature, GlobalEq, GlobalName, Globals, SlotName } from "../device-types";
import { GP200_EQ_DEFAULTS, clampGp200Eq } from "./gp200-globals";
import { appEqValues, clampGp150Global, gp150EqIndex, gp150GlobalRecords, gp150GlobalSpec, type Gp150GlobalName, type Gp150Globals } from "./gp150-globals";
import type { DeviceDriver, DriverEvent, DriverOptions, GlobalsSnapshot, ProgressOptions, SyncSnapshot } from "./types";
import type { BleMidiConnection } from "@/bluetooth/connection";

/** Slot tables and tempo range, the same on the GP-150 and GP-180. */
const PROFILE = profileFor("gp150");
/** The SnapTone upload file the GP-150 takes: the GP-5 family's 2696-byte VTSI file. */
const SNAPTONE_FILE_BYTES = 2696;
/** int32 samples the IR upload holds. */
const USER_IR_MAX_SAMPLES = 2048;

/** Pacing of the simulator: no frame gaps, short timeouts. */
export const FAST_SIMULATOR = {
  timing: { frameGapMs: 0, helloTimeoutMs: 300, ackTimeoutMs: 300, replyTimeoutMs: 1000, uploadTimeoutMs: 2000 },
  mock: { latencyMs: 0 },
} as const satisfies { timing: Partial<Gp150Timing>; mock: MockGp150Options };

/** Settings snapshot of a GP-150: values keyed by the GP-150 setting names (gp150-globals.ts). */
export interface Gp150GlobalsSnapshot extends GlobalsSnapshot {
  values: Globals & Gp150Globals;
}

/** int32 LE sample block → samples. */
function irSamples(data: Uint8Array): Int32Array {
  if (data.byteLength === 0 || data.byteLength % 4 !== 0 || data.byteLength > USER_IR_MAX_SAMPLES * 4)
    throw new RangeError(`A GP-150 User IR is up to ${USER_IR_MAX_SAMPLES} samples of 4 bytes; got ${data.byteLength} bytes.`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Int32Array.from({ length: data.byteLength / 4 }, (_, i) => view.getInt32(i * 4, true));
}

/** SnapTone list entries (pedal slots 1-100) → app slots 0-99: 0-49 factory, 50-99 user. */
const snapToneTable = (list: ListEntry[]): SlotName[] =>
  list.map((e) => ({ slot: e.slot - 1, name: e.name, kind: e.empty ? "empty" : e.slot - 1 < PROFILE.snapTone.userRange[0] ? "factory" : "user" }));
const irTable = (list: ListEntry[]): SlotName[] => list.map((e) => ({ slot: e.slot, name: e.name, kind: e.empty ? "empty" : "user" }));

export class Gp150Driver implements DeviceDriver {
  /** "exportPreset": mode-1 reads never select; "liveBpm": the 0x3020 settings record; "globalEq": the 0x2010 record; "modified": 0x3070. */
  readonly features: readonly DeviceFeature[] = ["exportPreset", "liveBpm", "globalEq", "modified"];
  readonly #session: Gp150Session;
  readonly #listeners = new Set<(e: DriverEvent) => void>();
  /** The pedal's 32 Global EQ values, as last read or set (null until read). */
  #eq: number[] | null = null;
  /** The edit buffer as last read, with the live edits sent since (models for setParam, the settings record). */
  #edit: Uint8Array | null = null;
  /** Counts the times another patch or model took over the edit buffer: a read from before is stale. */
  #buffer = 0;
  #device: DeviceKey | null = null;
  /** The model on this port: the GP-150 and GP-180 answer alike, so their port names tell them apart. */
  readonly #model: DeviceKey;

  private constructor(
    transport: Gp150Transport,
    readonly portName: string,
    opts: Pick<DriverOptions, "log"> & { timing?: Partial<Gp150Timing> },
    /** The simulator behind a mock connection (tests and diagnostics), else null */
    readonly mock: MockGp150 | null = null,
    model?: DeviceKey,
  ) {
    const named = deviceForPortName(portName);
    this.#model = model ?? (named && profileFor(named).family === "gp150" ? named : "gp150");
    this.#session = new Gp150Session(transport, { log: opts.log, timing: opts.timing });
    this.#session.addEventListener("message", (ev) => {
      for (const e of this.#toDriverEvents((ev as Event & { message: Gp150Event }).message)) this.#emit(e);
    });
  }

  /** Open the pedal's MIDI ports matching `port` (`access`: an already granted MIDIAccess). */
  static async open(access: MIDIAccess, port: string | RegExp, opts: DriverOptions & { timing?: Partial<Gp150Timing> }): Promise<Gp150Driver> {
    const transport = await connectWebMidi({ access, port, onDisconnect: opts.onDisconnect });
    return new Gp150Driver(transport, transport.name, opts);
  }

  /** Experimental: only sync success establishes that this firmware exposes editor SysEx over BLE-MIDI. */
  static fromBluetooth(connection: BleMidiConnection, opts: DriverOptions): Gp150Driver {
    let unsubscribe = () => {};
    const offDisconnect = connection.onDisconnect(opts.onDisconnect ?? (() => {}));
    const transport: Gp150Transport = {
      name: `${connection.name} (Bluetooth)`,
      send: bytes => connection.send(bytes, performance.now(), true),
      onMessage: callback => { unsubscribe(); unsubscribe = connection.subscribe(callback); },
      close: () => { unsubscribe(); offDisconnect(); connection.close(); },
    };
    return new Gp150Driver(transport, transport.name, { ...opts, timing: { frameGapMs: 15, helloTimeoutMs: 5000, ackTimeoutMs: 8000, replyTimeoutMs: 12000, uploadTimeoutMs: 30000, resends: 1 } }, null, /GP-?150(?!\d)/i.test(connection.name) ? 'gp150' : 'gp180');
  }

  /** Connect a simulated GP-150 or GP-180, paced like FAST_SIMULATOR unless `timing` / `mock` say otherwise. */
  static async simulate(device: DeviceKey, opts: DriverOptions & { timing?: Partial<Gp150Timing>; mock?: MockGp150Options }): Promise<Gp150Driver> {
    const { name } = profileFor(device);
    const mock = new MockGp150({ ...FAST_SIMULATOR.mock, ...opts.mock, name });
    return new Gp150Driver(mock.transport(), `${name} (simulated)`, { ...opts, timing: { ...FAST_SIMULATOR.timing, ...opts.timing } }, mock, device);
  }

  #emit(e: DriverEvent) {
    for (const l of this.#listeners) l(e);
  }

  /** Pedal traffic nobody waited for → driver events. */
  #toDriverEvents(msg: Gp150Event): DriverEvent[] {
    switch (msg.kind) {
      case "patch":
      case "model":
        this.#forget();
        return [{ type: "resync" }];
      case "patchRecord":
        return [{ type: "resync" }];
      case "param":
        if (this.#edit) this.#edit = applyPatchEdits(this.#edit, { blocks: { [msg.block]: { params: { [msg.param]: msg.value } } } });
        return [{ type: "param", block: msg.block, index: msg.param, value: msg.value }];
      case "block":
        if (this.#edit) this.#edit = applyPatchEdits(this.#edit, { blocks: { [msg.block]: { enabled: msg.enabled } } });
        return [{ type: "block", block: msg.block, enabled: msg.enabled }];
      case "chain":
        if (this.#edit) this.#edit = applyPatchEdits(this.#edit, { chain: msg.chain });
        return [{ type: "order", order: msg.chain }];
      case "patchSettings":
        if (this.#edit) this.#edit = applyPatchEdits(this.#edit, { tempo: msg.tempo, volume: msg.volume, namMode: msg.namMode });
        return [
          { type: "patchSetting", field: "volume", value: msg.volume },
          { type: "patchSetting", field: "bpm", value: msg.tempo },
        ];
      case "names":
      case "saved":
        return [{ type: "listChanged", list: "presets" }];
      case "listChanged":
        return [{ type: "listChanged", list: msg.cmd === CMD.IR_NAMES ? "irs" : "snaptones" }];
      case "globals":
        return Object.entries(msg.values).map(([name, value]) => ({ type: "global", name: name as GlobalName, value: value as number }));
      case "globalEq": {
        this.#eq = msg.values;
        const app = appEqValues(msg.values);
        return [
          { type: "globalEq", values: Object.fromEntries(app.map((v, i) => [i, v])), all: true },
          { type: "global", name: "globalEq", value: msg.values[GLOBAL_EQ.ON] },
        ];
      }
      default:
        return [];
    }
  }

  /** Another patch or model takes over the edit buffer: forget it; reads already under way are stale. */
  #forget() {
    this.#edit = null;
    this.#buffer++;
  }

  async #readBuffer(): Promise<{ slot: number; prst: Uint8Array }> {
    const buffer = this.#buffer;
    const read = await this.#session.readEditBuffer();
    if (buffer === this.#buffer) this.#edit = read.prst;
    return read;
  }

  #globalEq(): GlobalEq {
    return this.#eq ? { values: appEqValues(this.#eq), read: true } : { values: GP200_EQ_DEFAULTS, read: false };
  }

  #snapshot(firmware: string | null, values: Gp150Globals): Gp150GlobalsSnapshot {
    return { values: { ...values }, records: gp150GlobalRecords(values), ...(firmware ? { firmware } : {}), eq: this.#globalEq() };
  }

  get device(): DeviceKey | null {
    return this.#device;
  }

  /** Hello, state and settings; the model comes from the port name (GP-150 unless it names a GP-180). */
  async identify(): Promise<DeviceKey> {
    if (!this.#device) {
      const info = await this.#session.connect();
      this.#eq = info.eq;
      this.#device = this.#model;
    }
    return this.#model;
  }

  /** Hello, the name list, the edit buffer and the settings: four requests. */
  async sync(opts: ProgressOptions = {}): Promise<SyncSnapshot> {
    const device = await this.identify();
    opts.onProgress?.(1, 4);
    const names = await this.readNames();
    opts.onProgress?.(2, 4);
    const { slot, prst } = await this.#readBuffer();
    opts.onProgress?.(3, 4);
    const g = await this.readGlobals();
    opts.onProgress?.(4, 4);
    return { device, names, slot, prst, globals: g, modified: this.#session.modified };
  }

  async readModified(): Promise<boolean> {
    return this.#session.modified;
  }

  /** One request: the pedal sends all 200 names. */
  async readNames(): Promise<SlotName[]> {
    return (await this.#session.readPresetNames()).map((n) => ({ slot: n.slot, name: n.name }));
  }

  /** The edit buffer names its slot and carries its own (live) name, so `names` is not needed. */
  async readActive(_names: readonly SlotName[]): Promise<{ slot: number; prst: Uint8Array }> {
    return this.#readBuffer();
  }

  async readEditBuffer(_name: string): Promise<Uint8Array> {
    return (await this.#readBuffer()).prst;
  }

  /** Select (mode-0 read): the pedal answers with the preset, which becomes the edit buffer. */
  async select(slot: number): Promise<void> {
    this.#forget();
    const buffer = this.#buffer;
    const prst = await this.#session.selectPreset(slot);
    if (buffer === this.#buffer) this.#edit = prst;
  }

  /** Selecting the active slot again loads it from memory. */
  async reloadSlot(slot: number): Promise<void> {
    await this.select(slot);
  }

  /** Stored read: nothing is selected. */
  async readPreset(slot: number, _names?: readonly SlotName[]): Promise<Uint8Array> {
    return this.#session.readPreset(slot);
  }

  exportPreset(slot: number): Promise<Uint8Array> {
    return this.readPreset(slot);
  }

  /** The import Suite does, read back, then `slot` is selected. */
  async writePreset(slot: number, prst: Uint8Array, opts: ProgressOptions & { attempts?: number } = {}): Promise<void> {
    this.#forget();
    await this.#session.writePreset(slot, prst, { confirm: true, verify: true, onProgress: opts.onProgress });
  }

  /** Read, rename, full verified write. */
  async rename(slot: number, name: string): Promise<void> {
    await this.#session.renamePreset(slot, name, { confirm: true });
  }

  async backupAll(opts: ProgressOptions = {}): Promise<BackupEntry[]> {
    return this.#session.backupAll({ onProgress: opts.onProgress });
  }

  /** `block`: module order (PRE WAH DST NS AMP NR CAB EQ MOD DLY RVB VOL); `index`: the param id (0..14). */
  async setParam(block: number, index: number, value: number): Promise<void> {
    const buffer = this.#buffer;
    if (!this.#edit) await this.#readBuffer();
    if (buffer !== this.#buffer || !this.#edit) return;
    const fxid = parsePrst(this.#edit).blocks[block]?.fxid;
    if (fxid === undefined) throw new RangeError(`The GP-150 has no module ${block}`);
    this.#edit = applyPatchEdits(this.#edit, { blocks: { [block]: { params: { [index]: value } } } });
    await this.#session.setParam(block, index, fxid, value);
  }

  async setBlockEnabled(block: number, on: boolean): Promise<void> {
    if (this.#edit) this.#edit = applyPatchEdits(this.#edit, { blocks: { [block]: { enabled: on } } });
    await this.#session.setBlockEnabled(block, on);
  }

  /** The pedal loads the model's defaults; callers send the new model's params (or re-read the edit buffer). */
  async setModel(block: number, fxid: number): Promise<void> {
    await this.#session.setModel(block, fxid);
    if (this.#edit) this.#edit = applyPatchEdits(this.#edit, { blocks: { [block]: { fxid: fxid >>> 0 } } });
  }

  /** Volume and tempo go out as the whole 0x3020 settings record of the edit buffer. */
  async #setSettings(edits: { volume?: number; tempo?: number }): Promise<void> {
    if (!this.#edit) await this.#readBuffer();
    if (!this.#edit) return;
    this.#edit = applyPatchEdits(this.#edit, edits);
    await this.#session.setPatchSettings(this.#edit, {});
  }

  async setPatchVolume(volume: number): Promise<void> {
    await this.#setSettings({ volume: Math.max(0, Math.min(100, Math.round(volume))) });
  }

  async setBpm(bpm: number): Promise<void> {
    const { min, max } = PROFILE.tempo;
    await this.#setSettings({ tempo: Math.max(min, Math.min(max, Math.round(bpm))) });
  }

  /** The 0x2000 reply: firmware, settings records, Global EQ. */
  async readGlobals(): Promise<Gp150GlobalsSnapshot> {
    const g = await this.#session.readGlobals();
    if (g.eq) this.#eq = g.eq;
    return this.#snapshot(g.firmware, g.values);
  }

  clampGlobal(name: GlobalName | Gp150GlobalName, value: number): number {
    return clampGp150Global(name, value);
  }

  /** One setting: its record as the pedal last reported it, with the value changed (globalEq: the EQ record's switch). */
  async setGlobal(name: GlobalName | Gp150GlobalName, value: number): Promise<void> {
    const spec = gp150GlobalSpec(name);
    const v = clampGp150Global(spec.name, value);
    await this.#session.setGlobal(spec.name, v, GLOBALS[spec.name]);
    if (spec.name === "globalEq" && this.#eq) this.#eq = this.#eq.map((x, i) => (i === GLOBAL_EQ.ON ? v : x));
  }

  /** Global EQ value `index` (the GP-200's order, its ranges): the whole record goes out with the value changed. */
  async setGlobalEq(index: number, value: number): Promise<void> {
    const v = clampGp200Eq(index, value);
    if (!this.#eq) await this.readGlobals();
    if (!this.#eq) throw new RangeError("The GP-150 didn't report its Global EQ");
    const values = [...this.#eq];
    values[gp150EqIndex(index)] = v;
    this.#eq = values;
    await this.#session.setGlobalEq(values);
  }

  /** SnapTone slots 0-99 (the pedal's 1-100). */
  async readSnapTones(): Promise<SlotName[]> {
    return snapToneTable(await this.#session.readSnapToneNames());
  }

  async readUserIRs(): Promise<SlotName[]> {
    return irTable(await this.#session.readIrNames());
  }

  /** `file`: the 2696-byte SnapTone upload file of the GP-5 family (the GP-150 takes the same VTSI file). */
  async uploadSnapTone(slot: number, name: string, file: Uint8Array, opts: ProgressOptions = {}): Promise<string> {
    if (file.byteLength !== SNAPTONE_FILE_BYTES) throw new RangeError(`A GP-150 SnapTone is the ${SNAPTONE_FILE_BYTES}-byte SnapTone file; got ${file.byteLength} bytes.`);
    return (await this.#session.uploadSnapTone(slot + 1, name, file, { confirm: true, onProgress: opts.onProgress })).name;
  }

  /** `data`: 24-bit samples at 44.1 kHz as int32 LE, up to 2048 (Suite sends 683). */
  async uploadUserIr(slot: number, name: string, data: Uint8Array, opts: ProgressOptions = {}): Promise<string> {
    return (await this.#session.uploadUserIr(slot, name, irSamples(data), { confirm: true, onProgress: opts.onProgress })).name;
  }

  subscribe(listener: (event: DriverEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): Promise<void> {
    this.#listeners.clear();
    return this.#session.close();
  }
}
