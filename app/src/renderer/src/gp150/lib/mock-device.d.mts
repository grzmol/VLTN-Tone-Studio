// Type declarations for mock-device.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Gp150Catalog } from "./catalog.mjs";
import type { Message } from "./protocol.mjs";
import type { Gp150Transport } from "./session.mjs";

export interface MockGp150Options {
  catalog?: Gp150Catalog;
  /** delay before each frame the simulator sends */
  latencyMs?: number;
  /** model name of the port ("GP-150", "GP-180"); the protocol is the same */
  name?: string;
}

export class MockGp150 {
  constructor(opts?: MockGp150Options);
  presets: Uint8Array[];
  editBuffer: Uint8Array;
  activeSlot: number;
  modified: boolean;
  irNames: { name: string; empty: boolean }[];
  /** entry 0 "None", slots 1-100 */
  snapToneNames: { name: string; empty: boolean }[];
  /** entry 0 None, then NAM slots 1-100 */
  namNames: { name: string; empty: boolean }[];
  uploads: { cmd: number; slot: number; name: string; data: Uint8Array }[];
  received: Message[];
  records: Map<number, Uint8Array>;
  firmwareField: Uint8Array;
  /** host messages not to ACK (fault injection) */
  dropAcks: number;

  transport(): Gp150Transport;
  turnKnob(block: number, param: number, value: number): Promise<void>;
  switchBlock(block: number, on: boolean): Promise<void>;
  selectOnPedal(slot: number): Promise<void>;
  saveOnPedal(slot?: number): Promise<void>;
  reportNamNames(): Promise<void>;
  importFile(slot: number): Uint8Array;
}
