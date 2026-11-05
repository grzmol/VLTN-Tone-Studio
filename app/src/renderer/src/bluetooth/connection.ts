import { create } from "zustand";
import { BLE_MTU, BleMidiDecoder, BlePacketBuilder, checkMidiMessage, MIDI_CHARACTERISTIC, MIDI_SERVICE } from "./ble-midi";

// Narrow Web Bluetooth types: not yet part of TypeScript's DOM library.
interface Characteristic extends EventTarget {
  value?: DataView;
  properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean };
  startNotifications(): Promise<Characteristic>;
  stopNotifications(): Promise<Characteristic>;
  writeValueWithResponse(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValueWithoutResponse(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}
export interface BleDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>;
    disconnect(): void;
  };
}
interface BluetoothApi {
  requestDevice(options: { filters: ({ services: string[] } | { namePrefix: string })[]; optionalServices: string[] }): Promise<BleDevice>;
}
type Listener = (bytes: Uint8Array) => void;
export interface BluetoothDiagnostics {
  device: string;
  writes: number;
  notifications: number;
  messages: number;
  /** Performance messages discarded because they were over {@link LATE_DROP_MS} late when they reached the radio. */
  dropped: number;
  /** Times the link was restored automatically after being lost. */
  reconnects: number;
  performanceTiming?: { commands: number; maxLateMs: number; maxWriteMs: number };
  clockTiming?: { pulses: number; maxLateMs: number; maxWriteMs: number; minIntervalMs: number; maxIntervalMs: number };
}
export const useBluetooth = create<{
  connection: BleMidiConnection | null;
  connecting: boolean;
  error: string | null;
  diagnostics: BluetoothDiagnostics | null;
  /** Set while the link is being restored after a loss; `attempt` is the one waiting or in progress. */
  reconnect: { attempt: number } | null;
}>(() => ({ connection: null, connecting: false, error: null, diagnostics: null, reconnect: null }));

/** A performance message older than this when it reaches the radio is dropped; the link stays open. */
export const LATE_DROP_MS = 250;
/** Coalescing window: messages arriving within it share a packet. Write-with-response is a round trip, so batch harder. */
const FLUSH_MS = 8;
const FLUSH_WITH_RESPONSE_MS = 16;
const WRITE_TIMEOUT_MS = 1000;
const MAX_PENDING = 256;
const RECONNECT_FIRST_MS = 500;
const RECONNECT_MAX_MS = 30_000;

interface Outgoing {
  bytes: number[];
  /** Intended send time (performance.now() clock); becomes the BLE-MIDI timestamp. */
  timestamp: number;
  editor: boolean;
  generation: number;
}

export class BleMidiConnection {
  readonly id = "bluetooth-midi";
  get name() {
    return this.device.name || "Bluetooth MIDI";
  }
  get state(): "connected" | "disconnected" {
    return !this.closed && this.device.gatt?.connected ? "connected" : "disconnected";
  }
  private closed = false;
  /** Set once setup finished; a link lost before that is a failed connect, not something to retry. */
  private established = false;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<Listener>();
  private disconnectListeners = new Set<() => void>();
  /** Messages waiting for their timestamp, in timestamp order (equal timestamps in send order). One timer serves the head. */
  private timed: Outgoing[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Outgoing[] = [];
  private pendingBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private drainQueued = false;
  private generation = 0;
  private decoder = new BleMidiDecoder();
  private diagnostics: BluetoothDiagnostics;
  /** The object last put in the store; a newer session replaces it, and then this one stops publishing. */
  private published: BluetoothDiagnostics;
  private publishQueued = false;
  private timingGeneration = 0;
  private lastClockWrite: number | null = null;
  private hasClockInterval = false;
  private constructor(
    readonly device: BleDevice,
    private characteristic: Characteristic,
    previous?: BluetoothDiagnostics,
  ) {
    this.diagnostics = previous
      ? { ...previous, device: this.name, reconnects: previous.reconnects + 1 }
      : { device: this.name, writes: 0, notifications: 0, messages: 0, dropped: 0, reconnects: 0 };
    this.published = this.diagnostics;
    useBluetooth.setState({ diagnostics: this.diagnostics });
  }
  private record(
    counts: Partial<Pick<BluetoothDiagnostics, "writes" | "notifications" | "messages" | "dropped" | "clockTiming" | "performanceTiming">>,
    immediately = false,
  ) {
    this.diagnostics = { ...this.diagnostics, ...counts };
    if (immediately) return this.publish();
    // One flush records several counters back to back; publish them together so subscribers render once.
    if (this.publishQueued) return;
    this.publishQueued = true;
    queueMicrotask(() => this.publish());
  }
  private publish() {
    this.publishQueued = false;
    // Keep the last session's evidence after cleanup without overwriting a newer session.
    if (useBluetooth.getState().diagnostics !== this.published) return;
    this.published = this.diagnostics;
    useBluetooth.setState({ diagnostics: this.diagnostics });
  }
  /** Open the GATT link and MIDI characteristic. `previous` carries the counters over when restoring a lost link. */
  static async open(device: BleDevice, previous?: BluetoothDiagnostics, signal?: AbortSignal): Promise<BleMidiConnection> {
    try {
      const server = await device.gatt?.connect();
      if (!server) throw new Error("The selected device has no Bluetooth GATT server.");
      signal?.throwIfAborted();
      const service = await server.getPrimaryService(MIDI_SERVICE);
      const characteristic = await service.getCharacteristic(MIDI_CHARACTERISTIC);
      signal?.throwIfAborted();
      if (
        (!characteristic.properties.notify && !characteristic.properties.indicate) ||
        (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse)
      )
        throw new Error("This MIDI characteristic cannot send and receive data.");
      const connection = new BleMidiConnection(device, characteristic, previous);
      characteristic.addEventListener("characteristicvaluechanged", connection.receive);
      device.addEventListener("gattserverdisconnected", connection.lost);
      try {
        await characteristic.startNotifications();
      } catch (e) {
        connection.abandon();
        throw e;
      }
      if (signal?.aborted || connection.state !== "connected") {
        connection.abandon();
        signal?.throwIfAborted();
        throw new Error("Bluetooth disconnected during setup. Keep the device nearby and try connecting again.");
      }
      connection.established = true;
      return connection;
    } catch (e) {
      releaseDevice(device);
      throw e;
    }
  }
  private receive = () => {
    const value = this.characteristic.value;
    if (!value || this.closed) return;
    const messages = this.decoder.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    this.record({ notifications: this.diagnostics.notifications + 1, messages: this.diagnostics.messages + messages.length });
    for (const message of messages) {
      for (const listener of this.listeners) listener(message);
    }
  };
  /** GATT disconnect reported by the radio or the browser. */
  private lost = (event?: Event) => this.teardown({ reconnect: true, radioLost: Boolean(event) });
  /**
   * Stop this session. Listeners are told, the store forgets the connection, and unless the user asked for the
   * disconnect the link is restored in the background. The new session starts disarmed: consumers re-arm it.
   */
  private teardown({ reconnect, radioLost = false }: { reconnect: boolean; radioLost?: boolean }) {
    if (this.closed) return;
    this.closed = true;
    // Publish what a queued flush would have, so the closed session's counters are not lost.
    if (this.publishQueued) this.publish();
    this.clear();
    this.pending = [];
    this.pendingBytes = 0;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.decoder.reset();
    this.characteristic.removeEventListener("characteristicvaluechanged", this.receive);
    this.device.removeEventListener("gattserverdisconnected", this.lost);
    const current = useBluetooth.getState().connection === this;
    if (current)
      useBluetooth.setState({
        connection: null,
        ...(radioLost ? { error: "Bluetooth MIDI disconnected. Reconnecting automatically; check that the device is powered on and nearby." } : {}),
      });
    for (const listener of this.disconnectListeners) listener();
    this.listeners.clear();
    this.disconnectListeners.clear();
    if (reconnect && current && this.established) startBluetoothReconnect(this.device, this.diagnostics);
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onDisconnect(listener: () => void) {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }
  /**
   * Messages are buffered and written together: every few milliseconds, or at once when a packet is full or the message
   * is an editor request. Writes never overlap, and a write that is still running lets the next batch grow.
   * A performance message that is too late when its turn comes is dropped and counted; it never closes the link.
   */
  send(bytes: readonly number[] | Uint8Array, timestamp = performance.now(), editor = false) {
    if (this.state !== "connected") throw new Error("Bluetooth MIDI is disconnected.");
    if (this.pending.length + this.timed.length >= MAX_PENDING) {
      const error = "Bluetooth MIDI cannot keep up. Connection closed; reduce MIDI traffic.";
      if (useBluetooth.getState().connection === this) useBluetooth.setState({ error });
      this.close();
      throw new Error(error);
    }
    const outgoing: Outgoing = { bytes: checkMidiMessage(bytes), timestamp, editor, generation: this.generation };
    // A message is held, not sent at once, while an earlier-timed one is still waiting: sending it first would reorder the pair.
    if (timestamp - performance.now() <= 1 && (editor || !this.timed.length)) this.enqueue(outgoing);
    else this.hold(outgoing);
  }
  /** Insert after every held message due at or before this one, then re-arm the timer for the head. */
  private hold(outgoing: Outgoing) {
    let index = this.timed.length;
    while (index > 0 && this.timed[index - 1].timestamp > outgoing.timestamp) index--;
    this.timed.splice(index, 0, outgoing);
    if (index === 0) this.arm();
  }
  private arm() {
    if (this.timer) clearTimeout(this.timer);
    const head = this.timed[0];
    this.timer = head ? setTimeout(() => this.release(), Math.max(0, head.timestamp - performance.now())) : null;
  }
  /** Move every held message that is due, in order, to the write queue. Timer callbacks can fire out of order, so this is the only release. */
  private release() {
    this.timer = null;
    const now = performance.now();
    while (this.timed.length && this.timed[0].timestamp - now <= 1) {
      const next = this.timed.shift()!;
      if (!this.closed && next.generation === this.generation) this.enqueue(next);
    }
    this.arm();
  }
  private enqueue(outgoing: Outgoing) {
    this.pending.push(outgoing);
    this.pendingBytes += outgoing.bytes.length + 1;
    if (outgoing.editor || this.pendingBytes >= BLE_MTU - 1) this.flushNow();
    else if (!this.flushTimer) {
      const interval = this.characteristic.properties.writeWithoutResponse ? FLUSH_MS : FLUSH_WITH_RESPONSE_MS;
      this.flushTimer = setTimeout(() => this.flushNow(), interval);
    }
  }
  private flushNow() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.drainQueued || !this.pending.length) return;
    this.drainQueued = true;
    this.chain = this.chain.then(() => this.drain()).catch((e) => this.fail(`Bluetooth write failed: ${String(e)}`));
  }
  /** A write error or timeout: report it, drop the session and let the link be restored. */
  private fail(error: string) {
    // A rejected write can arrive after this session was closed and replaced.
    if (this.closed) return;
    useBluetooth.setState({ error });
    this.teardown({ reconnect: true });
    this.device.gatt?.disconnect();
  }
  /** Split into runs written one packet-set at a time; a SysEx is its own run so clear() cannot cut it in half. */
  private runs(entries: Outgoing[]) {
    const runs: Outgoing[][] = [];
    for (const entry of entries) {
      const last = runs.at(-1);
      const sysex = entry.bytes[0] === 0xf0;
      if (last && !sysex && last[0].bytes[0] !== 0xf0 && last[0].editor === entry.editor) last.push(entry);
      else runs.push([entry]);
    }
    return runs;
  }
  private async drain() {
    this.drainQueued = false;
    const entries = this.pending.splice(0);
    this.pendingBytes = 0;
    for (const run of this.runs(entries)) {
      if (this.closed) return;
      // Re-check each run: an earlier write may have been slow, or clear() may have been called meanwhile.
      const now = performance.now();
      const current = run.filter((e) => e.editor || e.generation === this.generation);
      const live = current.filter((e) => e.editor || now - e.timestamp <= LATE_DROP_MS);
      if (live.length < current.length) this.record({ dropped: this.diagnostics.dropped + current.length - live.length });
      if (live.length) await this.write(live);
    }
  }
  private async write(entries: Outgoing[]) {
    const builder = new BlePacketBuilder(BLE_MTU);
    for (const entry of entries) builder.add(entry.bytes, entry.timestamp);
    const packets = builder.flush();
    const started = performance.now();
    const timingGeneration = this.timingGeneration;
    const performanceEntries = entries.filter((e) => !e.editor);
    const clocks = entries.filter((e) => e.bytes.length === 1 && e.bytes[0] === 0xf8);
    if (performanceEntries.length) {
      const previous = this.diagnostics.performanceTiming;
      this.record({
        performanceTiming: {
          commands: (previous?.commands ?? 0) + performanceEntries.length,
          maxLateMs: Math.max(previous?.maxLateMs ?? 0, ...performanceEntries.map((e) => started - e.timestamp)),
          maxWriteMs: previous?.maxWriteMs ?? 0,
        },
      });
    }
    if (clocks.length) {
      const previous = this.diagnostics.clockTiming;
      const interval = this.lastClockWrite === null ? null : started - this.lastClockWrite;
      this.lastClockWrite = started;
      const firstInterval = interval !== null && !this.hasClockInterval;
      if (interval !== null) this.hasClockInterval = true;
      this.record({
        clockTiming: {
          pulses: (previous?.pulses ?? 0) + clocks.length,
          maxLateMs: Math.max(previous?.maxLateMs ?? 0, ...clocks.map((e) => started - e.timestamp)),
          maxWriteMs: previous?.maxWriteMs ?? 0,
          minIntervalMs:
            interval === null ? (previous?.minIntervalMs ?? 0) : firstInterval ? interval : Math.min(previous?.minIntervalMs ?? interval, interval),
          maxIntervalMs: Math.max(previous?.maxIntervalMs ?? 0, interval ?? 0),
        },
      });
    }
    for (const packet of packets) {
      // Once started, complete the message so clear() cannot leave a partial SysEx.
      if (this.closed) return;
      const packetStarted = performance.now();
      // Some adapter failures leave the GATT promise pending indefinitely.
      // Do not retry a command that might already have reached the pedal.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.characteristic.properties.writeWithoutResponse
            ? this.characteristic.writeValueWithoutResponse(packet as Uint8Array<ArrayBuffer>)
            : this.characteristic.writeValueWithResponse(packet as Uint8Array<ArrayBuffer>),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Bluetooth MIDI write timed out; delivery is unknown. Check the pedal state before reconnecting.")),
              WRITE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      if (this.closed) return;
      const took = performance.now() - packetStarted;
      const current = timingGeneration === this.timingGeneration;
      this.record({
        writes: this.diagnostics.writes + 1,
        ...(current && performanceEntries.length && this.diagnostics.performanceTiming
          ? { performanceTiming: { ...this.diagnostics.performanceTiming, maxWriteMs: Math.max(this.diagnostics.performanceTiming.maxWriteMs, took) } }
          : {}),
        ...(current && clocks.length && this.diagnostics.clockTiming
          ? { clockTiming: { ...this.diagnostics.clockTiming, maxWriteMs: Math.max(this.diagnostics.clockTiming.maxWriteMs, took) } }
          : {}),
      });
    }
  }
  resetTiming() {
    this.timingGeneration++;
    this.lastClockWrite = null;
    this.hasClockInterval = false;
    this.record({ performanceTiming: undefined, clockTiming: undefined }, true);
  }
  /** Cancel scheduled and buffered performance messages; editor requests and a SysEx already being written are kept. */
  clear() {
    this.lastClockWrite = null;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timed = [];
    this.pending = this.pending.filter((e) => e.editor);
    this.pendingBytes = this.pending.reduce((sum, e) => sum + e.bytes.length + 1, 0);
  }
  /** Give up on a session that never finished setting up. Unlike close(), this leaves a reconnect in progress alone. */
  private abandon() {
    this.teardown({ reconnect: false });
    releaseDevice(this.device);
  }
  /** Drop a session nobody is using: close its listeners, and the radio link unless the user's own link shares the device. */
  discard() {
    this.teardown({ reconnect: false });
    releaseDevice(this.device);
  }
  /** The user's disconnect: no automatic reconnect. */
  close() {
    stopBluetoothReconnect();
    if (this.closed) return;
    this.teardown({ reconnect: false });
    this.device.gatt?.disconnect();
  }
}

/**
 * Disconnect the radio unless another link is using the same device. A reconnect attempt that finishes late and
 * a link the user just opened by hand share one BluetoothDevice, and disconnecting it would end the user's link.
 */
function releaseDevice(device: BleDevice) {
  const { connection, connecting } = useBluetooth.getState();
  if (connecting || connection?.device === device) return;
  device.gatt?.disconnect();
}

let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
/** Aborted when the running reconnect is stopped or replaced; every attempt checks it before it touches the store. */
let reconnectAbort: AbortController | undefined;

/** Wait before reconnect attempt `n`: 0.5, 1, 2, 4 s … capped at 30 s. */
export const reconnectDelay = (attempt: number) => Math.min(RECONNECT_FIRST_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);

/** Stop restoring a lost link (the user disconnected, connected by hand or chose another device), including an attempt already running. */
export function stopBluetoothReconnect() {
  reconnectAbort?.abort();
  reconnectAbort = undefined;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (useBluetooth.getState().reconnect) useBluetooth.setState({ reconnect: null });
}

/** Reconnect to the same device without the chooser; BluetoothDevice objects stay valid while the page is alive. */
function startBluetoothReconnect(device: BleDevice, diagnostics: BluetoothDiagnostics) {
  stopBluetoothReconnect();
  const abort = new AbortController();
  const { signal } = abort;
  reconnectAbort = abort;
  const schedule = (attempt: number) => {
    useBluetooth.setState({ reconnect: { attempt } });
    reconnectTimer = setTimeout(async () => {
      try {
        const connection = await BleMidiConnection.open(device, diagnostics, signal);
        // A stale attempt is dropped without touching the current link: it only lets go of its own listeners.
        if (signal.aborted) return connection.discard();
        useBluetooth.setState({ connection, reconnect: null, error: null });
      } catch {
        if (!signal.aborted) schedule(attempt + 1);
      }
    }, reconnectDelay(attempt));
  };
  schedule(1);
}

/** Invoke directly from a click: browsers require transient user activation for the chooser. */
export async function connectBluetooth(): Promise<BleMidiConnection> {
  const current = useBluetooth.getState();
  if (current.connection?.state === "connected") return current.connection;
  if (current.connecting) throw new Error("Bluetooth selection is already in progress.");
  stopBluetoothReconnect();
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
  if (!bluetooth) {
    const error = "Web Bluetooth is unavailable. Use the desktop app or Chrome/Edge with a Bluetooth adapter.";
    useBluetooth.setState({ error });
    throw new Error(error);
  }
  useBluetooth.setState({ connecting: true, error: null, diagnostics: null });
  try {
    const device = await bluetooth.requestDevice({
      filters: [
        { services: [MIDI_SERVICE] },
        { namePrefix: "GP-180" },
        { namePrefix: "GP180" },
        { namePrefix: "GP-150" },
        { namePrefix: "GP150" },
        { namePrefix: "Valeton" },
      ],
      optionalServices: [MIDI_SERVICE],
    });
    const connection = await BleMidiConnection.open(device);
    useBluetooth.setState({ connection });
    return connection;
  } catch (e) {
    const detail =
      e instanceof Error && e.name === "NotFoundError"
        ? "No Bluetooth MIDI device was selected or found before the scan ended. " +
          "Enable Bluetooth MIDI on the pedal, disconnect its phone app, keep it nearby, and try again."
        : e instanceof Error
          ? e.message
          : String(e);
    useBluetooth.setState({ error: `Bluetooth connection failed: ${detail}` });
    throw e;
  } finally {
    useBluetooth.setState({ connecting: false });
  }
}

/** Reset timing only; preserve transport counters, queued messages and connection state. */
export function resetBluetoothTiming() {
  const { connection, diagnostics } = useBluetooth.getState();
  if (connection) connection.resetTiming();
  else if (diagnostics) useBluetooth.setState({ diagnostics: { ...diagnostics, performanceTiming: undefined, clockTiming: undefined } });
}
