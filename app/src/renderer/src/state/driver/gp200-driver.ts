// DeviceDriver for the GP-200 family (GP-200 incl. R/X, GP-200LT, GP-200JR): an adapter over Gp200Session, plus the
// simulator (MockGp200). Safety (GP-200 editor 1.8.0 RE): selects go out as 0x1008 only (never CC/PC); the session paces
// every frame, never waits for ACKs (there are none), verifies full writes by reading back, moves off the active slot
// before writing it, refuses the dangerous frames, and sends nothing at all once the pedal reports update mode.
import { Gp200Error, Gp200Session, type Gp200Event, type Gp200FamilyKey, type Gp200Timing, type Gp200Transport, type NameEntry, type UploadResult } from "@/gp200/lib/session.mjs";
import { MockGp200, type MockGp200Options } from "@/gp200/lib/mock-device.mjs";
import { BUILT_IN_CATALOG } from "@/gp200/lib/catalog-data.mjs";
import { GLOBAL_EQ_BANDS, PATCH_SETTING, type DecodedMessage } from "@/gp200/lib/protocol.mjs";
import { buildPrst, imagesMatch, parsePatch } from "@/gp200/lib/prst.mjs";
import { connectWebMidi } from "@/gp5/lib/transport-webmidi.mjs";
import { profileFor, type DeviceKey } from "@shared/devices";
import type { BackupEntry, ConnectionError, DeviceFeature, GlobalEq, GlobalName, Globals, SlotName } from "../device-types";
import { GP200_EQ_DEFAULTS, clampGp200Eq, clampGp200Global, gp200GlobalRecords, gp200GlobalSpec, type Gp200GlobalName, type Gp200Globals } from "./gp200-globals";
import type { DeviceDriver, DriverEvent, DriverOptions, GlobalsSnapshot, ProgressOptions, SyncSnapshot } from "./types";

/** GP-5 family SnapTone upload file (Suite's cut-down clone): too short for the GP-200, which keeps 1024 IR taps. */
const GP5_SNAPTONE_FILE_BYTES = 2696;
/** User IR data the driver takes: int32 LE samples, at most this many (the pedal stores 1024). */
const USER_IR_MAX_SAMPLES = profileFor("gp200").userIr.samples;
/** How long a select we sent may still come back as the pedal's "patch changed" echo. */
const ECHO_WINDOW_MS = 1000;

/**
 * Pacing of the simulator, scaled down on both sides together (the session's waits and MockGp200's gap and deaf-window
 * checks), so a 256-slot sync takes well under a second and the reads that verify a write don't land in a deaf window.
 */
export const FAST_SIMULATOR = {
  timing: { frameGapMs: 1, multiChunkPauseMs: 20, identityGapMs: 5, selectSettleMs: 2, replyTimeoutMs: 300, globalsPushMs: 300, uploadTimeoutMs: 2000, saveTimeoutMs: 500 },
  mock: { latencyMs: 0, minGapMs: 0, deafMs: 0 },
} as const satisfies { timing: Partial<Gp200Timing>; mock: Omit<MockGp200Options, "type"> };

/** Settings snapshot of a GP-200: values keyed by the GP-200 setting names (gp200-globals.ts). */
export interface Gp200GlobalsSnapshot extends GlobalsSnapshot {
  values: Globals & Gp200Globals;
}

/** The pedal answered in firmware update mode. Shaped like a ConnectionError; the session sends nothing more. */
export class Gp200UpdaterError extends Error implements ConnectionError {
  readonly code = "bootloader" as const;
  constructor() {
    super("The GP-200 is in firmware update mode. Finish or restart the update with Valeton's updater, then reconnect.");
    this.name = "Gp200UpdaterError";
  }
}

function toGlobals(values: Gp200Globals, firmware: string | null): Gp200GlobalsSnapshot {
  return { values: { ...values }, records: gp200GlobalRecords(values), ...(firmware ? { firmware } : {}) };
}

/** A name the pedal gives a SnapTone or User IR slot it holds nothing in ("", "User IR", "User IR 3", "SnapTone 3", "Empty"). */
const isDefaultSlotName = (name: string) => /^(|Empty|User IR( \d+)?|SnapTone( \d+)?)$/.test(name.trim());

/**
 * Name tables of the SnapTone and User IR slots. The pedal flags each slot: 0 = holds data, 1 = empty (the GP-5 and
 * GP-150 families use the same convention). Any other flag, or an "empty" slot with a name of its own, is "unknown":
 * never offered as empty, so it can't be overwritten without the Replace warning.
 */
export const gp200SlotKind = (e: Pick<NameEntry, "flag" | "name">): NonNullable<SlotName["kind"]> =>
  e.flag === 0 ? "user" : e.flag === 1 ? (isDefaultSlotName(e.name) ? "empty" : "unknown") : "unknown";
const toTable = (list: NameEntry[]): SlotName[] => list.map((e) => ({ slot: e.slot, name: e.name, kind: gp200SlotKind(e) }));

/** The GP-200's default slot names ("User IR 3", "SnapTone 3") for a table the pedal didn't list: contents unknown. */
const unlistedTable = (kind: "irs" | "snapTones"): SlotName[] => {
  const { userIr, snapTone } = profileFor("gp200");
  const [count, prefix] = kind === "irs" ? [userIr.slots, "User IR"] : [snapTone.slots, "SnapTone"];
  return Array.from({ length: count }, (_, slot) => ({ slot, name: `${prefix} ${slot + 1}`, kind: "unknown" }));
};

/** int32 LE sample block (the GP-5 family's User IR data layout, up to 1024 samples here) → samples. */
function irSamples(data: Uint8Array): Int32Array {
  if (data.byteLength === 0 || data.byteLength % 4 !== 0 || data.byteLength > USER_IR_MAX_SAMPLES * 4)
    throw new RangeError(`A GP-200 User IR is up to ${USER_IR_MAX_SAMPLES} samples of 4 bytes; got ${data.byteLength} bytes.`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Int32Array.from({ length: data.byteLength / 4 }, (_, i) => view.getInt32(i * 4, true));
}

export class Gp200Driver implements DeviceDriver {
  /**
   * "exportPreset": stored reads never select; "liveBpm": the patch tempo goes out as 0x0006; "globalEq": 0x1005;
   * "modified": the edit buffer differs from its slot (the pedal's 0x1011 report, or at connect the sync's own reads).
   */
  readonly features: readonly DeviceFeature[] = ["exportPreset", "liveBpm", "globalEq", "modified"];
  readonly #session: Gp200Session;
  readonly #listeners = new Set<(e: DriverEvent) => void>();
  /** Global EQ as the pedal reported it and as set here, over the editor's factory values (no request reads it). */
  #eq: GlobalEq = { values: GP200_EQ_DEFAULTS, read: false };
  /** Model (fxid) of each block in the edit buffer: the 0x0005 param record names it. null = read it again. */
  #fxids: readonly number[] | null = null;
  /** Counts the times another patch or model took over the edit buffer: a read from before is stale. */
  #buffer = 0;
  /** Echoes of our own selects and model changes still expected from the pedal: key → deadline (ms) */
  #echoes: readonly { key: string; until: number }[] = [];
  /**
   * Name tables the pedal didn't list (no reply at sync, or to the name read-back after an upload): default names,
   * contents "unknown", plus the slots uploaded since. Read from here; the pedal isn't asked again.
   */
  #unlisted: { irs: readonly SlotName[] | null; snapTones: readonly SlotName[] | null } = { irs: null, snapTones: null };

  private constructor(
    transport: Gp200Transport,
    readonly portName: string,
    opts: Pick<DriverOptions, "log"> & { timing?: Partial<Gp200Timing> },
    /** The simulator behind a mock connection (tests and diagnostics), else null */
    readonly mock: MockGp200 | null = null,
  ) {
    // Global EQ reports may ride in replies the session consumes (with the 0x1007 settings), so they are taken from the
    // log hook, which sees every decoded message.
    const log = (dir: string, bytes: Uint8Array, decoded?: unknown) => {
      if (dir === "rx") this.#takeEq(decoded);
      opts.log(dir, bytes, decoded);
    };
    this.#session = new Gp200Session(transport, { log, timing: opts.timing });
    this.#session.addEventListener("message", (ev) => {
      const e = this.#toDriverEvent((ev as Event & { message: Gp200Event }).message);
      if (e) this.#emit(e);
    });
  }

  /** Open the pedal's MIDI ports matching `port` (`access`: an already granted MIDIAccess). */
  static async open(access: MIDIAccess, port: string | RegExp, opts: DriverOptions & { timing?: Partial<Gp200Timing> }): Promise<Gp200Driver> {
    const transport = await connectWebMidi({ access, port, onDisconnect: opts.onDisconnect });
    return new Gp200Driver(transport, transport.name, opts);
  }

  /** Connect a simulated `device` with the simulator's generated bank, paced like FAST_SIMULATOR unless `timing` / `mock` say otherwise (fault injection for tests). */
  static async simulate(
    device: Gp200FamilyKey,
    opts: DriverOptions & { timing?: Partial<Gp200Timing>; mock?: Omit<MockGp200Options, "type"> },
  ): Promise<Gp200Driver> {
    // The generated bank loads its models with the built-in catalog's defaults, like the editor would.
    const mock = new MockGp200({ catalog: BUILT_IN_CATALOG, ...FAST_SIMULATOR.mock, ...opts.mock, type: device });
    return new Gp200Driver(mock.transport(), `${profileFor(device).name} (simulated)`, { ...opts, timing: { ...FAST_SIMULATOR.timing, ...opts.timing } }, mock);
  }

  #emit(e: DriverEvent) {
    for (const l of this.#listeners) l(e);
  }

  #expectEcho(key: string) {
    const now = Date.now();
    this.#echoes = [...this.#echoes.filter((x) => x.until > now), { key, until: now + ECHO_WINDOW_MS }];
  }

  /** True (and forgotten) when `key` is an echo of something we sent. */
  #isEcho(key: string): boolean {
    const now = Date.now();
    const live = this.#echoes.filter((x) => x.until > now);
    const i = live.findIndex((x) => x.key === key);
    this.#echoes = i < 0 ? live : live.filter((_, j) => j !== i);
    return i >= 0;
  }

  /** Pedal traffic nobody waited for → driver events. Our own select/model echoes are dropped. */
  #toDriverEvent(msg: Gp200Event): DriverEvent | null {
    switch (msg.kind) {
      case "patchChanged":
        if (this.#isEcho(`select:${msg.slot}`)) return null;
        this.#forget();
        return { type: "resync" };
      case "model":
        if (this.#isEcho(`model:${msg.block}:${msg.fxid}`)) return null;
        this.#forget();
        return { type: "resync" };
      case "chain":
        return { type: "resync" };
      case "param":
        return { type: "param", block: msg.block, index: msg.paramId, value: msg.value };
      case "blockEnabled":
        return { type: "block", block: msg.block, enabled: msg.enabled };
      case "patchSetting":
        if (msg.target === PATCH_SETTING.VOL) return { type: "patchSetting", field: "volume", value: msg.value };
        if (msg.target === PATCH_SETTING.TEMPO) return { type: "patchSetting", field: "bpm", value: msg.value };
        return null;
      default:
        return null;
    }
  }

  /** Global EQ values in a decoded message (0x1004 all, 0x1005 one): keep them and report them. */
  #takeEq(decoded: unknown) {
    const values: Record<number, number> = {};
    let all = false;
    for (const r of (decoded as Partial<DecodedMessage> | undefined)?.records ?? []) {
      if (r.kind === "globalEqAll" && r.values.length === GLOBAL_EQ_BANDS) {
        r.values.forEach((v, i) => (values[i] = v));
        all = true;
      } else if (r.kind === "globalEq" && r.index < GLOBAL_EQ_BANDS) values[r.index] = r.value;
    }
    if (!Object.keys(values).length) return;
    this.#eq = { values: this.#eq.values.map((v, i) => values[i] ?? v), read: this.#eq.read || all };
    this.#emit({ type: "globalEq", values, all });
  }

  /** Another patch or model takes over the edit buffer: forget its models; reads already under way are stale. */
  #forget() {
    this.#fxids = null;
    this.#buffer++;
  }

  /** Read the edit buffer and remember its models (for setParam), unless another patch took over meanwhile. */
  async #readBuffer(): Promise<{ slot: number; image: Uint8Array }> {
    const buffer = this.#buffer;
    const read = await this.#session.readEditBuffer();
    if (buffer === this.#buffer) this.#fxids = parsePatch(read.image).blocks.map((b) => b.fxid);
    return read;
  }

  get device(): DeviceKey | null {
    return this.#session.device;
  }

  /**
   * Connect FSM: the 0x2001 reply identifies the pedal; SOFTWARE_STATE goes out after it but is answered only in update
   * mode (USB captures). Then globals. Update mode → Gp200UpdaterError, and nothing more is sent.
   */
  async identify(): Promise<DeviceKey> {
    if (!this.#session.device) {
      try {
        await this.#session.connect();
      } catch (e) {
        throw e instanceof Gp200Error && e.code === "updater" ? new Gp200UpdaterError() : e;
      }
    }
    return this.#session.device as Gp200FamilyKey;
  }

  /**
   * The editor's sync: IR names, every slot (the GP-200 has no name table, so each is read: 256 reads, 255 on the
   * JR), style names, edit buffer, SnapTone names. `onProgress` counts those steps. A pedal that doesn't answer the
   * IR or SnapTone names still connects (the session skips them); those tables then read as unlisted (unlistedTable).
   */
  async sync(opts: ProgressOptions = {}): Promise<SyncSnapshot> {
    const device = await this.identify();
    const snap = await this.#session.sync({ onProgress: opts.onProgress });
    this.#unlisted = { irs: snap.irNames ? null : unlistedTable("irs"), snapTones: snap.snapToneNames ? null : unlistedTable("snapTones") };
    const image = snap.editBuffer.image;
    this.#fxids = parsePatch(image).blocks.map((b) => b.fxid);
    // The sync read the active slot too: an edit buffer that differs from it holds edits made before we connected.
    const stored = snap.presets.find((p) => p.slot === snap.editBuffer.slot)?.image;
    return {
      device,
      names: snap.presets.map((p) => ({ slot: p.slot, name: p.name })),
      slot: snap.editBuffer.slot,
      prst: buildPrst(image),
      globals: snap.globals ? { ...toGlobals(snap.globals, snap.firmware), eq: this.#eq } : null,
      modified: this.#session.dirty || (stored ? !imagesMatch(image, stored) : null),
    };
  }

  /** The pedal reports edits to its edit buffer (0x1011) and drops the flag when a patch is selected or saved. */
  async readModified(): Promise<boolean> {
    return this.#session.dirty;
  }

  /** Every slot is read for its name (about 3 s on the pedal). */
  async readNames(opts: ProgressOptions = {}): Promise<SlotName[]> {
    const names = await this.#session.readPresetNames({ onProgress: opts.onProgress });
    return names.map((n) => ({ slot: n.slot, name: n.name }));
  }

  /** The edit buffer carries its own (live) name, so `names` is not needed. */
  async readActive(_names: readonly SlotName[]): Promise<{ slot: number; prst: Uint8Array }> {
    const { slot, image } = await this.#readBuffer();
    return { slot, prst: buildPrst(image) };
  }

  /** The edit buffer carries its own (live) name, so `name` is not needed. */
  async readEditBuffer(_name: string): Promise<Uint8Array> {
    return buildPrst((await this.#readBuffer()).image);
  }

  /** 0x1008 {0, slot}; the pedal's echo of it is not reported as a pedal-side change. */
  async select(slot: number): Promise<void> {
    this.#expectEcho(`select:${slot}`);
    this.#forget();
    await this.#session.selectPreset(slot);
  }

  /** Hop to the next slot and back: the edit buffer is reloaded from memory. */
  async reloadSlot(slot: number): Promise<void> {
    await this.select((slot + 1) % this.#session.slotCount);
    await this.select(slot);
  }

  /** Stored read: nothing is selected. */
  async readPreset(slot: number, _names?: readonly SlotName[]): Promise<Uint8Array> {
    return (await this.#session.readPreset(slot)).prst;
  }

  exportPreset(slot: number): Promise<Uint8Array> {
    return this.readPreset(slot);
  }

  /**
   * Full write + double read-back (the session retries up to `attempts`). Writing the active slot: the session moves
   * to the next slot first and comes back (a stale edit buffer otherwise); any other slot is selected afterwards.
   */
  async writePreset(slot: number, prst: Uint8Array, opts: ProgressOptions & { attempts?: number } = {}): Promise<void> {
    const active = this.#session.currentSlot === slot;
    if (active) {
      this.#expectEcho(`select:${(slot + 1) % this.#session.slotCount}`);
      this.#expectEcho(`select:${slot}`);
      this.#forget();
    }
    await this.#session.writePreset(slot, prst, { confirm: true, verify: true, attempts: opts.attempts, onProgress: opts.onProgress });
    if (!active) await this.select(slot);
  }

  /** The active slot: live name + save (0x2003); any other: read, rename, full verified write. */
  async rename(slot: number, name: string): Promise<void> {
    await this.#session.renamePreset(slot, name, { confirm: true });
  }

  /** Stored reads of every slot; nothing is selected. */
  async backupAll(opts: ProgressOptions = {}): Promise<BackupEntry[]> {
    const entries = await this.#session.backupAll({ onProgress: opts.onProgress });
    return entries.map((e) => ({ slot: e.slot, name: e.name, prst: e.prst }));
  }

  /** `block`: storage order (PRE WAH DST AMP NR CAB EQ MOD DLY RVB VOL); `index`: the param's XML ID (0..14). */
  async setParam(block: number, index: number, value: number): Promise<void> {
    const buffer = this.#buffer;
    if (!this.#fxids) await this.#readBuffer();
    // Another patch took over while its models were read: the edit was for the one that was left.
    if (buffer !== this.#buffer) return;
    const fxid = this.#fxids?.[block];
    if (fxid === undefined) throw new RangeError(`The GP-200 has no block ${block}`);
    await this.#session.setParam(block, index, fxid, value);
  }

  async setBlockEnabled(block: number, on: boolean): Promise<void> {
    await this.#session.setBlockEnabled(block, on);
  }

  /** The pedal does not keep the old params: callers send the new model's params (or re-read the edit buffer). */
  async setModel(block: number, fxid: number): Promise<void> {
    this.#expectEcho(`model:${block}:${fxid >>> 0}`);
    await this.#session.setModel(block, fxid);
    if (this.#fxids) this.#fxids = this.#fxids.map((f, k) => (k === block ? fxid >>> 0 : f));
  }

  async setPatchVolume(volume: number): Promise<void> {
    await this.#session.setPatchVolume(volume);
  }

  async setBpm(bpm: number): Promise<void> {
    const { min, max } = profileFor(this.device ?? "gp200").tempo;
    await this.#session.setTempo(Math.max(min, Math.min(max, Math.round(bpm))));
  }

  /** 0x1006 state dump. Values are keyed by the GP-200 setting names (gp200-globals.ts GP200_GLOBAL_SPECS). */
  async readGlobals(): Promise<Gp200GlobalsSnapshot> {
    const g = await this.#session.readGlobals();
    return { ...toGlobals(g.values, g.firmware), eq: this.#eq };
  }

  /** Settings of the connected model only; anything else (a GP-5 setting, a destructive id) is a RangeError. */
  clampGlobal(name: GlobalName | Gp200GlobalName, value: number): number {
    return clampGp200Global(name, value, this.device);
  }

  /** One setting as 0x1008 {id, value} (clamped). Never the full 0x1007 write, never a destructive id. */
  async setGlobal(name: GlobalName | Gp200GlobalName, value: number): Promise<void> {
    const spec = gp200GlobalSpec(name, this.device);
    await this.#session.setGlobal(spec.name, clampGp200Global(spec.name, value, this.device));
  }

  /** One Global EQ value as 0x1005 {index, value}, clamped (gp200EqSpec); the two unused indices are refused. */
  async setGlobalEq(index: number, value: number): Promise<void> {
    const v = clampGp200Eq(index, value);
    this.#eq = { ...this.#eq, values: this.#eq.values.map((x, i) => (i === index ? v : x)) };
    await this.#session.setGlobalEq(index, v);
  }

  /** The 10 SnapTone slots: 0-4 AMP, 5-9 DST. Unlisted by the pedal: default names, kind "unknown". */
  async readSnapTones(): Promise<SlotName[]> {
    return this.#unlisted.snapTones ? [...this.#unlisted.snapTones] : toTable(await this.#session.readSnapToneNames());
  }

  /** Unlisted by the pedal: default names ("User IR 1"…), kind "unknown" (never offered as empty). */
  async readUserIRs(): Promise<SlotName[]> {
    return this.#unlisted.irs ? [...this.#unlisted.irs] : toTable(await this.#session.readIrNames());
  }

  /**
   * The pedal confirmed an upload (0x100B / 0x1014). Without a name read-back the table becomes unlisted (asking again
   * would stall the same way); in an unlisted table the slot is now known to hold the upload. Returns the stored name.
   */
  #uploaded(table: "irs" | "snapTones", r: UploadResult): string {
    const name = r.entry?.name ?? r.name;
    const current = this.#unlisted[table] ?? (r.entry ? null : unlistedTable(table));
    if (current) this.#unlisted = { ...this.#unlisted, [table]: current.map((s) => (s.slot === r.slot ? { slot: r.slot, name, kind: "user" } : s)) };
    return name;
  }

  /**
   * `file`: the 8840-byte VTSI clone the SnapTone conversion makes (cut to the GP-200's 1024 IR taps here) or a
   * 4744-byte GP-200 SnapTone. The GP-5 family's 2696-byte upload file has lost those taps and is refused.
   */
  async uploadSnapTone(slot: number, name: string, file: Uint8Array, opts: ProgressOptions = {}): Promise<string> {
    if (file.byteLength === GP5_SNAPTONE_FILE_BYTES)
      throw new RangeError("This SnapTone was made for the GP-5 or GP-50. Convert the capture again for the GP-200.");
    return this.#uploaded("snapTones", await this.#session.uploadSnapTone(slot, name, file, { confirm: true, onProgress: opts.onProgress }));
  }

  /** `data`: 24-bit samples at 44.1 kHz as int32 LE, up to 1024 (4096 bytes); a 512-sample GP-5 block also works. */
  async uploadUserIr(slot: number, name: string, data: Uint8Array, opts: ProgressOptions = {}): Promise<string> {
    return this.#uploaded("irs", await this.#session.uploadUserIr(slot, name, irSamples(data), { confirm: true, onProgress: opts.onProgress }));
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
