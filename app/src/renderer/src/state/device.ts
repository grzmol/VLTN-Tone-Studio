// Device layer: one DeviceDriver per app; every request goes through it one at a time, live edits are coalesced, and
// memory writes run only after the user confirmed them. Screens use `useDevice`.
import { create } from "zustand";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { host } from "@/host";
import { deviceForPortName, profileFor, type DeviceProfile } from "@shared/devices";
import { pedalOnUsb } from "@shared/host/device";
import { refineConnectionError, toConnectionError } from "./connection-error";
import { DIR_LABEL, MidiLogDecoder, hex, midiLog, pushMidiLog } from "./midi-log";
import { deviceLogEntries, sessionLog } from "./session-log";
import { DEFAULT_DEVICE, gateFeatures, isGp5Family, pedalName, pedalNameOrBoth, profileOrDefault } from "./device-model";
import { cacheNames, loadCachedNames, loadDevice, loadLastConnected, saveDevice, saveLastConnected } from "./device-storage";
import { openPort, simulate } from "./driver";
import { clampGp200Eq } from "./driver/gp200-globals";
import type { DeviceDriver, DriverEvent } from "./driver/types";
import { clampParamValue, editPrst, orderError, syncParams, toPresetState } from "./preset-codec";
import { SendQueue } from "./send-queue";
import { diffPresets } from "./unsaved-diff";
import {
  RestoreError,
  type ConnectionError,
  type DeviceFeature,
  type DeviceKey,
  type DeviceMode,
  type DeviceState,
  type MidiLogEntry,
  type ParamInfo,
  type PresetEdits,
  type PresetState,
  type SlotName,
} from "./device-types";

export class DeviceError extends Error {
  constructor(
    public code: "not-connected" | "unsaved" | "busy" | "verify" | "timeout" | "unsafe" | "closed" | "length",
    message: string,
  ) {
    super(message);
    this.name = "DeviceError";
  }
}

const RESYNC_DEBOUNCE_MS = 400;
const MAX_RECONNECTS = 3;
/** While the pedal is missing (desktop only), poll the host's USB list this often and connect when a pedal appears. */
const WATCH_MS = 4000;
const LOG_NOTIFY_MS = 120;
/** Pedal echoes of a setting edited here within this window are not applied (they would undo newer values). */
const ECHO_GRACE_MS = 1500;

// ------------------------------------------------------------------------------------------- store

let driver: DeviceDriver | null = null;
/** Model the simulator plays; kept for later `connect("mock")` calls in this session. */
let mockDevice: DeviceKey = DEFAULT_DEVICE;
let reconnects = 0;
let userDisconnected = false;
let resyncTimer: number | undefined;
const listTimers: Partial<Record<"presets" | "snaptones" | "irs", number>> = {};
/** When a setting/global/assignment was last edited here (key → ms), to recognise the pedal's echoes. */
const localEdits = new Map<string, number>();
/** A connection attempt the user cancelled; checked after every await in connect(). */
let connectAttempt = 0;
let watchTimer: number | undefined;
/** MIDI monitor lines (only filled while the monitor is on). */
let logNotifyTimer: number | undefined;
/** Frames the pedal sent; every driver logs each incoming frame, unreadable ones too. */
let rxFrames = 0;

/** Advanced access for diagnostics and tests (the open connection); not for screens' normal use. */
export const getDriver = () => driver;
/** MIDI monitor lines, oldest first (re-read when `midiLogVersion` changes). */
export const getMidiLog = (): MidiLogEntry[] => [...midiLog];

export const useDevice = create<DeviceState>((set, get) => {
  const requireDriver = () => {
    if (!driver || get().status !== "connected") throw new DeviceError("not-connected", `The ${pedalName(get().device)} is not connected`);
    return driver;
  };
  const requireIdle = () => {
    const busy = get().busy;
    if (busy) throw new DeviceError("busy", `Wait until the ${busy.kind} finishes`);
  };
  const guardUnsaved = (what: string) => {
    if (get().unsavedChanges > 0) throw new DeviceError("unsaved", `${what} switches presets on the pedal; save or discard the unsaved changes first`);
  };
  const isLive = () => driver !== null && get().status === "connected";
  /** The open driver when `feature` is usable on a live connection, else null. */
  const liveWith = (feature: DeviceFeature) => (isLive() && get().features.includes(feature) ? driver : null);
  const requireFeature = (feature: DeviceFeature) => {
    const d = requireDriver();
    if (get().features.includes(feature)) return d;
    const locked = get().lockedFeatures.includes(feature);
    throw new DeviceError("unsafe", locked ? "This needs Experimental pedal commands, which you can turn on in Settings." : `The ${pedalName(get().device)} can't do this from Tone Studio.`);
  };

  /** Replace the live preset (and optionally the saved copy) and recount changes. */
  const setPreset = (preset: PresetState, saved?: PresetState) => {
    const s = saved ?? get().saved;
    set({ preset, ...(saved ? { saved } : {}), unsavedChanges: s ? diffPresets(s, preset).length : 0 });
  };

  /** The preset in `prst` as read from (or written to) the connected pedal, which names the model of a GP-200 family file. */
  const stateOf = (slot: number, prst: Uint8Array) => toPresetState(slot, prst, driver?.device ?? get().device);

  /** Apply edits to the live preset (the codec validates: RangeError on an illegal order or switch set, nothing changes). */
  const editLocal = (edits: PresetEdits) => {
    const p = get().preset;
    if (!p) return;
    setPreset(toPresetState(p.slot, editPrst(p.prst, edits), p.device));
  };

  /** Remember a failed request on a live session (inline error line + diagnostic report). */
  const noteError = (e: unknown) => {
    const err = e as { code?: string; message?: string };
    set({ lastError: { code: err?.code ?? "unknown", message: err?.message ?? String(e), at: Date.now() } });
  };

  /** Coalesced live edits: newest value per key, one send in flight per key. */
  const sends = new SendQueue(noteError);
  const touch = (key: string) => localEdits.set(key, Date.now());
  const isEcho = (key: string) => sends.busy(key) || Date.now() - (localEdits.get(key) ?? 0) < ECHO_GRACE_MS;

  const setNames = (names: SlotName[]) => {
    cacheNames(get().device, names);
    set({ names });
  };

  const setFeatures = (d: DeviceDriver | null, mode = get().mode, extras = get().gp50Extras) => {
    const { features, locked } = gateFeatures(d?.features ?? [], mode, extras, profileOrDefault(d?.device ?? null).family);
    set({ features, lockedFeatures: locked });
  };

  const logDecoder = new MidiLogDecoder(
    (block, index) => get().preset?.blocks[block]?.model?.params.find((p) => p.index === index)?.name,
    () => driver?.device ?? get().device,
  );
  /**
   * Driver `log` hook: every frame goes into the session log (decoded text plus all bytes in hex); the monitor records
   * it only while it is on, and the UI re-reads at most every LOG_NOTIFY_MS.
   */
  const onLog = (dir: string, bytes: Uint8Array, decoded?: unknown) => {
    if (dir === "rx" || dir === "rx-bad") rxFrames++;
    const line = logDecoder.line(dir, bytes, decoded);
    if (!line) return;
    sessionLog(DIR_LABEL[line.dir], `${line.text}${line.raw ? `  [${line.raw}]` : ""}${bytes.length ? `  ${hex(bytes)}` : ""}`, line.at);
    if (!get().monitor) return;
    pushMidiLog(line);
    if (logNotifyTimer === undefined)
      logNotifyTimer = window.setTimeout(() => {
        logNotifyTimer = undefined;
        set({ midiLogVersion: get().midiLogVersion + 1 });
      }, LOG_NOTIFY_MS);
  };

  const stopWatch = () => {
    clearInterval(watchTimer);
    watchTimer = undefined;
  };
  /**
   * Desktop only: while the pedal is missing or in update mode, watch the host's USB list and connect once a pedal
   * (normal mode) appears. Never runs after the user disconnected on purpose, and never talks to an update-mode device.
   */
  const startWatch = () => {
    if (watchTimer !== undefined || host.kind !== "electron") return;
    let seen = pedalOnUsb(get().hostStatus);
    watchTimer = window.setInterval(async () => {
      const st = get();
      if (userDisconnected || st.mode !== "webmidi" || st.status === "connected" || st.status === "connecting") return stopWatch();
      const status = await st.checkHost();
      const now = pedalOnUsb(status);
      if (now && now !== seen) {
        stopWatch();
        void get().connect("webmidi").catch(() => {});
      }
      seen = now;
    }, WATCH_MS);
  };

  /**
   * The stored copy of the active preset for "saved": the edit buffer itself unless the pedal reports unsaved edits
   * (GP-50). Then the slot is exported when possible; otherwise the previous saved copy of the same slot is kept when
   * `keepPrevious`, else the edit buffer stands in (the count starts at 0).
   */
  const storedCopy = async (d: DeviceDriver, state: PresetState, modified: boolean | null, keepPrevious: boolean): Promise<PresetState> => {
    const has = (f: DeviceFeature) => get().features.includes(f);
    if (!has("modified") || !d.readModified) return state;
    const edited = modified ?? (await d.readModified().catch(() => null));
    if (!edited) return state;
    if (has("exportPreset") && d.exportPreset) {
      const stored = await d.exportPreset(state.slot).catch(() => null);
      if (stored) return stateOf(state.slot, stored);
    }
    const prev = get().saved;
    return keepPrevious && prev && prev.slot === state.slot && prev.device === state.device ? prev : state;
  };

  /** Read the active slot and preset; `checkModified`: ask the pedal whether it holds unsaved edits (see storedCopy). */
  const readActive = async (d: DeviceDriver, names = get().names, checkModified = false) => {
    const { slot, prst } = await d.readActive(names);
    const state = stateOf(slot, prst);
    const saved = checkModified ? await storedCopy(d, state, null, true) : state;
    set({ slot });
    setPreset(state, saved);
  };

  const scheduleResync = () => {
    clearTimeout(resyncTimer);
    resyncTimer = window.setTimeout(() => {
      resyncTimer = undefined;
      if (driver && get().status === "connected" && !get().busy) void readActive(driver, get().names, true).catch(() => {});
    }, RESYNC_DEBOUNCE_MS);
  };

  /** A name list changed on the pedal: re-read it (debounced; a running job re-reads what it changed itself). */
  const scheduleListRead = (list: "presets" | "snaptones" | "irs") => {
    clearTimeout(listTimers[list]);
    listTimers[list] = window.setTimeout(async () => {
      listTimers[list] = undefined;
      const d = driver;
      if (!d || get().status !== "connected" || get().busy) return;
      try {
        if (list === "presets") setNames(await d.readNames());
        else if (list === "snaptones") set({ snapTones: await d.readSnapTones() });
        else set({ userIRs: await d.readUserIRs() });
      } catch (e) {
        noteError(e);
      }
    }, RESYNC_DEBOUNCE_MS);
  };

  /** Pedal-side edits of the active preset; echoes of what this app just sent are skipped. */
  const onPresetEvent = (e: DriverEvent) => {
    const p = get().preset;
    if (!p) return;
    if (e.type === "param") editLocal({ blocks: { [e.block]: { params: { [e.index]: e.value } } } });
    else if (e.type === "block") editLocal({ blocks: { [e.block]: { enabled: e.enabled } } });
    else if (e.type === "patchSetting" && !isEcho(`setting:${e.field}`)) {
      if (e.field === "volume" || e.field === "bpm") editLocal({ [e.field]: e.value });
      else if (p.exp) editLocal({ exp: { [e.field]: e.value } });
    } else if (e.type === "footswitches" && !isEcho("footswitches")) editLocal({ footswitches: [e.fs1, e.fs2] });
    else if (e.type === "order" && !isEcho("order") && orderError(p.device, e.order) === null) editLocal({ order: e.order });
  };

  const onDriverEvent = (e: DriverEvent) => {
    if (e.type === "resync") return scheduleResync();
    if (e.type === "listChanged") return scheduleListRead(e.list);
    if (e.type === "global") {
      if (!isEcho(`global:${e.name}`)) set({ globals: { ...(get().globals ?? {}), [e.name]: e.value } });
      return;
    }
    if (e.type === "globalEq") {
      const eq = get().globalEq;
      if (eq) set({ globalEq: { values: eq.values.map((v, i) => (e.values[i] === undefined || isEcho(`eq:${i}`) ? v : e.values[i])), read: eq.read || e.all } });
      return;
    }
    try {
      onPresetEvent(e);
    } catch (err) {
      // A value the preset can't hold (a newer firmware's range): keep the preset, note it for diagnostics.
      noteError(err);
    }
  };

  const attach = async (d: DeviceDriver, mode: DeviceMode) => {
    const rxBefore = rxFrames;
    d.subscribe(onDriverEvent);
    driver = d;
    try {
      const snap = await d.sync();
      setFeatures(d, mode);
      cacheNames(snap.device, snap.names);
      saveDevice(snap.device);
      // GP-200 family models come from the user's catalog: read it before describing the preset (load() never rejects;
      // a later import or removal re-describes it through the subscription below).
      if (profileFor(snap.device).family === "gp200" && !useGp200Catalog.getState().loaded) await useGp200Catalog.getState().load();
      const state = stateOf(snap.slot, snap.prst);
      const saved = await storedCopy(d, state, snap.modified ?? null, false);
      reconnects = 0;
      const now = Date.now();
      saveLastConnected(now);
      set({
        mode,
        status: "connected",
        error: null,
        portName: d.portName,
        device: snap.device,
        names: snap.names,
        slot: snap.slot,
        globals: snap.globals?.values ?? null,
        globalEq: snap.globals?.eq ?? null,
        globalRecords: snap.globals?.records ?? null,
        firmware: snap.globals?.firmware ?? null,
        snapTones: null,
        userIRs: null,
        connectedAt: now,
        lastConnectedAt: now,
        disconnectReason: null,
        lastError: null,
      });
      setPreset(state, saved);
    } catch (e) {
      driver = null;
      setFeatures(null);
      await d.close().catch(() => {});
      // Anything the pedal sent, even a reply the handshake didn't wait for, means the port isn't silent ("busy"); a
      // pedal that already identified itself and then stalls is no wrong device.
      throw toConnectionError(e, rxFrames > rxBefore, d.device ?? deviceForPortName(d.portName) ?? get().device, d.device !== null);
    }
  };

  const onPortLost = () => {
    const d = driver;
    driver = null;
    sends.clear();
    void d?.close().catch(() => {});
    set({ status: "disconnected", portName: null, busy: null, connectedAt: null, disconnectReason: "lost", features: [], lockedFeatures: [] });
    if (!userDisconnected && get().mode === "webmidi" && reconnects < MAX_RECONNECTS) {
      reconnects++;
      setTimeout(() => void get().connect("webmidi").catch(() => {}), 1000 * reconnects);
    } else startWatch();
  };

  /** Run an upload with busy progress, then re-read the slot table it changed. */
  const upload = async (kind: "snaptone" | "userir", label: string, send: (onProgress: (done: number, total: number) => void) => Promise<string>, reread: () => Promise<unknown>, onProgress?: (f: number) => void) => {
    requireIdle();
    set({ busy: { kind, progress: 0, label } });
    try {
      const stored = await send((done, total) => {
        set({ busy: { kind, progress: done / total, label } });
        onProgress?.(done / total);
      });
      await reread();
      return stored;
    } catch (e) {
      noteError(e);
      throw e;
    } finally {
      set({ busy: null });
    }
  };

  /**
   * A preset-management command inside the pedal (delete / copy / move) touching `affected` slots: refuses to change
   * the active slot while it has unsaved edits, then re-reads the names and, when it was affected, the active preset.
   */
  const manage = async (d: DeviceDriver, label: string, affected: number[], run: (progress: (f: number) => void) => Promise<void>) => {
    requireIdle();
    const active = get().slot;
    const touchesActive = active !== null && affected.includes(active);
    if (touchesActive && get().unsavedChanges > 0) throw new DeviceError("unsaved", "This changes the active preset on the pedal; save or discard the unsaved changes first");
    set({ busy: { kind: "manage", progress: 0, label } });
    try {
      await run((progress) => set({ busy: { kind: "manage", progress, label } }));
    } catch (e) {
      noteError(e);
      throw e;
    } finally {
      if (driver === d) {
        const names = await d.readNames().catch(() => null);
        if (names) setNames(names);
        if (touchesActive) await readActive(d).catch(noteError);
      }
      set({ busy: null });
    }
  };

  /** Sync toggle on a GP-50 block: the pedal resets the bound Time/Rate, so show what it reports after the toggle. */
  const toggleSync = (p: PresetState, block: number, toggle: ParamInfo, on: boolean) => {
    // Locally the same reset the pedal does (division 1/4 on, the param's default off), so offline edits read right.
    editLocal({ blocks: { [block]: { params: syncParams(p, block, toggle, on) } } });
    if (!isLive()) return;
    const d = driver!;
    const key = `param:${block}:${toggle.index}`;
    const synced = liveWith("sync");
    if (!synced?.setSync) return sends.push(key, () => d.setParam(block, toggle.index, on ? 1 : 0));
    sends.push(key, async () => {
      const fresh = toPresetState(p.slot, await synced.setSync!(block, toggle.index, on, get().preset?.name ?? p.name), p.device).blocks[block].params;
      // Refresh the block from the re-read body, except params with an edit still on its way.
      const params = Object.fromEntries(fresh.flatMap((v, i) => (sends.busy(`param:${block}:${i}`) ? [] : [[i, v]])));
      editLocal({ blocks: { [block]: { params } } });
    });
  };

  // GP-200 family models come from the catalog in use: describe the open preset again when an import replaces it.
  useGp200Catalog.subscribe((c, prev) => {
    const { preset, saved } = get();
    if (c.catalog === prev.catalog || !preset?.gp200) return;
    const again = (x: PresetState) => toPresetState(x.slot, x.prst, x.device, c.catalog);
    setPreset(again(preset), saved ? again(saved) : undefined);
  });

  const lastDevice = loadDevice();

  return {
    mode: "webmidi",
    status: "idle",
    error: null,
    portName: null,
    device: lastDevice,
    names: loadCachedNames(lastDevice),
    slot: null,
    preset: null,
    saved: null,
    unsavedChanges: 0,
    globals: null,
    globalEq: null,
    firmware: null,
    features: [],
    lockedFeatures: [],
    gp50Extras: false,
    snapTones: null,
    userIRs: null,
    busy: null,
    disconnectReason: null,
    connectedAt: null,
    lastConnectedAt: loadLastConnected(),
    globalRecords: null,
    lastError: null,
    hostStatus: null,
    monitor: false,
    midiLogVersion: 0,

    setMonitor(on) {
      set({ monitor: on });
    },

    clearMidiLog() {
      midiLog.length = 0;
      set({ midiLogVersion: get().midiLogVersion + 1 });
    },

    async checkHost() {
      try {
        const hostStatus = await host.device.status();
        set({ hostStatus });
        return hostStatus;
      } catch {
        return null;
      }
    },

    async cancelConnect() {
      if (get().status !== "connecting") return;
      connectAttempt++;
      userDisconnected = true;
      const d = driver;
      driver = null;
      await d?.close().catch(() => {});
      set({ status: "disconnected", error: null, portName: null, disconnectReason: "user" });
    },

    clearLastError() {
      set({ lastError: null });
    },

    can(feature) {
      return get().features.includes(feature);
    },

    setGp50Extras(on) {
      set({ gp50Extras: on });
      setFeatures(isLive() ? driver : null, get().mode, on);
    },

    async connect(mode = get().mode, opts) {
      if (mode === "bluetooth") throw new Error("Bluetooth editor management is disabled. Connect by USB to manage the pedal. Bluetooth MIDI remains available for performance controls.");
      if (get().status === "connecting") return;
      stopWatch();
      userDisconnected = false;
      if (driver) await get().disconnect();
      userDisconnected = false;
      const attempt = ++connectAttempt;
      const cancelled = () => attempt !== connectAttempt;
      set({ mode, status: "connecting", error: null, portName: null });
      // OS-side checks (USB, driver, Suite) run alongside; they sharpen errors and feed the Diagnostics card.
      const hostCheck = mode === "webmidi" ? get().checkHost() : Promise.resolve(null);
      const driverOpts = { log: onLog, onDisconnect: onPortLost };
      try {
        const settings = await host.app.getSettings().catch(() => null);
        if (settings) set({ gp50Extras: settings.gp50Extras });
        let d: DeviceDriver;
        if (mode === "mock") {
          if (opts?.mockDevice) mockDevice = opts.mockDevice;
          d = await simulate(mockDevice, driverOpts);
        } else {
          d = await openPort(settings?.portPattern || undefined, driverOpts);
        }
        if (cancelled()) {
          await d.close();
          return;
        }
        // The port names the model before it identifies (a sync can take minutes): copy talks about this pedal, not
        // the remembered one. A failed attempt keeps it for the error copy and the report.
        set({ portName: d.portName });
        await attach(d, mode);
      } catch (e) {
        if (cancelled()) return;
        // attach() and the factory throw a ConnectionError; WebMIDI failures are a Gp5ConnectError (an Error) that still needs mapping.
        const base = e instanceof Error ? toConnectionError(e, false, get().device) : (e as ConnectionError);
        const error = refineConnectionError(base, await hostCheck);
        set({ status: "error", error });
        if (mode === "webmidi" && (error.code === "not-found" || error.code === "bootloader")) startWatch();
        throw e;
      }
    },

    async disconnect() {
      userDisconnected = true;
      stopWatch();
      const d = driver;
      driver = null;
      sends.clear();
      await d?.close().catch(() => {});
      set({ status: "disconnected", portName: null, busy: null, connectedAt: null, disconnectReason: "user", features: [], lockedFeatures: [] });
    },

    async sync() {
      const d = requireDriver();
      requireIdle();
      set({ busy: { kind: "sync", progress: 0, label: "Reading the pedal" } });
      try {
        const names = await d.readNames();
        setNames(names);
        await readActive(d, names, true);
        const globals = await d.readGlobals().catch(() => null);
        if (globals) set({ globals: globals.values, globalRecords: globals.records, firmware: globals.firmware ?? get().firmware, globalEq: globals.eq ?? get().globalEq });
        set({ lastError: null });
      } catch (e) {
        noteError(e);
        throw e;
      } finally {
        set({ busy: null });
      }
    },

    async selectSlot(slot) {
      const d = requireDriver();
      requireIdle();
      sends.clear();
      await d.select(slot);
      await readActive(d);
    },

    setParam(block, paramIndex, value) {
      const p = get().preset;
      if (!p) return;
      const info = p.blocks[block]?.model?.params.find((x) => x.index === paramIndex);
      const v = info ? clampParamValue(info, value) : value;
      if (info?.syncs !== undefined && isGp5Family(p.device)) return toggleSync(p, block, info, v >= 0.5);
      editLocal({ blocks: { [block]: { params: { [paramIndex]: v } } } });
      if (!isLive()) return;
      const d = driver!;
      sends.push(`param:${block}:${paramIndex}`, () => d.setParam(block, paramIndex, v));
    },

    setBlockEnabled(block, on) {
      editLocal({ blocks: { [block]: { enabled: on } } });
      if (isLive()) void driver!.setBlockEnabled(block, on).catch(noteError);
    },

    async setModel(block, fxid) {
      const d = requireDriver();
      await d.setModel(block, fxid);
      const p = get().preset!;
      // The pedal loads the model's defaults: re-read the active buffer, keep `saved` as it was.
      setPreset(stateOf(p.slot, await d.readEditBuffer(p.name)));
    },

    // Order, footswitches and tempo change the preset here; they play live where the pedal has a command for them
    // (GP-50 with Experimental pedal commands, GP-200 tempo), and otherwise reach the pedal with the full write on save.
    setOrder(order) {
      editLocal({ order });
      touch("order");
      const d = liveWith("liveOrder");
      if (d?.setOrder) sends.push("order", () => d.setOrder!(order));
    },

    setFootswitches(lists) {
      if (!get().preset) return;
      editLocal({ footswitches: lists });
      touch("footswitches");
      const d = liveWith("liveFootswitches");
      if (d?.setFootswitches) sends.push("footswitches", () => d.setFootswitches!(lists[0], lists[1]));
    },

    editPatch(edit) {
      editLocal({ gp200: edit });
    },

    setVolume(volume) {
      editLocal({ volume });
      touch("setting:volume");
      if (!isLive()) return;
      const d = driver!;
      sends.push("setting:volume", () => d.setPatchVolume(volume));
    },

    setBpm(bpm) {
      const p = get().preset;
      if (!p) return;
      const { min, max } = profileFor(p.device).tempo;
      const v = Math.max(min, Math.min(max, Math.round(bpm)));
      if (v === p.bpm) return;
      editLocal({ bpm: v });
      touch("setting:bpm");
      const d = liveWith("liveBpm");
      if (d?.setBpm) sends.push("setting:bpm", () => d.setBpm!(v));
    },

    setExp(edit) {
      const p = get().preset;
      if (!p?.exp) throw new DeviceError("unsafe", `${p ? `${pedalName(p.device)} presets have` : "This preset has"} no EXP settings`);
      const d = requireFeature("exp");
      editLocal({ exp: edit });
      for (const [field, value] of Object.entries(edit)) {
        touch(`setting:${field}`);
        sends.push(`setting:${field}`, () => d.setExp!({ [field]: value }));
      }
    },

    async discard() {
      const d = requireDriver();
      requireIdle();
      sends.clear();
      await d.reloadSlot(get().slot!);
      await readActive(d);
    },

    async saveToSlot(slot, name) {
      const p = get().preset;
      if (!p) throw new DeviceError("not-connected", "No preset loaded");
      const prst = name !== undefined && name !== p.name ? editPrst(p.prst, { name }) : p.prst;
      // A full write keeps everything (order, footswitches, tempo and EXP may have been edited without a live command).
      await get().writePreset(slot, prst);
    },

    async rename(slot, name) {
      const d = requireDriver();
      requireIdle();
      // A GP-200 renames its active slot by saving the edit buffer under the new name: unsaved edits would go with it.
      const p = get().preset;
      if (p?.gp200 && p.slot === slot && get().unsavedChanges > 0)
        throw new DeviceError("unsaved", "Renaming the active preset saves it on the pedal; save or discard the unsaved changes first");
      await d.rename(slot, name);
      setNames(get().names.map((n) => (n.slot === slot ? { ...n, name } : n)));
      const { preset, saved } = get();
      if (preset?.slot === slot && saved) {
        const rename = (x: PresetState) => toPresetState(slot, editPrst(x.prst, { name }), x.device);
        setPreset(rename(preset), rename(saved));
      }
    },

    async writePreset(slot, prst, opts) {
      const d = requireDriver();
      requireIdle();
      const label = `Writing slot ${slot}`;
      set({ busy: { kind: "write", progress: 0, label } });
      try {
        await d.writePreset(slot, prst, {
          onProgress: (done, total) => {
            const f = done / total;
            set({ busy: { kind: "write", progress: f, label } });
            opts?.onProgress?.(f);
          },
        });
        const written = stateOf(slot, prst);
        setNames(get().names.map((n) => (n.slot === slot ? { ...n, name: written.name } : n)));
        // writePreset verifies by selecting `slot`, so it is now the active preset.
        set({ slot });
        setPreset(written, written);
      } finally {
        set({ busy: null });
      }
    },

    async readPreset(slot) {
      const d = requireDriver();
      const p = get().preset;
      if (p && p.slot === slot) return p.prst;
      requireIdle();
      // The export read leaves the active preset (and its unsaved edits) alone.
      if (get().features.includes("exportPreset") && d.exportPreset) return d.exportPreset(slot);
      guardUnsaved("Reading another slot");
      const original = get().slot;
      const prst = await d.readPreset(slot, get().names);
      if (original !== null) {
        await d.select(original);
        await readActive(d);
      }
      return prst;
    },

    async backupAll(opts) {
      const d = requireDriver();
      requireIdle();
      guardUnsaved("A backup");
      set({ busy: { kind: "backup", progress: 0, label: `Backing up ${profileOrDefault(get().device).slotCount} slots` } });
      try {
        const entries = await d.backupAll({
          onProgress: (done, total) => {
            const f = done / total;
            set({ busy: { kind: "backup", progress: f, label: `Backing up slot ${done} of ${total}` } });
            opts?.onProgress?.(f);
          },
        });
        await readActive(d);
        return entries;
      } finally {
        set({ busy: null });
      }
    },

    async deletePresets(slots) {
      const d = requireFeature("deletePreset");
      const label = slots.length === 1 ? `Clearing slot ${slots[0]}` : `Clearing ${slots.length} slots`;
      await manage(d, label, slots, async (progress) => {
        for (const [i, slot] of slots.entries()) {
          await d.deletePreset!(slot);
          progress((i + 1) / slots.length);
        }
      });
    },

    async copyPreset(from, to) {
      const d = requireFeature("copyPreset");
      await manage(d, `Copying slot ${from} to slot ${to}`, [to], () => d.copyPreset!(from, to));
    },

    async movePreset(from, to) {
      const d = requireFeature("movePreset");
      const affected = Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => Math.min(from, to) + i);
      await manage(d, `Moving slot ${from} to slot ${to}`, affected, () => d.movePreset!(from, to));
    },

    setGlobal(name, value) {
      const d = requireDriver();
      const v = d.clampGlobal(name, value);
      set({ globals: { ...(get().globals ?? {}), [name]: v } });
      touch(`global:${name}`);
      sends.push(`global:${name}`, () => d.setGlobal(name, v));
    },

    setGlobalEq(index, value) {
      const d = requireFeature("globalEq");
      const eq = get().globalEq;
      if (!eq) return;
      const v = clampGp200Eq(index, value);
      set({ globalEq: { ...eq, values: eq.values.map((x, i) => (i === index ? v : x)) } });
      touch(`eq:${index}`);
      sends.push(`eq:${index}`, () => d.setGlobalEq!(index, v));
    },

    async readSnapTones() {
      const list = await requireDriver().readSnapTones();
      set({ snapTones: list });
      return list;
    },

    async uploadSnapTone(slot, name, file, opts) {
      const d = requireDriver();
      const send = (onProgress: (done: number, total: number) => void) => d.uploadSnapTone(slot, name, file, { onProgress });
      return upload("snaptone", `Writing SnapTone slot ${slot}`, send, () => get().readSnapTones(), opts?.onProgress);
    },

    async readUserIRs() {
      const list = await requireDriver().readUserIRs();
      set({ userIRs: list });
      return list;
    },

    async uploadUserIr(slot, name, data, opts) {
      const d = requireDriver();
      // The pedal, Suite and the UI number User IRs from 1 ("User IR 1" = slot 0).
      const send = (onProgress: (done: number, total: number) => void) => d.uploadUserIr(slot, name, data, { onProgress });
      return upload("userir", `Writing User IR ${slot + 1}`, send, () => get().readUserIRs(), opts?.onProgress);
    },

    async restoreAll(entries, opts) {
      const d = requireDriver();
      requireIdle();
      guardUnsaved("A restore");
      const slots = entries.map((e) => e.slot);
      const done: number[] = [];
      const total = entries.length;
      const label = (i: number) => `Restoring slot ${entries[i].slot} (${i + 1} of ${total})`;
      set({ busy: { kind: "restore", progress: 0, label: total ? label(0) : "Restoring" } });
      try {
        for (let i = 0; i < total; i++) {
          if (opts?.signal?.aborted) throw new RestoreError("Restore cancelled", done, null, slots.slice(i));
          const { slot, prst } = entries[i];
          set({ busy: { kind: "restore", progress: i / total, label: label(i) } });
          try {
            await d.writePreset(slot, prst, {
              attempts: 3,
              onProgress: (f, n) => set({ busy: { kind: "restore", progress: (i + f / n) / total, label: label(i) } }),
            });
          } catch (e) {
            noteError(e);
            throw new RestoreError(`Slot ${slot} failed: ${(e as Error)?.message ?? e}`, done, slot, slots.slice(i + 1), e);
          }
          done.push(slot);
          opts?.onProgress?.(done.length, total, slot);
        }
      } finally {
        // Names changed on the pedal: refresh them and the active preset, whatever happened.
        if (driver === d) {
          const names = await d.readNames().catch(() => null);
          if (names) setNames(names);
          await readActive(d).catch(noteError);
        }
        set({ busy: null });
      }
    },
  };
});

useDevice.subscribe((s, p) => {
  for (const [kind, text] of deviceLogEntries(p, s)) sessionLog(kind, text);
});

/** "GP-5" / "GP-50" for the connected (or last connected) pedal; "pedal" before the first connection. */
export const usePedalName = (): string => useDevice((s) => pedalName(s.device));

/** The connected (or last connected) pedal's name; "GP-5 / GP-50" before the first connection. */
export const usePedalNameOrBoth = (): string => useDevice((s) => pedalNameOrBoth(s.device));

/** Profile (geometry, labels) of the connected (or last connected) pedal; DEFAULT_DEVICE's before the first connection. */
export const useProfile = (): DeviceProfile => useDevice((s) => profileOrDefault(s.device));
