// What the device store needs from a pedal, whatever its protocol family. One driver per connection; the store
// (state/device.ts) talks only to this interface. Gp5Driver adapts Gp5Session; the GP-200 family gets its own driver.
import { DEVICE_KEYS, profileFor, type DeviceFamily, type DeviceKey } from "@shared/devices";
import type { BackupEntry, DeviceFeature, ExpEdit, ExpSettings, GlobalEq, GlobalName, GlobalRecord, Globals, SlotName } from "../device-types";

export type { DeviceFeature };

/** Families with a driver in this build (the factory in ./index.ts has one per entry). */
export const DRIVER_FAMILIES = ["gp5", "gp200", "gp150"] as const satisfies readonly DeviceFamily[];
export type DriverFamily = (typeof DRIVER_FAMILIES)[number];

export function hasDriver(family: DeviceFamily): family is DriverFamily {
  return (DRIVER_FAMILIES as readonly DeviceFamily[]).includes(family);
}

/** Models this build can connect to, in display order. */
export const SUPPORTED_DEVICE_KEYS: readonly DeviceKey[] = DEVICE_KEYS.filter((k) => hasDriver(profileFor(k).family));

/** Unsolicited traffic from the pedal, already interpreted. */
export type DriverEvent =
  /** Something changed on the pedal (slot, preset, model): re-read the active preset */
  | { type: "resync" }
  /** A knob was turned on the pedal */
  | { type: "param"; block: number; index: number; value: number }
  /** A block was switched on the pedal */
  | { type: "block"; block: number; enabled: boolean }
  /** A name list changed on the pedal: re-read it (presets 0x40, SnapTones 0x24, User IRs 0x20 on the GP-50) */
  | { type: "listChanged"; list: "presets" | "snaptones" | "irs" }
  /** A preset setting changed on the pedal (tap tempo, EXP, volume) or echoes a host edit */
  | { type: "patchSetting"; field: "volume" | "bpm" | keyof ExpSettings; value: number }
  /** Footswitch assignments of the active preset changed */
  | { type: "footswitches"; fs1: number[]; fs2: number[] }
  /** Chain order of the active preset changed */
  | { type: "order"; order: number[] }
  /** A pedal setting changed (menu on the pedal, or the echo of a host write) */
  | { type: "global"; name: GlobalName; value: number }
  /** The pedal reported Global EQ values, by index (`all`: the whole EQ, GP-200 0x1004) */
  | { type: "globalEq"; values: Readonly<Record<number, number>>; all: boolean };

export interface GlobalsSnapshot {
  values: Globals;
  /** Every record of the reply, also the ones without a name */
  records: GlobalRecord[];
  /** Firmware the reply reports, e.g. "1.1.0" */
  firmware?: string;
  /** Global EQ (globalEq feature): what the pedal reported and was set since connecting, over the factory values */
  eq?: GlobalEq;
}

export interface SyncSnapshot {
  device: DeviceKey;
  names: SlotName[];
  slot: number;
  /** Active preset (edit buffer) as a full .prst */
  prst: Uint8Array;
  globals: GlobalsSnapshot | null;
  /** The active preset has unsaved edits on the pedal (features "modified"); null/absent = unknown */
  modified?: boolean | null;
}

export interface ProgressOptions {
  onProgress?: (done: number, total: number) => void;
}

/**
 * One open connection to a pedal. Every request is serialized by the driver. The memory-changing methods (write,
 * rename, uploads, delete/copy/move) are the confirmed path: callers MUST have the user's confirmation before calling them.
 * The optional members exist only for the `features` the connected model lists; the store checks `features` first.
 */
export interface DeviceDriver {
  /** MIDI port name, or the simulator's */
  readonly portName: string;
  /** Connected model; null until identified */
  readonly device: DeviceKey | null;
  /** Connect handshake: model, slot names, active slot and preset, pedal settings. */
  sync(): Promise<SyncSnapshot>;

  readNames(): Promise<SlotName[]>;
  /** Active slot and its edit buffer as a full .prst named `names[slot]`. */
  readActive(names: readonly SlotName[]): Promise<{ slot: number; prst: Uint8Array }>;
  /** The edit buffer as a full .prst named `name` (after a model change). */
  readEditBuffer(name: string): Promise<Uint8Array>;
  select(slot: number): Promise<void>;
  /** Drop the edits of the active `slot` by reloading it from memory. */
  reloadSlot(slot: number): Promise<void>;
  /** Stored preset of `slot`; may leave another slot active (callers select back). */
  readPreset(slot: number, names: readonly SlotName[]): Promise<Uint8Array>;
  /** Full write, verified by reading it back; `slot` is active afterwards. */
  writePreset(slot: number, prst: Uint8Array, opts?: ProgressOptions & { attempts?: number }): Promise<void>;
  rename(slot: number, name: string): Promise<void>;
  backupAll(opts?: ProgressOptions): Promise<BackupEntry[]>;

  // live edits on the active preset
  setParam(block: number, index: number, value: number): Promise<void>;
  setBlockEnabled(block: number, on: boolean): Promise<void>;
  setModel(block: number, fxid: number): Promise<void>;
  setPatchVolume(volume: number): Promise<void>;

  readGlobals(): Promise<GlobalsSnapshot>;
  /** The value the pedal stores for `value` (range and steps of the connected model's settings table). */
  clampGlobal(name: GlobalName, value: number): number;
  setGlobal(name: GlobalName, value: number): Promise<void>;

  readSnapTones(): Promise<SlotName[]>;
  readUserIRs(): Promise<SlotName[]>;
  /** Resolves with the name as stored on the pedal. */
  uploadSnapTone(slot: number, name: string, file: Uint8Array, opts?: ProgressOptions): Promise<string>;
  /** Resolves with the name as stored on the pedal. */
  uploadUserIr(slot: number, name: string, data: Uint8Array, opts?: ProgressOptions): Promise<string>;

  /** Listen to unsolicited traffic; returns the unsubscribe function. */
  subscribe(listener: (event: DriverEvent) => void): () => void;
  close(): Promise<void>;

  // optional capabilities (DeviceFeature); absent features mean the members are absent or reject
  /** Capabilities of the connected model; empty until identified. */
  readonly features?: readonly DeviceFeature[];
  /** "modified": the active preset has unsaved edits. */
  readModified?(): Promise<boolean>;
  /** "exportPreset": stored preset of `slot` as a full .prst, without selecting it. */
  exportPreset?(slot: number): Promise<Uint8Array>;
  /** "liveBpm": tempo of the active preset, 40..260. */
  setBpm?(bpm: number): Promise<void>;
  /** "exp": the given EXP fields of the active preset (values checked first). */
  setExp?(exp: ExpEdit): Promise<void>;
  /** "sync": Sync toggle `syncIndex` of `block`; resolves with the re-read edit buffer as a full .prst named `name`. */
  setSync?(block: number, syncIndex: number, on: boolean, name: string): Promise<Uint8Array>;
  /** "liveFootswitches": footswitch blocks of the active preset (validated first). */
  setFootswitches?(fs1: number[], fs2: number[]): Promise<void>;
  /** "liveOrder": chain order of the active preset (validated first). */
  setOrder?(order: number[]): Promise<void>;
  /** "deletePreset": reset `slot` to the empty preset. */
  deletePreset?(slot: number): Promise<void>;
  /** "copyPreset": copy the preset of `from` onto `to`. */
  copyPreset?(from: number, to: number): Promise<void>;
  /** "movePreset": move the preset of `from` to `to`; the ones in between shift. */
  movePreset?(from: number, to: number): Promise<void>;
  /** "globalEq": Global EQ value `index` (GlobalEq order), clamped to its range. */
  setGlobalEq?(index: number, value: number): Promise<void>;
}

/** What the factory needs to open a driver. */
export interface DriverOptions {
  /** MIDI log hook: every frame in and out (the monitor decodes it) */
  log: (dir: string, bytes: Uint8Array, decoded?: unknown) => void;
  /** The port went away (unplugged, switched off) */
  onDisconnect: () => void;
}
