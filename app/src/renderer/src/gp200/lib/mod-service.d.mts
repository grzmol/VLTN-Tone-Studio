// Type declarations for mod-service.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Bytes } from "./protocol.mjs";

export const SERVICE_TYPE: 0x200c;
export const SERVICE_MAGIC: 0x4747;
export const SERVICE_VERSION: 1;
export const SERVICE_HEADER: 12;
export const SERVICE_PAYLOAD_MAX: 1024;
export const RECORD_CHUNK: number;
export const TARGET_INDEX: 0x100;
export const OP: Readonly<{
  HELLO: 0x00; SCENE_LIST: 0x10; SCENE_READ: 0x11; SCENE_WRITE: 0x12; SCENE_DELETE: 0x13;
  SETTINGS_READ: 0x20; SETTINGS_WRITE: 0x21; GUESTS: 0x30; NOTIFY: 0x40;
}>;
export const STATUS: Readonly<{ OK: 0; VERSION: 1; OP: 2; BUSY: 3; NO_SPACE: 4; CHECKSUM: 5; OWNER: 6; LENGTH: 7; ARG: 8 }>;
export function statusText(status: number): string;
export type ModFeature = "HELLO" | "SCENES_READ" | "SCENES_WRITE" | "SETTINGS_READ" | "GUESTS" | "NOTIFY" | "SETTINGS_WRITE";
export const FEATURE: Readonly<Record<ModFeature, number>>;
export const NOTIFY: Readonly<{ SCENE: 1; RECORD: 2; SETTINGS: 4 }>;
export const NO_SCENE: 0xff;

export interface ServiceRecord {
  kind: "modService" | "modNotify";
  version: number;
  op: number;
  seq: number;
  status: number;
  arg: number;
  payload: Uint8Array;
}
export interface ModNotify extends ServiceRecord {
  kind: "modNotify";
  /** NOTIFY bits */
  events: number;
  sceneMode: boolean;
  /** 0-3, or null when the preset plays its base */
  activeScene: number | null;
  /** bit k = scene A+k saved */
  savedScenes: number;
  slot: number;
  owner: number;
}
export function encodeRequest(req: { op: number; seq: number; arg?: number; payload?: Bytes; version?: number; magic?: number }): Uint8Array;
export function encodeReply(rep: { op: number; seq: number; status?: number; arg?: number; payload?: Bytes }): Uint8Array;
export function decodeServiceData(data: Uint8Array): ServiceRecord | null;
export function withModService<T extends { kind: string }>(r: T): T | ServiceRecord | ModNotify;

export interface ModHello {
  name: string;
  letter: string;
  version: string;
  firmwareTag: string;
  features: number;
  has: Record<ModFeature, boolean>;
  scenes: { used: number; free: number; total: number };
  maxRecord: number;
  maxFormat: number;
}
export function decodeHello(payload: Uint8Array): ModHello;
export interface SceneListEntry {
  owner: number;
  /** null: no preset points at this record (orphan) */
  slot: number | null;
  /** record-store index 258 + index */
  index: number;
  format: number;
  /** bit k = scene A+k saved */
  scenes: number;
  size: number;
}
export function decodeSceneList(payload: Uint8Array): { free: number; total: number; records: SceneListEntry[] };
export function decodeRecordChunk(payload: Uint8Array): { size: number; ref: number; bytes: Uint8Array };
export interface ModGuest {
  fxid: number;
  fromBlock: number;
  fromPos: number;
  /** KB of the destination's slice it uses; 0 = fits the destination's own window */
  sliceKb: number;
}
export function decodeGuests(payload: Uint8Array): ModGuest[];
export function decodeNotify(payload: Uint8Array): Partial<ModNotify> & { events: number };
export function encodeWriteChunk(total: number, bytes: Bytes): Uint8Array;
export function crc32(bytes: ArrayLike<number>): number;

export const SCENE_MAGIC: "GPSC";
export const SCENE_FORMAT_MAX: 3;
export const SCENE_RECORD_MAX: 0x54c;
export const SCENE_COUNT: 4;
export const SCENE_NAME: 16;
export class SceneRecordError extends Error {}
export function defaultSceneName(k: number): string;

/** Values are raw f32 bits (u32), as stored. */
export interface SceneParam {
  block: number;
  slot: number;
  bits: number;
}
export interface Scene {
  name: string;
  /** null = as the base */
  mask: number | null;
  volume: number | null;
  bpm: number | null;
  params: SceneParam[];
  /** blocks playing their reserve effect (PRE 0, AMP 3, CAB 5) */
  reserve: Record<number, { fxid: number; params: number[] }>;
  /** PRE 2 on/off in this scene; null = as the base */
  pre2: boolean | null;
}
export interface ScenePre2 {
  fxid: number;
  enabled: boolean;
  params: number[];
}
export interface SceneRecord {
  format: number;
  owner: number;
  scenes: (Scene | null)[];
  pre2: ScenePre2 | null;
}
export function decodeSceneRecord(data: Bytes): SceneRecord;
export function encodeSceneRecord(rec: { owner: number; scenes?: (Partial<Scene> | null)[]; pre2?: ScenePre2 | null }): Uint8Array;

export interface ModSettings {
  tapTempo: "preset" | "global";
}
export function decodeSettingsRecord(data: Bytes): ModSettings;
export function encodeSettingsRecord(settings?: Partial<ModSettings>): Uint8Array;
export function bitsToFloat(bits: number): number;
export function floatToBits(x: number): number;
