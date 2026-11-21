// Type declarations for mock-device.mjs (the JS stays the tested source of truth; keep these in sync).
import type { ModGuest } from "./mod-service.mjs";
import type { Gp200Catalog } from "./catalog.mjs";
import type { Bytes, DecodedRecord, GlobalName, Gp200FamilyKey, HeaderRecord } from "./protocol.mjs";
import type { Gp200Transport } from "./session.mjs";

export function generatePatch(slot: number, opts?: { catalog?: Gp200Catalog }): Uint8Array;

export interface MockGp200Options {
  type?: Gp200FamilyKey | 2 | 3 | 4;
  /** 1 normal, 0 firmware-update mode (answers SOFTWARE_STATE only) */
  state?: 0 | 1;
  firmware?: string;
  /** patch images or .prst files for slots 0.. (the rest is generated) */
  images?: Bytes[];
  catalog?: Gp200Catalog;
  latencyMs?: number;
  minGapMs?: number;
  deafMs?: number;
  push1007?: boolean;
  verifyGlitch?: number;
  loseWrites?: number;
  fragmentSysex?: number;
  flushAfter?: number;
  ackWaitMs?: number;
  failUploads?: boolean;
  emitKnobNotify?: boolean;
  bankPolarity?: "manual" | "inverted";
  /** Record types (e.g. REC.IR_NAME) whose queries get no reply: a pedal that doesn't answer them */
  silentQueries?: number[];
  /** Answer the GrooveGurus mod service (0x200C); slot n's record number is n + 2. */
  mod?:
    | true
    | null
    | { name?: string; letter?: string; version?: string; firmwareTag?: string; features?: number; guests?: Record<number, ModGuest[]>; scenes?: Record<number, Bytes>; settings?: Bytes };
}
export type MockViolation =
  | { kind: "gap"; gapMs: number }
  | { kind: "deaf"; msLeft: number }
  | { kind: "danger"; what: string; bytes: Uint8Array }
  | { kind: "ackWait"; gapMs: number }
  | { kind: "hostBug"; what: string };
export interface MockSlotFile {
  name: string;
  sum: number;
  data: Uint8Array | null;
}

export class MockGp200 {
  constructor(opts?: MockGp200Options);
  type: 2 | 3 | 4;
  device: Gp200FamilyKey;
  name: string;
  slotCount: number;
  state: 0 | 1;
  firmware: string;
  slots: Uint8Array[];
  current: number;
  editBuffer: Uint8Array;
  dirty: boolean;
  globals: Record<GlobalName, number>;
  globalEq: number[];
  userIr: MockSlotFile[];
  snapTone: MockSlotFile[];
  styles: string[];
  drum: { playing: boolean; rhythm: number; volume: number; bpm: number };
  exp1AB: number;
  latencyMs: number;
  verifyGlitch: number;
  loseWrites: number;
  flushAfter: number;
  failUploads: boolean;
  emitKnobNotify: boolean;
  silentQueries: number[];
  /** decoded host messages, newest last */
  log: { cmd: number; header: HeaderRecord | null; records: DecodedRecord[] }[];
  violations: MockViolation[];
  transport(): Gp200Transport;
  setOutput(cb: ((bytes: Uint8Array) => void) | null): void;
  receive(bytes: Bytes): void;
  pressPreset(slot: number): void;
  turnKnob(block: number, paramId: number, value: number): void;
  toggleBlock(block: number, on?: boolean): void;
  tapTempo(bpm: number): void;
  /** Simulated mod state, or null on a stock pedal. */
  mod: { sceneMode: boolean; activeScene: number; hello: boolean; writes: number; records: (Uint8Array | null)[]; settings: Uint8Array | null } | null;
  modOwner(slot: number): number;
  modScenes(slot: number): Uint8Array | null;
  /** Scene mode on the pedal -> NOTIFY (after a HELLO). */
  setSceneMode(on: boolean): void;
  /** A-D on the pedal in scene mode -> NOTIFY (after a HELLO). */
  selectScene(k: number): void;
}
