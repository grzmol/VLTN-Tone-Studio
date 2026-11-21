// Type declarations for protocol.mjs (the JS stays the tested source of truth; keep these in sync).
export type Bytes = Uint8Array | number[];

export const SYSEX_ID: readonly number[];
export const CMD: Readonly<{ QUERY: 0x11; SET: 0x12; FLUSH: 0x03 }>;
export const CHUNK: Readonly<{ HOST: 183; DEVICE: 185 }>;
export const MAX_MESSAGE: number;
export const ADDRESS: Readonly<{ SOFTWARE_STATE: readonly number[]; SOFTWARE_JUMP: readonly number[] }>;
export const REC: Readonly<Record<
  | "HEADER" | "READ" | "INFO" | "PARAM" | "PATCH_SETTING" | "NAME" | "CHAIN" | "AUTHOR" | "STYLE_NAME" | "NOTE" | "EXP" | "EXP_RANGE"
  | "CTRL" | "QUICK_ACCESS" | "FOCUS" | "BLOCK" | "BLOCK_ON" | "MODEL" | "DRUM_STATE" | "DRUM" | "GLOBAL_EQ_ALL" | "GLOBAL_EQ"
  | "STATE_DUMP" | "GLOBALS" | "SYSTEM" | "IR_NAME" | "IR_UPLOAD" | "IR_RESULT" | "IR_RENAME" | "FS_FUNCTION" | "STATUS"
  | "SNAPTONE_NAME" | "SNAPTONE_UPLOAD" | "SNAPTONE_RESULT" | "SNAPTONE_RENAME" | "FIRMWARE_JUMP" | "IDENTITY" | "SAVE"
  | "RESET_PROGRESS" | "FAVOURITE" | "MOVE" | "MOVE_COMMIT" | "DELETE",
  number
>>;

export type BlockName = "PRE" | "WAH" | "DST" | "AMP" | "NR" | "CAB" | "EQ" | "MOD" | "DLY" | "RVB" | "VOL";
/** The 11 blocks in record order (= default chain order). */
export const BLOCKS: readonly ["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"];
export const BLOCK: Readonly<Record<BlockName, number>>;
/** f32 params per block record. */
export const PARAM_COUNT: 15;
export const PATCH_SETTING: Readonly<{ VOL: 0; TEMPO: 1; STYLE: 2; SEND: 3; RETURN: 4; LOOP_MODE: 5; PAN: 6 }>;
/** Quick-Access / EXP block bytes that are not blocks. */
export const TARGET: Readonly<{ PATCH_VOL: 0x0b; PATCH_TEMPO: 0x0c; NONE: 0xff }>;
export const STATUS: Readonly<{ DRUM: 0; DIRTY: 1; EXP1_AB: 2 }>;
export const STYLE_COUNT: 20;
export const NAME_FIELD: 16;

/** The protocol family's own device key (the app-wide union lives in shared/devices.ts). */
export type Gp200FamilyKey = "gp200" | "gp200lt" | "gp200jr";
export interface Gp200DeviceInfo {
  type: 2 | 3 | 4;
  key: Gp200FamilyKey;
  name: "GP-200" | "GP-200LT" | "GP-200JR";
  slots: 256 | 255;
  footswitches: number;
}
export const DEVICE_TYPES: Readonly<Record<2 | 3 | 4, Gp200DeviceInfo>>;
export function deviceByKey(key: string): Gp200DeviceInfo | null;
export const GP200_PORT_RE: RegExp;
/** "01-A" ... "64-D". */
export function slotLabel(slot: number): string;

export type GlobalName =
  | "inputLevel" | "inputMode" | "noCabL" | "noCabR" | "usbRecLevel" | "recModeL" | "recModeR" | "auxToUsb" | "usbMonitorLevel"
  | "exp2Mode" | "exp1Mode" | "midiInSource" | "midiInChannelDin" | "midiInChannelUsb" | "midiOutChannelDin" | "midiOutChannelUsb"
  | "clockSource" | "clockOutDin" | "clockOutUsb" | "fsMode" | "exp1AB" | "extFs1" | "extFs2" | "globalEq" | "extFs1Tap"
  | "extFs2Tap" | "bankSelectMode" | "autoCabMatch" | "displayMode";
export interface GlobalDef {
  id: number;
  /** Offset in the 0x1007 state record; null when the value lives in the patch. */
  off: number | null;
  type: "u8" | "u16" | "i16";
}
export const GLOBALS: Readonly<Record<GlobalName, GlobalDef>>;
export function globalNameById(id: number): GlobalName | null;
export const DESTRUCTIVE_GLOBAL_IDS: readonly number[];
export const SELECT_ID: 0;
export const GLOBALS_RECORD_SIZE: 72;
export const GLOBAL_EQ_BANDS: 31;
export const GLOBAL_EQ_INDEX: Readonly<{
  lowCut: { en: number; freq: number };
  lowShelf: { en: number; freq: number; q: number; gain: number };
  band1: { en: number; freq: number; q: number; gain: number };
  band2: { en: number; freq: number; q: number; gain: number };
  band3: { en: number; freq: number; q: number; gain: number };
  band4: { en: number; freq: number; q: number; gain: number };
  highShelf: { en: number; freq: number; q: number; gain: number };
  highCut: { en: number; freq: number };
  level: number;
}>;
export const USER_IR: Readonly<{ SLOTS: 20; SAMPLES: 1024; DATA_BYTES: 4096; RATE: 44100; FXID_BASE: number }>;
export const SNAPTONE_FIELD: 0x2000;

export function u16le(v: number): number[];
export function u32le(v: number): number[];
export function f32le(v: number): number[];
export function readU16(b: ArrayLike<number>, o: number): number;
export function readI16(b: ArrayLike<number>, o: number): number;
export function readU32(b: ArrayLike<number>, o: number): number;
export function readF32(b: Uint8Array, o: number): number;
export function byteSum(bytes: Uint8Array): number;
export function concat(parts: ArrayLike<number>[]): Uint8Array;
export function asciiField(text: string, width: number): number[];
export function readAscii(b: ArrayLike<number>, o: number, width: number): string;
/** Printable ASCII (0x20-0x7E), at most `width` (16) characters. */
export function sanitizeName(name: string, width?: number): string;
export function toHex(bytes: ArrayLike<number>, sep?: string): string;
export function fromHex(hex: string): Uint8Array;

/** A host or device message before framing. */
export type Message = { cmd: number; payload: Uint8Array; len?: number } | { cmd: number; address: readonly number[]; data?: number[] };
export function encodeFrames(msg: Message, chunk?: number): Uint8Array[];

export type Frame =
  | { kind: "data"; cmd: number; len: number; off: number; data: Uint8Array }
  | { kind: "address"; cmd: number; address: "softwareState" | "softwareJump"; data: Uint8Array }
  | { kind: "flush"; cmd: number };
export function decodeFrame(bytes: Bytes): Frame | null;

export class Reassembler {
  constructor(opts?: { staleMs?: number; now?: () => number; shortChunkEnds?: number });
  reset(): void;
  push(frame: Extract<Frame, { kind: "data" }>): { cmd: number; payload: Uint8Array } | null;
}
export class SysexAssembler {
  push(bytes: Bytes): Uint8Array[];
}

export interface TlvRecord {
  type: number;
  len: number;
  offset: number;
  data: Uint8Array;
  truncated: boolean;
}
export function tlv(type: number, data?: Bytes, declaredLen?: number): Uint8Array;
export function walkTlv(payload: Bytes): TlvRecord[];
export function imageWithSlot(image: Bytes, slot: number): Uint8Array;

export interface ExpSlotDef {
  key: number;
  block: number;
  param: number;
  max: number;
  min: number;
}
export interface ChainDef {
  sendPos: number;
  returnPos: number;
  order: number[];
}
export interface ParamDef {
  block: number;
  paramId: number;
  fxid: number;
  value: number;
}

/** Record builders: TLV bytes of one record. */
export const rec: {
  header(a: number, b: number): Uint8Array;
  read(slot: number): Uint8Array;
  param(p: ParamDef): Uint8Array;
  patchSetting(target: number, value: number): Uint8Array;
  name(slot: number, text: string): Uint8Array;
  chain(slot: number, chain: ChainDef): Uint8Array;
  author(slot: number, text: string): Uint8Array;
  styleName(index: number, text: string): Uint8Array;
  note(slot: number, text: string): Uint8Array;
  exp(def: ExpSlotDef): Uint8Array;
  expRange(which: "max" | "min", key: number, value: number): Uint8Array;
  ctrl(index: number, state: number, mask: number): Uint8Array;
  quickAccess(index: number, block: number, param: number): Uint8Array;
  focus(block: number): Uint8Array;
  block(b: { block: number; enabled: boolean; fxid: number; params?: ArrayLike<number>; opaque?: number }): Uint8Array;
  blockOn(block: number, on: boolean): Uint8Array;
  model(block: number, fxid: number): Uint8Array;
  drumStateQuery(): Uint8Array;
  drumState(s: { playing: boolean; flag?: number; exp1AB?: number }): Uint8Array;
  drum(id: number, value: number): Uint8Array;
  globalEq(index: number, value: number): Uint8Array;
  stateDump(): Uint8Array;
  globals(bytes72: Bytes): Uint8Array;
  system(id: number, value: number): Uint8Array;
  irNameQuery(slot: number): Uint8Array;
  snapToneNameQuery(slot: number): Uint8Array;
  nameEntry(type: number, slot: number, flag: number, sum: number, name: string): Uint8Array;
  uploadResult(type: number, slot: number, status: number): Uint8Array;
  irRename(slot: number, text: string): Uint8Array;
  snapToneRename(slot: number, text: string): Uint8Array;
  fsFunction(fsMode: number, record: number, func: number): Uint8Array;
  status(sub: number, value: number): Uint8Array;
  identity(): Uint8Array;
  identityReply(state: number, type: number): Uint8Array;
  save(slot: number, text: string): Uint8Array;
  favourite(slot: number, add: boolean): Uint8Array;
  move(from: number, to: number): Uint8Array;
  moveCommit(): Uint8Array;
  deletePatch(slot: number): Uint8Array;
  userIr(slot: number, name: string, samples: ArrayLike<number>): Uint8Array;
  snapTone(slot: number, name: string, blob: Bytes): Uint8Array;
};

type Msg = { cmd: number; payload: Uint8Array };
/** Host messages; `cur` = the current slot (edit-buffer header {0, cur}). */
export const encode: {
  identity(): Msg;
  softwareState(): { cmd: number; address: readonly number[] };
  stateDump(): Msg;
  drumState(): Msg;
  irName(slot: number): Msg;
  snapToneName(slot: number): Msg;
  styleName(index: number): Msg;
  readStored(slot: number): Msg;
  readEditBuffer(cur: number): Msg;
  select(slot: number): Msg;
  param(cur: number, p: ParamDef): Msg;
  blockEnabled(cur: number, block: number, on: boolean): Msg;
  model(cur: number, block: number, fxid: number): Msg;
  chain(cur: number, chain: ChainDef): Msg;
  patchSetting(cur: number, target: number, value: number): Msg;
  patchName(cur: number, name: string): Msg;
  author(cur: number, text: string): Msg;
  note(cur: number, text: string): Msg;
  exp(cur: number, def: ExpSlotDef): Msg;
  expRange(cur: number, which: "max" | "min", key: number, value: number): Msg;
  ctrl(cur: number, index: number, state: number, mask: number): Msg;
  quickAccess(cur: number, index: number, block: number, param: number): Msg;
  focus(cur: number, block: number): Msg;
  save(slot: number, name: string): Msg;
  fullWrite(slot: number, image: Bytes): Msg;
  global(id: number, value: number): Msg;
  globalEq(index: number, value: number): Msg;
  drumPlay(on: boolean): Msg;
  drum(id: number, value: number): Msg;
  setStyleName(index: number, name: string): Msg;
  userIr(slot: number, name: string, samples: ArrayLike<number>): Msg;
  irRename(slot: number, name: string): Msg;
  snapTone(slot: number, name: string, blob: Bytes): Msg;
  snapToneRename(slot: number, name: string): Msg;
  fsFunction(fsMode: number, record: number, func: number): Msg;
  favourite(slot: number, add: boolean): Msg;
  move(from: number, to: number): Msg;
  moveCommit(): Msg;
  deletePatch(slot: number): Msg;
};

/** Why a frame must never be sent (firmware jump, updater, destructive globals), or null. */
export function dangerOf(bytes: Bytes): string | null;
export function dangerOfMessage(msg: Message): string | null;

export const GLOBALS_RECORD_TAG: readonly number[];
export interface GlobalsState {
  currentSlot: number | null;
  values: Partial<Record<GlobalName, number>>;
}
export function decodeGlobals(d: Uint8Array): GlobalsState;
export function encodeGlobals(g: { currentSlot: number; values: Partial<Record<GlobalName, number>> }): Uint8Array;

export interface HeaderRecord {
  kind: "header";
  a: number;
  b: number;
}
/** One decoded record; `kind` doubles as the session event type. */
export type DecodedRecord =
  | HeaderRecord
  | { kind: "read"; slot: number }
  | { kind: "patchInfo"; slot: number; name: string }
  | { kind: "param"; block: number; paramId: number; fxid: number; value: number }
  | { kind: "patchSetting"; target: number; value: number }
  | { kind: "patchName"; slot: number; name: string }
  | { kind: "chain"; slot: number; sendPos: number; returnPos: number; order: number[] }
  | { kind: "author"; slot: number; text: string }
  | { kind: "styleName"; index: number; name: string }
  | { kind: "note"; slot: number; text: string }
  | { kind: "exp"; key: number; pedal: number; para: number; block: number | null; param: number; max: number; min: number }
  | { kind: "expRange"; which: "max" | "min"; key: number; pedal: number; para: number; value: number }
  | { kind: "ctrl"; index: number; state: number; mask: number }
  | { kind: "quickAccess"; index: number; block: number | null; param: number }
  | { kind: "focus"; block: number }
  | { kind: "block"; block: number; enabled: boolean; fxid: number; params: number[] }
  | { kind: "blockEnabled"; block: number; enabled: boolean }
  | { kind: "model"; block: number; fxid: number }
  | { kind: "drumState"; playing: boolean; flag: number; exp1AB: number }
  | { kind: "drum"; id: number; value: number }
  | { kind: "globalEqAll"; values: number[] }
  | { kind: "globalEq"; index: number; value: number }
  | { kind: "stateDump" }
  | ({ kind: "globals" } & GlobalsState)
  | { kind: "patchChanged"; slot: number }
  | { kind: "global"; id: number; name: GlobalName | null; value: number }
  | { kind: "irName" | "snapToneName"; slot: number; flag: number; sum: number; name: string }
  | { kind: "irResult" | "snapToneResult"; slot: number; status: number; ok: boolean }
  | { kind: "irRename" | "snapToneRename"; slot: number; name: string }
  | { kind: "irUpload"; slot: number; sum: number; name: string; pcm: Uint8Array }
  | { kind: "snapToneUpload"; slot: number; sum: number; name: string; blob: Uint8Array }
  | { kind: "fsFunction"; fsMode: number; record: number; func: number }
  | { kind: "dirty"; dirty: boolean }
  | { kind: "exp1AB"; value: number }
  | { kind: "drumPlaying"; playing: boolean }
  | { kind: "status"; sub: number; value: number }
  | { kind: "identity"; state: number; deviceType: number }
  | { kind: "identityQuery" }
  | { kind: "saved"; slot: number; name: string }
  | { kind: "resetProgress"; percent: number }
  | { kind: "slotModified"; slot: number; flag: number }
  | { kind: "move"; from: number; to: number }
  | { kind: "moveCommit" }
  | { kind: "delete"; slot: number }
  | { kind: "unknown"; type: number; data: Uint8Array };
export function decodeRecord(r: { type: number; data: Uint8Array }): DecodedRecord;

export interface PatchReply {
  /** true = stored slot (header a = 1), false = live edit buffer */
  stored: boolean;
  slot: number;
  image: Uint8Array;
}
export interface DecodedMessage {
  cmd: number;
  header: HeaderRecord | null;
  records: DecodedRecord[];
  patch: PatchReply | null;
  payload: Uint8Array;
}
export function decodeMessage(msg: { cmd: number; payload: Uint8Array }): DecodedMessage;
export function decodeSoftwareState(data: ArrayLike<number>): { state: number | null; deviceType: number | null };
