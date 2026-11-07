// Type declarations for session.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Bytes, ChainDef, DecodedRecord, ExpSlotDef, GlobalName, Gp200FamilyKey, HeaderRecord, Message } from "./protocol.mjs";

export type { Gp200FamilyKey };

export interface Gp200Transport {
  name: string;
  send(bytes: Uint8Array | number[]): void;
  onMessage(cb: (bytes: Uint8Array) => void): void;
  close(): void | Promise<void>;
}

export interface Gp200Timing {
  frameGapMs: number;
  multiChunkPauseMs: number;
  identityGapMs: number;
  replyTimeoutMs: number;
  resends: number;
  globalsPushMs: number;
  saveTimeoutMs: number;
  uploadTimeoutMs: number;
  selectSettleMs: number;
  writeAttempts: number;
  verifyReads: number;
}
export const DEFAULT_TIMING: Readonly<Gp200Timing>;
/** Longest SnapTone / User IR name a rename writes (the 16-byte field keeps a terminating NUL). */
export const SLOT_NAME_MAX: number;

export type Gp200ErrorCode = "timeout" | "length" | "verify" | "unsafe" | "closed" | "updater";
export class Gp200Error extends Error {
  constructor(code: Gp200ErrorCode, message: string);
  code: Gp200ErrorCode;
}

export type Gp200Globals = Partial<Record<GlobalName, number>>;
export interface ConnectInfo {
  device: Gp200FamilyKey;
  deviceType: 2 | 3 | 4;
  name: "GP-200" | "GP-200LT" | "GP-200JR";
  firmware: string | null;
  currentSlot: number | null;
  globals: Gp200Globals | null;
}
export interface PresetEntry {
  slot: number;
  label: string;
  name: string;
  image: Uint8Array;
  prst: Uint8Array;
}
export interface NameEntry {
  slot: number;
  flag: number;
  sum: number;
  name: string;
}
export interface SyncSnapshot {
  device: Gp200FamilyKey | null;
  firmware: string | null;
  currentSlot: number | null;
  globals: Gp200Globals | null;
  /** null: the pedal didn't answer (drum state and the name tables are optional sync steps) */
  drum: { playing: boolean; flag: number; exp1AB: number } | null;
  irNames: NameEntry[] | null;
  presets: PresetEntry[];
  styles: (string | null)[];
  editBuffer: { slot: number; image: Uint8Array };
  snapToneNames: NameEntry[] | null;
}
export interface WriteResult {
  frames: number;
  attempts: number;
  verified: boolean;
}
export interface UploadResult {
  slot: number;
  /** the name as sent (printable ASCII, <= 16 chars) */
  name: string;
  frames: number;
  /** the slot's name entry re-read after the upload; null when the pedal didn't answer the read-back (upload still confirmed) */
  entry: (NameEntry & { kind: "irName" | "snapToneName" }) | null;
}

/** Unsolicited traffic: a decoded record plus the message header, or a patch reply nobody waited for. */
export type Gp200Event =
  | (DecodedRecord & { header: HeaderRecord | null })
  | { kind: "flush"; header: null }
  | { kind: "softwareState"; state: number | null; deviceType: number | null; header: null }
  | { kind: "softwareJump"; header: null }
  | { kind: "patch"; stored: boolean; slot: number; image: Uint8Array; header: HeaderRecord | null };

/** Events: "message" (`.message: Gp200Event`), "midi" (non-SysEx, `.data`), "badframe" (`.data`). */
export class Gp200Session extends EventTarget {
  constructor(transport: Gp200Transport, opts?: { timing?: Partial<Gp200Timing>; log?: (dir: string, bytes: Uint8Array, decoded?: unknown) => void });
  get transportName(): string;
  get device(): Gp200FamilyKey | null;
  get deviceType(): 2 | 3 | 4 | null;
  get deviceName(): "GP-200" | "GP-200LT" | "GP-200JR" | null;
  get isUpdater(): boolean;
  get firmware(): string | null;
  get globals(): Gp200Globals | null;
  get currentSlot(): number | null;
  get dirty(): boolean;
  /** 256 (GP-200, LT) or 255 (JR) */
  get slotCount(): number;

  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  send(msg: Message): Promise<number>;
  sendShort(bytes: number[]): Promise<void>;
  close(): Promise<void>;

  connect(): Promise<ConnectInfo>;
  readStored(slot: number): Promise<Uint8Array>;
  readEditBuffer(): Promise<{ slot: number; image: Uint8Array }>;
  readPreset(slot: number): Promise<PresetEntry>;
  backupAll(opts?: { onProgress?: (done: number, total: number, entry: PresetEntry) => void }): Promise<PresetEntry[]>;
  readPresetNames(opts?: { onProgress?: (done: number, total: number, entry: PresetEntry) => void }): Promise<{ slot: number; label: string; name: string }[]>;
  readIrNames(): Promise<NameEntry[]>;
  readSnapToneNames(): Promise<NameEntry[]>;
  readStyleNames(): Promise<(string | null)[]>;
  readDrumState(): Promise<{ playing: boolean; flag: number; exp1AB: number }>;
  readGlobals(): Promise<{ firmware: string; currentSlot: number | null; values: Gp200Globals }>;
  sync(opts?: { onProgress?: (done: number, total: number, step: string) => void }): Promise<SyncSnapshot>;

  selectPreset(slot: number): Promise<number>;
  setParam(block: number | string, paramId: number, fxid: number, value: number): Promise<void>;
  setBlockEnabled(block: number | string, on: boolean): Promise<void>;
  setModel(block: number | string, fxid: number): Promise<void>;
  setChain(chain: ChainDef): Promise<void>;
  setPatchSetting(target: number, value: number): Promise<void>;
  setPatchVolume(v: number): Promise<void>;
  setTempo(bpm: number): Promise<void>;
  setPatchName(name: string): Promise<void>;
  setExp(def: ExpSlotDef): Promise<void>;
  setExpRange(which: "max" | "min", key: number, value: number): Promise<void>;
  setCtrl(index: number, mask: number, state?: number): Promise<void>;
  setQuickAccess(index: number, block: number, param: number): Promise<void>;
  setGlobal(name: GlobalName, value: number): Promise<void>;
  setGlobalEq(index: number, value: number): Promise<number>;

  savePreset(slot: number, name: string, opts: { confirm: true }): Promise<{ slot: number; name: string }>;
  renamePreset(slot: number, name: string, opts: { confirm: true }): Promise<{ slot: number; name: string }>;
  writePreset(
    slot: number,
    data: Bytes,
    opts: { confirm: true; verify?: boolean; attempts?: number; onProgress?: (done: number, total: number) => void },
  ): Promise<WriteResult>;
  /** User IR slot 0-19: up to 1024 24-bit samples at 44.1 kHz. */
  uploadUserIr(slot: number, name: string, samples: ArrayLike<number>, opts: { confirm: true; onProgress?: (done: number, total: number) => void }): Promise<UploadResult>;
  /** Rename a stored SnapTone (0-9) / User IR (0-19); the name is read back and must match. Resolves with the stored name. */
  renameSnapTone(slot: number, name: string, opts: { confirm: true }): Promise<string>;
  renameUserIr(slot: number, name: string, opts: { confirm: true }): Promise<string>;
  /** SnapTone slot 0-9 (0-4 AMP, 5-9 DST): a 0x2288 clone or a 0x1288 GP-200 blob. */
  uploadSnapTone(slot: number, name: string, blob: Bytes, opts: { confirm: true; onProgress?: (done: number, total: number) => void }): Promise<UploadResult>;
}
