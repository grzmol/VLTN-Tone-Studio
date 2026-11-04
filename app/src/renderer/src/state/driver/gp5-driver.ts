// DeviceDriver for the GP-5 family (GP-5, GP-50): a thin adapter over Gp5Session, plus the simulator (MockGp5).
import { Gp5Session, type DecodedMessage, type ExpEdit, type GlobalsRecord, type Gp5FamilyKey, type Gp5Transport } from "@/gp5/lib/session.mjs";
import { MockGp5 } from "@/gp5/lib/mock-device.mjs";
import { nativeGp50Bank } from "@/gp5/lib/mock-bank.mjs";
import { connectWebMidi } from "@/gp5/lib/transport-webmidi.mjs";
import { rebuildPrst } from "@/gp5/lib/prst.mjs";
import { PATCH_SETTINGS, globalsFor, patchSettingByRecord } from "@/gp5/lib/protocol.mjs";
import { profileFor, type DeviceKey } from "@shared/devices";
import type { BackupEntry, DeviceFeature, GlobalName, GlobalSpec, Gp5GlobalName, SlotName } from "../device-types";
import type { DeviceDriver, DriverEvent, DriverOptions, GlobalsSnapshot, ProgressOptions, SyncSnapshot } from "./types";

type PatchSettingField = Extract<DriverEvent, { type: "patchSetting" }>["field"];
/** PATCH_SETTINGS is keyed by exactly the event's fields (volume, bpm and the EXP fields). */
const isPatchSettingField = (f: string | undefined): f is PatchSettingField => f !== undefined && Object.hasOwn(PATCH_SETTINGS, f);

/** Simulated pedal's user SnapTone (slots 50..57) and IR names, as on the pedal in design/screens/tones.md. */
const MOCK_SNAPTONES = [...new Array<string>(50).fill(""), "GP1000", "ALEXI-1", "ALEXI-2", "GP1000-YT", "PNTR-CWBYS", "PNTR-BRKEN", "PNTR-TGSTK", "Walk"];
const MOCK_USER_IRS = ["A7X-WTF", "A7X-CITY", "V30-4X12-A", "V30-4X12-B"];

/** What the GP-50 adds over the GP-5 (static RE of Valeton Suite 2.1.0); the store gates the experimental ones. */
const GP50_FEATURES: readonly DeviceFeature[] = Object.freeze([
  "modified",
  "exportPreset",
  "exp",
  "liveBpm",
  "sync",
  "liveFootswitches",
  "liveOrder",
  "deletePreset",
  "copyPreset",
  "movePreset",
] satisfies DeviceFeature[]);

const loadFixtures = async (urls: Record<string, string>): Promise<Uint8Array[]> =>
  Promise.all(Object.keys(urls).sort().map(async (f) => new Uint8Array(await (await fetch(urls[f])).arrayBuffer())));

/**
 * Mock presets: the bundled 100-slot GP-5 backup for a simulated GP-5; for a GP-50 the native bank (MIT GP-50 fixtures
 * as seeds, generated factory-style presets, empty user slots 55..99).
 */
async function loadMockPresets(device: Gp5FamilyKey): Promise<Uint8Array[]> {
  if (device === "gp50") {
    const seeds = import.meta.glob(["../../gp5/fixtures/gp50-*.prst", "!**/gp50-blank.prst"], { query: "?url", import: "default", eager: true }) as Record<string, string>;
    return nativeGp50Bank(await loadFixtures(seeds));
  }
  return loadFixtures(import.meta.glob("../../gp5/fixtures/backup/*.prst", { query: "?url", import: "default", eager: true }) as Record<string, string>);
}

const toSlotNames = (list: { slot: number; name: string }[]): SlotName[] => list.map((n) => ({ slot: n.slot, name: n.name }));
const toTable = (list: { index: number; name: string; kind: SlotName["kind"] }[]): SlotName[] => list.map((x) => ({ slot: x.index, name: x.name, kind: x.kind }));

function toGlobals(raw: GlobalsRecord): GlobalsSnapshot {
  const { records, firmware, ...values } = raw;
  return { values, records, ...(firmware ? { firmware } : {}) };
}

/** Settings table of the connected model; empty before the model is known. */
const specsOf = (device: Gp5FamilyKey | null): Record<string, GlobalSpec> => (device ? (globalsFor(device) as Record<string, GlobalSpec>) : {});

/** Pedal traffic nobody waited for → driver events (knob turns and switches edit the live preset, the rest resyncs). */
function toDriverEvents(msg: DecodedMessage, device: Gp5FamilyKey | null): DriverEvent[] {
  switch (msg.type) {
    case "slot":
    case "presetChanged":
    case "model":
      return [{ type: "resync" }];
    case "param":
      return msg.block !== undefined && msg.index !== undefined && msg.value !== undefined ? [{ type: "param", block: msg.block, index: msg.index, value: msg.value }] : [];
    case "block":
      return msg.block !== undefined && msg.enabled !== undefined ? [{ type: "block", block: msg.block, enabled: msg.enabled }] : [];
    case "listChanged":
      return msg.list ? [{ type: "listChanged", list: msg.list }] : [];
    case "patchSetting":
      return (msg.settings ?? []).flatMap(({ record, value }): DriverEvent[] => {
        const field: string | undefined = patchSettingByRecord(record)?.[0];
        return isPatchSettingField(field) ? [{ type: "patchSetting", field, value }] : [];
      });
    case "footswitch":
      return msg.fs1 && msg.fs2 ? [{ type: "footswitches", fs1: msg.fs1, fs2: msg.fs2 }] : [];
    case "order":
      return msg.order ? [{ type: "order", order: msg.order }] : [];
    case "global": {
      const spec = Object.values(specsOf(device)).find((g) => g.addr[0] === msg.a && g.addr[1] === msg.b);
      return spec && msg.value !== undefined ? [{ type: "global", name: spec.name, value: msg.value }] : [];
    }
    default:
      return [];
  }
}

export class Gp5Driver implements DeviceDriver {
  readonly #session: Gp5Session;
  readonly #listeners = new Set<(e: DriverEvent) => void>();

  private constructor(
    transport: Gp5Transport,
    readonly portName: string,
    opts: Pick<DriverOptions, "log">,
    /** The simulator behind a mock connection (tests and diagnostics), else null */
    readonly mock: MockGp5 | null = null,
  ) {
    this.#session = new Gp5Session(transport, { log: opts.log });
    this.#session.addEventListener("message", (ev) => {
      for (const e of toDriverEvents((ev as Event & { message: DecodedMessage }).message, this.#session.device)) this.#emit(e);
    });
  }

  /** Open the pedal's MIDI ports matching `port` (`access`: an already granted MIDIAccess). */
  static async open(access: MIDIAccess, port: string | RegExp, opts: DriverOptions): Promise<Gp5Driver> {
    const transport = await connectWebMidi({ access, port, onDisconnect: opts.onDisconnect });
    return new Gp5Driver(transport, transport.name, opts);
  }

  /** Connect a simulated `device` (GP-5: the bundled backup; GP-50: the native bank). */
  static async simulate(device: Gp5FamilyKey, opts: DriverOptions): Promise<Gp5Driver> {
    const mock = new MockGp5({ presets: await loadMockPresets(device), latencyMs: 2, snapTones: MOCK_SNAPTONES, userIRs: MOCK_USER_IRS, notifyListChanges: true });
    return new Gp5Driver(mock.transport(), `${profileFor(device).name} (simulated)`, opts, mock);
  }

  #emit(e: DriverEvent) {
    for (const l of this.#listeners) l(e);
  }

  get device(): DeviceKey | null {
    return this.#session.device;
  }

  get features(): readonly DeviceFeature[] {
    return this.#session.device === "gp50" ? GP50_FEATURES : [];
  }

  identify(): Promise<DeviceKey> {
    return this.#session.identify();
  }

  async sync(): Promise<SyncSnapshot> {
    const snap = await this.#session.syncState();
    return {
      device: snap.device,
      names: toSlotNames(snap.names),
      slot: snap.slot,
      prst: snap.prst,
      globals: snap.globals ? toGlobals(snap.globals) : null,
      modified: snap.modified,
    };
  }

  async readNames(): Promise<SlotName[]> {
    return toSlotNames(await this.#session.readPresetNames());
  }

  async readActive(names: readonly SlotName[]): Promise<{ slot: number; prst: Uint8Array }> {
    const slot = await this.#session.readCurrentSlot();
    return { slot, prst: await this.readEditBuffer(names[slot]?.name ?? "") };
  }

  async readEditBuffer(name: string): Promise<Uint8Array> {
    const body = await this.#session.readCurrentBody();
    return rebuildPrst(name, body, await this.#session.identify());
  }

  async select(slot: number): Promise<void> {
    await this.#session.selectPreset(slot);
  }

  /** Re-selecting the active slot does not reload memory on these pedals: hop to the next slot and back. */
  async reloadSlot(slot: number): Promise<void> {
    await this.#session.selectPreset((slot + 1) % profileFor(await this.identify()).slotCount);
    await this.#session.selectPreset(slot);
  }

  readPreset(slot: number, names: readonly SlotName[]): Promise<Uint8Array> {
    return this.#session.readPreset(slot, { names: [...names] });
  }

  async writePreset(slot: number, prst: Uint8Array, opts: ProgressOptions & { attempts?: number } = {}): Promise<void> {
    await this.#session.writePreset(slot, prst, { confirm: true, verify: true, attempts: opts.attempts, onProgress: opts.onProgress });
  }

  async rename(slot: number, name: string): Promise<void> {
    await this.#session.renamePreset(slot, name, { confirm: true });
  }

  async backupAll(opts: ProgressOptions = {}): Promise<BackupEntry[]> {
    const entries = await this.#session.backupAll({ onProgress: opts.onProgress });
    return entries.map((e) => ({ slot: e.slot, name: e.name, prst: e.prst }));
  }

  async setParam(block: number, index: number, value: number): Promise<void> {
    await this.#session.setParam(block, index, value);
  }

  async setBlockEnabled(block: number, on: boolean): Promise<void> {
    await this.#session.setBlockEnabled(block, on);
  }

  async setModel(block: number, fxid: number): Promise<void> {
    await this.#session.setModel(block, fxid);
  }

  async setPatchVolume(volume: number): Promise<void> {
    await this.#session.setPatchVolume(volume);
  }

  async readGlobals(): Promise<GlobalsSnapshot> {
    return toGlobals(await this.#session.readGlobals());
  }

  /** Range of `name` in the connected model's settings table (the GP-5 and GP-50 tables differ). */
  clampGlobal(name: GlobalName, value: number): number {
    const g = specsOf(this.#session.device)[name];
    if (!g) throw new RangeError(`The ${this.portName} has no setting ${name}`);
    return Math.max(g.min, Math.min(g.max, Math.round(value)));
  }

  async setGlobal(name: GlobalName, value: number): Promise<void> {
    if (!Object.hasOwn(specsOf(this.#session.device), name)) throw new RangeError(`The ${this.portName} has no setting ${name}`);
    await this.#session.setGlobal(name as Gp5GlobalName, value);
  }

  async readSnapTones(): Promise<SlotName[]> {
    return toTable(await this.#session.readSnapTones());
  }

  async readUserIRs(): Promise<SlotName[]> {
    return toTable(await this.#session.readUserIRs());
  }

  async uploadSnapTone(slot: number, name: string, file: Uint8Array, opts: ProgressOptions = {}): Promise<string> {
    return (await this.#session.uploadSnapTone(slot, name, file, { confirm: true, onProgress: opts.onProgress })).name;
  }

  async uploadUserIr(slot: number, name: string, data: Uint8Array, opts: ProgressOptions = {}): Promise<string> {
    return (await this.#session.uploadUserIr(slot, name, data, { confirm: true, onProgress: opts.onProgress })).name;
  }

  subscribe(listener: (event: DriverEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): Promise<void> {
    this.#listeners.clear();
    return this.#session.close();
  }

  // GP-50 features (the session rejects them with Gp5Error "unsafe" on a GP-5)

  readModified(): Promise<boolean> {
    return this.#session.readModified();
  }

  exportPreset(slot: number): Promise<Uint8Array> {
    return this.#session.exportPreset(slot);
  }

  async setBpm(bpm: number): Promise<void> {
    await this.#session.setBpm(bpm);
  }

  async setExp(exp: ExpEdit): Promise<void> {
    await this.#session.setExp(exp);
  }

  async setSync(block: number, syncIndex: number, on: boolean, name: string): Promise<Uint8Array> {
    const body = await this.#session.setSync(block, syncIndex, on);
    return rebuildPrst(name, body, await this.#session.identify());
  }

  async setFootswitches(fs1: number[], fs2: number[]): Promise<void> {
    await this.#session.setFootswitchMasks(fs1, fs2);
  }

  async setOrder(order: number[]): Promise<void> {
    await this.#session.setOrder(order);
  }

  async deletePreset(slot: number): Promise<void> {
    await this.#session.deletePreset(slot, { confirm: true });
  }

  async copyPreset(from: number, to: number): Promise<void> {
    await this.#session.pastePreset(to, from, { confirm: true });
  }

  async movePreset(from: number, to: number): Promise<void> {
    await this.#session.movePreset(from, to, { confirm: true });
  }
}
