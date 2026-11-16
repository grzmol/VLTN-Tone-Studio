// Type declarations for session.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Bytes, GlobalDef, GlobalName, Message } from "./protocol.mjs";

export interface Gp150Transport {
  name: string;
  send(bytes: Uint8Array | number[]): void;
  onMessage(cb: (bytes: Uint8Array) => void): void;
  close(): void | Promise<void>;
}

export interface Gp150Timing {
  frameGapMs: number;
  helloTimeoutMs: number;
  ackTimeoutMs: number;
  replyTimeoutMs: number;
  uploadTimeoutMs: number;
  resends: number;
}
export const DEFAULT_TIMING: Readonly<Gp150Timing>;

export type Gp150ErrorCode = "timeout" | "length" | "verify" | "unsafe" | "closed";
export class Gp150Error extends Error {
  constructor(code: Gp150ErrorCode, message: string);
  code: Gp150ErrorCode;
}

export type Gp150Globals = Partial<Record<GlobalName, number>>;
export interface ListEntry {
  slot: number;
  name: string;
  /** the pedal reports the slot as empty */
  empty: boolean;
}

/** Unsolicited traffic from the pedal. */
export type Gp150Event =
  | { kind: "patch"; prst: Uint8Array }
  | { kind: "param"; fxid: number; value: number; block: number; param: number }
  | { kind: "block"; block: number; enabled: boolean }
  | { kind: "model"; fxid: number; block: number }
  | { kind: "chain"; chain: number[] }
  | { kind: "modified"; modified: boolean }
  | { kind: "patchSettings"; tempo: number; volume: number; namMode: number }
  | { kind: "patchRecord"; cmd: number }
  | { kind: "names"; names: { slot: number; name: string; empty: boolean }[] }
  | { kind: "listChanged"; cmd: number }
  | { kind: "globalEq"; values: number[] }
  | { kind: "globals"; cmd: number; values: Gp150Globals }
  | { kind: "saved"; slot: number; name: string };

/** Events: "message" (`.message: Gp150Event`), "midi" (non-SysEx, `.data`), "badframe" (`.data`). */
export class Gp150Session extends EventTarget {
  constructor(transport: Gp150Transport, opts?: { timing?: Partial<Gp150Timing>; log?: (dir: string, bytes: Uint8Array, decoded?: Message | { control: number; seq: number }) => void });
  get transportName(): string;
  get firmware(): string | null;
  get currentSlot(): number | null;
  get modified(): boolean;
  get slotCount(): number;

  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  set(msg: Uint8Array): Promise<number>;
  close(): Promise<void>;

  connect(): Promise<{ firmware: string; globals: Gp150Globals; eq: number[] | null }>;
  readPresetNames(): Promise<{ slot: number; name: string }[]>;
  readIrNames(): Promise<ListEntry[]>;
  /** SnapTone slots 1-100 */
  readSnapToneNames(): Promise<ListEntry[]>;
  readNamNames(): Promise<ListEntry[]>;
  readGlobals(): Promise<{ firmware: string; values: Gp150Globals; eq: number[] | null }>;
  readEditBuffer(): Promise<{ slot: number; prst: Uint8Array }>;
  readPreset(slot: number): Promise<Uint8Array>;
  selectPreset(slot: number): Promise<Uint8Array>;
  backupAll(opts?: { onProgress?: (done: number, total: number) => void }): Promise<{ slot: number; name: string; prst: Uint8Array }[]>;

  setParam(block: number, param: number, fxid: number, value: number): Promise<number>;
  setBlockEnabled(block: number, on: boolean): Promise<number>;
  setModel(block: number, fxid: number): Promise<number>;
  setPatchSettings(current: Bytes, edits: { tempo?: number; volume?: number; namMode?: number; name?: string }): Promise<number>;
  setKnobs(targets: readonly number[]): Promise<number>;
  setGlobal(name: GlobalName, value: number, spec: GlobalDef): Promise<void>;
  setGlobalEq(values: readonly number[]): Promise<void>;

  writePreset(slot: number, prst: Bytes, opts: { confirm: true; verify?: boolean; onProgress?: (done: number, total: number) => void }): Promise<{ verified: boolean }>;
  renamePreset(slot: number, name: string, opts: { confirm: true }): Promise<{ slot: number; name: string }>;
  uploadUserIr(slot: number, name: string, samples: ArrayLike<number>, opts: { confirm: true; onProgress?: (done: number, total: number) => void }): Promise<ListEntry>;
  uploadSnapTone(slot: number, name: string, file: Bytes, opts: { confirm: true; onProgress?: (done: number, total: number) => void }): Promise<ListEntry>;
  renameListSlot(kind: "ir" | "snaptone" | "nam", slot: number, name: string, opts: { confirm: true }): Promise<number>;
}
