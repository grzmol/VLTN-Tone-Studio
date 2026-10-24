// Contract between the device layer (src/renderer/src/state/device.ts) and every screen.
// Screens read state with `useDevice(selector)` and call actions on `useDevice.getState()`.
// Pedal models come from the registry (@shared/devices). Presets of every family share the model below: block indices
// follow the model's storage order, profileFor(device).blocks; state/preset-codec.ts reads and edits each family's bytes.
import type { DeviceHostStatus } from "@shared/host/device";
import type { DeviceFamily, DeviceKey } from "@shared/devices";
import type { ExpEdit, ExpSettings, GlobalName as Gp5GlobalName, GlobalSpec, Gp5FamilyKey } from "@/gp5/lib/session.mjs";
import type { GlobalName as Gp200GlobalName } from "@/gp200/lib/protocol.mjs";
import type { GlobalName as Gp150GlobalName } from "@/gp150/lib/protocol.mjs";
import type { PatchExp, PatchQuickAccess } from "@/gp200/lib/prst.mjs";

export type { DeviceFamily, DeviceKey, ExpEdit, ExpSettings, GlobalSpec, Gp5FamilyKey, Gp5GlobalName, Gp200GlobalName, Gp150GlobalName, PatchExp, PatchQuickAccess };

/** Block codes of the GP-5 family's presets (profileFor("gp5").blocks). */
export type Gp5BlockCode = "NR" | "PRE" | "DST" | "AMP" | "CAB" | "EQ" | "MOD" | "DLY" | "RVB" | "NS";
/** Block codes of every family: the GP-200 family and the GP-150 add WAH and VOL (profileFor(device).blocks). */
export type BlockCode = Gp5BlockCode | "WAH" | "VOL";

export interface ParamInfo {
  name: string;
  /** algId: position in the block's 8 params */
  index: number;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Display unit from the catalog ("ms", "Hz", "dB") */
  unit?: string;
  /** Enum params: label of each value, labels[value - min] (e.g. MidFreq "220 Hz", a synced Time "1/8D") */
  labels?: readonly string[];
  /** Renders as a switch (catalog toggles: +3dB, Bright, Trail, Sync…) */
  toggle?: boolean;
  /** On a Sync toggle: algId of the Time/Rate param it switches to note divisions (GP-50) */
  syncs?: number;
  /** The values the param takes when they are not every step of min..max (GP-200 menus with gaps) */
  values?: readonly number[];
  /** The minimum shows as OFF (GP-200, e.g. a Low Cut at 19 Hz) */
  offAtMin?: boolean;
}

export interface ModelInfo {
  fxid: number;
  block: BlockCode;
  /** Short device name, e.g. "Plustortion" */
  name: string;
  /** Display title, e.g. "Plustortion" or "Tone Catch 36" */
  title: string;
  /** Category, e.g. "Distortion", "Overdrive", "Hi Gain" */
  type: string;
  /** Real-world gear it models, when known */
  origin?: string;
  params: ParamInfo[];
}

export interface BlockState {
  index: number;
  code: BlockCode;
  enabled: boolean;
  fxid: number;
  /** undefined when the fxid is not in the catalog */
  model?: ModelInfo;
  /** Raw param values by index: 8 on the GP-5 family (algId), 15 on the GP-200 family (XML ID) */
  params: number[];
}

export interface PresetState {
  /** Model the preset belongs to (from the .prst); selects the codec and the effect catalog */
  device: DeviceKey;
  slot: number;
  name: string;
  blocks: BlockState[];
  /** Signal order: permutation of block indices (on the GP-5 family DST, NS, AMP, CAB, EQ stay contiguous) */
  order: number[];
  volume: number;
  /** Tempo in BPM, within profileFor(device).tempo */
  bpm: number;
  /**
   * Switch assignments, one block list per switch: FS1 and FS2 on the GP-5 family, CTRL 1-8 on the GP-200 family
   * (every CTRL record of the patch; how many a model shows is up to the screen). Names: switchLabel (device-model).
   */
  footswitches: number[][];
  /** EXP pedal settings stored with the preset (GP-50); null on models without them (the GP-200 family's are in `gp200`) */
  exp: ExpSettings | null;
  /** Patch fields only the GP-200 family has; null on the GP-5 family */
  gp200: Gp200Fields | null;
  /** Full .prst bytes of the current (possibly edited) state */
  prst: Uint8Array;
}

/** Patch fields of the GP-200 family without a GP-5 equivalent (gp200/lib/prst.mjs parsePatch). */
export interface Gp200Fields {
  author: string;
  note: string;
  pan: number;
  /** Drum style */
  style: number;
  /** FX loop */
  loopMode: number;
  sendLevel: number;
  returnLevel: number;
  /** Where the FX loop send and return sit in the chain */
  sendPos: number;
  returnPos: number;
  /** The 9 EXP entries in order EXP 1A, 1B, 2 (three each): exp[i] is entry i */
  exp: PatchExp[];
  /** The 3 Quick Access knobs: quickAccess[i] is knob i */
  quickAccess: PatchQuickAccess[];
}

/** An edit of the GP-200 family's own patch fields (DeviceState.editPatch); exp and quickAccess by entry index. */
export type Gp200Edit = Partial<Omit<Gp200Fields, "exp" | "quickAccess">> & {
  exp?: Record<number, Partial<Pick<PatchExp, "block" | "param" | "max" | "min">>>;
  quickAccess?: Record<number, Partial<Pick<PatchQuickAccess, "block" | "param">>>;
};

/** Changes to a preset in the app's terms; state/preset-codec.ts applies them to each family's bytes. */
export interface PresetEdits {
  name?: string;
  volume?: number;
  bpm?: number;
  order?: number[];
  footswitches?: number[][];
  blocks?: Record<number, { enabled?: boolean; fxid?: number; params?: Record<number, number> }>;
  /** GP-50 EXP settings */
  exp?: ExpEdit;
  /** GP-200 family fields */
  gp200?: Gp200Edit;
}

export interface SlotName {
  slot: number;
  name: string;
  /** SnapTone / user IR tables only: what the pedal reports for the slot; "unknown" = not reported (treat as occupied) */
  kind?: "user" | "factory" | "empty" | "unknown";
}

/** One record of the 0x10 globals reply ([a, b] address, byte length, decoded value). */
export interface GlobalRecord {
  a: number;
  b: number;
  len: number;
  value: number;
}

/** Last failed request on a live session (shown inline on the Device screen and in the report). */
export interface RequestError {
  code: string;
  message: string;
  at: number;
}

/** One MIDI monitor line (Device screen). */
export interface MidiLogEntry {
  id: number;
  /** Wall-clock ms */
  at: number;
  dir: "out" | "in" | "bad" | "warn";
  /** Decoded description, e.g. "Select preset 63", "Acknowledged" */
  text: string;
  /** Short raw info: CC bytes in full, SysEx length */
  raw: string;
  ack: boolean;
}

/** Pedal setting names of every family (GP-5 family: gp5/lib protocol.mjs globalsFor; GP-200 family: gp200-globals.ts; GP-150: gp150-globals.ts). */
export type GlobalName = Gp5GlobalName | Gp200GlobalName | Gp150GlobalName;

/**
 * One pedal setting as a settings screen shows it: GP-5 family specs carry their 0x10 record address, GP-200 ones their
 * 0x1008 id, GP-150 ones their record and offset as id (record << 8 | offset).
 */
export type SettingSpec = Omit<GlobalSpec, "name" | "addr"> & { name: GlobalName; addr?: GlobalSpec["addr"]; id?: number };

/** Pedal settings of the connected model; absent keys were not in the reply. */
export type Globals = Partial<Record<GlobalName, number>>;

/**
 * Optional capabilities of a connected pedal (DeviceDriver.features). The store offers the experimental ones
 * (EXPERIMENTAL_FEATURES, device-model.ts) on a real pedal only with the "Experimental pedal commands" setting on.
 */
export type DeviceFeature =
  /** Reads whether the active preset has unsaved edits (GP-50 0x45) */
  | "modified"
  /** Reads a stored slot without selecting it (GP-50 12 4F) */
  | "exportPreset"
  /** Per-preset EXP pedal settings, edited live (GP-50 0x42 0x2003..0x200A) */
  | "exp"
  /** Tempo sent live (GP-50 0x42 0x2002) */
  | "liveBpm"
  /** Sync toggles switch Time/Rate to note divisions; the pedal resets the value (GP-50) */
  | "sync"
  /** Footswitch assignments sent live (GP-50 11 4D) */
  | "liveFootswitches"
  /** Chain order sent live (GP-50 11 44) */
  | "liveOrder"
  /** Reset a slot to the empty preset (GP-50 11 46) */
  | "deletePreset"
  /** Copy one slot onto another inside the pedal (GP-50 11 4B) */
  | "copyPreset"
  /** Move a slot in the list, the ones in between shift (GP-50 11 5A) */
  | "movePreset"
  /** Global EQ values set one at a time (GP-200 family 0x1005) */
  | "globalEq";

/**
 * Global EQ of the GP-200 family: the 31 values in the order of gp200/lib protocol GLOBAL_EQ_INDEX (ranges:
 * driver/gp200-globals.ts gp200EqSpec). `read`: the pedal reported all of them; until it does, the values it didn't
 * report are the editor's factory values (GP200_EQ_DEFAULTS).
 */
export interface GlobalEq {
  values: readonly number[];
  read: boolean;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";
export type DeviceMode = "webmidi" | "bluetooth" | "mock";

export type ConnectionErrorCode =
  | "unsupported" // no WebMIDI
  | "insecure" // not a secure context
  | "permission" // MIDI/SysEx permission denied
  | "no-sysex"
  | "broken-browser" // Chromium 152 SysEx bug
  | "not-found" // no pedal port
  | "busy" // port present but silent / held by Valeton Suite
  | "timeout"
  | "bootloader" // firmware update mode
  | "unsupported-model" // a pedal of a family this build has no driver for
  | "unknown";

export interface ConnectionError {
  code: ConnectionErrorCode;
  message: string;
  /** Visible MIDI port names, for diagnostics */
  ports?: string[];
}

export interface WriteOptions {
  /** Called with 0..1 while frames are sent and verified */
  onProgress?: (fraction: number) => void;
}

export interface BackupEntry {
  slot: number;
  name: string;
  prst: Uint8Array;
}

export interface RestoreOptions {
  /** Called after each slot is written and verified (done = slots finished so far) */
  onProgress?: (done: number, total: number, slot: number) => void;
  /** Stops before the next slot when aborted */
  signal?: AbortSignal;
}

/** A restore stopped: `done` slots were written and verified, `failed` was not, `notStarted` were never touched. */
export class RestoreError extends Error {
  constructor(
    message: string,
    public done: number[],
    public failed: number | null,
    public notStarted: number[],
    public cause?: unknown,
  ) {
    super(message);
    this.name = "RestoreError";
  }
}

export interface DeviceState {
  mode: DeviceMode;
  status: ConnectionStatus;
  error: ConnectionError | null;
  /** MIDI port of the open connection; while connecting (and after a failed attempt) the port being tried */
  portName: string | null;
  /**
   * Pedal model: the connected one, else the last one connected (persisted across launches), null before the first
   * connection. Writes always go through the session, which checks the real model; this drives copy and defaults.
   */
  device: DeviceKey | null;
  /** Slot names, profileFor(device).slotCount of them (cached; shown before the device answers) */
  names: SlotName[];
  /** Active slot on the pedal */
  slot: number | null;
  /** Live state of the active preset (edits apply here and on the pedal immediately) */
  preset: PresetState | null;
  /** The preset as last read/saved, for "Compare with saved" and the unsaved-changes count */
  saved: PresetState | null;
  /** Number of differing params/blocks between preset and saved */
  unsavedChanges: number;
  globals: Globals | null;
  /** Global EQ of the connected (or last connected) GP-200 family pedal; null on other models */
  globalEq: GlobalEq | null;
  /** Firmware the pedal reports in its settings (e.g. "1.1.0"), when known */
  firmware: string | null;
  /** Optional capabilities usable now (connected model, simulator or the "Experimental pedal commands" setting) */
  features: readonly DeviceFeature[];
  /** Capabilities the connected pedal has but that stay off until "Experimental pedal commands" is turned on */
  lockedFeatures: readonly DeviceFeature[];
  /** Mirror of the "Experimental pedal commands" app setting (stored as gp50Extras) */
  gp50Extras: boolean;
  /** SnapTone slot names (user + factory), when read */
  snapTones: SlotName[] | null;
  /** User IR slot names (1-based display), when read */
  userIRs: SlotName[] | null;
  /** A long job (backup/write) is running; screens disable conflicting actions */
  busy: null | { kind: "backup" | "write" | "restore" | "sync" | "snaptone" | "userir" | "manage"; progress: number; label: string };

  // diagnostics (Device screen)
  /** Why the last session ended: the user disconnected, or the port went away */
  disconnectReason: "user" | "lost" | null;
  /** When the current session connected (ms) */
  connectedAt: number | null;
  /** When a session last connected (persisted across launches) */
  lastConnectedAt: number | null;
  /** All records of the last 0x10 globals reply, including the ones the toolkit can't name */
  globalRecords: GlobalRecord[] | null;
  /** Last failed request on a live session; cleared by a successful sync */
  lastError: RequestError | null;
  /** OS-side checks from the host (USB, driver, Suite), refreshed on every connect attempt */
  hostStatus: DeviceHostStatus | null;
  /** Live MIDI monitor on/off (not remembered between launches) */
  monitor: boolean;
  /** Changes whenever the monitor log changes; read the lines with `getMidiLog()` */
  midiLogVersion: number;
  setMonitor(on: boolean): void;
  clearMidiLog(): void;
  /** Run the host checks again (Check again) */
  checkHost(): Promise<DeviceHostStatus | null>;
  /** Stop a connection attempt in progress */
  cancelConnect(): Promise<void>;
  clearLastError(): void;
  /** True when `feature` is usable now (see `features`) */
  can(feature: DeviceFeature): boolean;
  /** Apply the "Experimental pedal commands" setting (the Settings screen saves it; this re-gates the features) */
  setGp50Extras(on: boolean): void;

  // connection
  connect(mode?: DeviceMode, opts?: { mockDevice?: DeviceKey }): Promise<void>;
  disconnect(): Promise<void>;
  /** Re-read names, slot and the active preset */
  sync(): Promise<void>;

  // live edits (play on the pedal immediately; coalesced per block/param)
  selectSlot(slot: number): Promise<void>;
  setParam(block: number, paramIndex: number, value: number): void;
  setBlockEnabled(block: number, on: boolean): void;
  /** Changes the model; the pedal loads the model's defaults, the store re-reads the body */
  setModel(block: number, fxid: number): Promise<void>;
  /** Chain order; live where the pedal takes it (liveOrder), else it reaches the pedal on save */
  setOrder(order: number[]): void;
  setVolume(volume: number): void;
  /** Tempo, clamped to profileFor(device).tempo; live where the pedal takes it (liveBpm), else it reaches the pedal on save */
  setBpm(bpm: number): void;
  /** EXP settings of the active preset (needs the "exp" feature); every value is checked first (RangeError) */
  setExp(edit: ExpEdit): void;
  /**
   * Switch assignments, one block list per switch (PresetState.footswitches); live where the pedal takes it
   * (liveFootswitches), else on save. GP-50 presets allow at most 3 blocks per switch and a block on one switch only:
   * anything else throws RangeError and changes nothing.
   */
  setFootswitches(lists: number[][]): void;
  /** GP-200 family patch fields (FX loop, pan, style, author, note, EXP, Quick Access); they reach the pedal on save */
  editPatch(edit: Gp200Edit): void;
  /** Revert live state to `saved` (sends the saved preset back to the pedal) */
  discard(): Promise<void>;

  // memory writes (callers MUST confirm with the user first)
  saveToSlot(slot: number, name?: string): Promise<void>;
  rename(slot: number, name: string): Promise<void>;
  writePreset(slot: number, prst: Uint8Array, opts?: WriteOptions): Promise<void>;
  readPreset(slot: number): Promise<Uint8Array>;
  backupAll(opts?: WriteOptions): Promise<BackupEntry[]>;
  /** Reset `slots` to the empty preset (deletePreset feature), then re-read the names */
  deletePresets(slots: number[]): Promise<void>;
  /** Copy the preset of slot `from` onto slot `to` inside the pedal (copyPreset feature) */
  copyPreset(from: number, to: number): Promise<void>;
  /** Move the preset of slot `from` to slot `to`; the slots in between shift by one (movePreset feature) */
  movePreset(from: number, to: number): Promise<void>;
  setGlobal(name: GlobalName, value: number): void;
  /** One Global EQ value (globalEq feature), clamped to its range; sent live like the settings. RangeError for an unused index */
  setGlobalEq(index: number, value: number): void;
  readSnapTones(): Promise<SlotName[]>;
  readUserIRs(): Promise<SlotName[]>;
  /**
   * Upload a 2696-byte SnapTone file into a user SnapTone slot (profile snapTone.userRange), then re-read the SnapTone list.
   * Replaces whatever the slot holds (SnapTones can't be read back): callers MUST confirm with the user first.
   * Resolves with the name as stored on the pedal.
   */
  uploadSnapTone(slot: number, name: string, file: Uint8Array, opts?: WriteOptions): Promise<string>;
  /**
   * Upload a 2048-byte User IR data block (userir/convert.ts) into a User IR slot (0-based table index),
   * then re-read the User IR list. Replaces whatever the slot holds (IRs can't be read back): callers MUST confirm
   * with the user first. Resolves with the name as stored on the pedal.
   */
  uploadUserIr(slot: number, name: string, data: Uint8Array, opts?: WriteOptions): Promise<string>;
  /**
   * Write several presets (a backup) slot by slot, each acknowledged and verified by read-back (3 attempts).
   * Callers MUST confirm with the user first. Throws RestoreError naming done / failed / not started slots.
   */
  restoreAll(entries: BackupEntry[], opts?: RestoreOptions): Promise<void>;
}
