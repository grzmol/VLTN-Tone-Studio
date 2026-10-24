import { create } from 'zustand';
import { BleMidiDecoder, encodeBleMidi, MIDI_CHARACTERISTIC, MIDI_SERVICE } from './ble-midi';

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
  id: string; name?: string;
  gatt?: { connected: boolean; connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>; disconnect(): void };
}
interface BluetoothApi { requestDevice(options: { filters: ({ services: string[] } | { namePrefix: string })[]; optionalServices: string[] }): Promise<BleDevice> }
type Listener = (bytes: Uint8Array) => void;
export interface BluetoothDiagnostics {
  device: string;
  writes: number;
  notifications: number;
  messages: number;
  performanceTiming?: { commands:number; maxLateMs:number; maxWriteMs:number };
  clockTiming?: { pulses: number; maxLateMs: number; maxWriteMs: number; minIntervalMs: number; maxIntervalMs: number };
}
export const useBluetooth = create<{ connection: BleMidiConnection | null; connecting: boolean; error: string | null; diagnostics: BluetoothDiagnostics | null }>(() => ({ connection: null, connecting: false, error: null, diagnostics: null }));

export class BleMidiConnection {
  readonly id = 'bluetooth-midi';
  get name() { return this.device.name || 'Bluetooth MIDI'; }
  get state(): 'connected' | 'disconnected' { return !this.closed && this.device.gatt?.connected ? 'connected' : 'disconnected'; }
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<Listener>();
  private disconnectListeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private generation = 0;
  private queued = 0;
  private decoder = new BleMidiDecoder();
  private diagnostics: BluetoothDiagnostics;
  private timingGeneration = 0;
  private lastClockWrite: number | null = null;
  private constructor(readonly device: BleDevice, private characteristic: Characteristic) {
    this.diagnostics = { device: this.name, writes: 0, notifications: 0, messages: 0 };
    useBluetooth.setState({ diagnostics: this.diagnostics });
  }
  private record(counts: Partial<Pick<BluetoothDiagnostics, 'writes' | 'notifications' | 'messages' | 'clockTiming' | 'performanceTiming'>>) {
    const previous = this.diagnostics;
    this.diagnostics = { ...previous, ...counts };
    // Keep the last session's evidence after cleanup without overwriting a newer session.
    if (useBluetooth.getState().diagnostics === previous) useBluetooth.setState({ diagnostics: this.diagnostics });
  }
  static async open(device: BleDevice): Promise<BleMidiConnection> {
    try {
      const server = await device.gatt?.connect();
      if (!server) throw new Error('The selected device has no Bluetooth GATT server.');
      const service = await server.getPrimaryService(MIDI_SERVICE);
      const characteristic = await service.getCharacteristic(MIDI_CHARACTERISTIC);
      if ((!characteristic.properties.notify && !characteristic.properties.indicate) || (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse)) throw new Error('This MIDI characteristic cannot send and receive data.');
      const connection = new BleMidiConnection(device, characteristic);
      characteristic.addEventListener('characteristicvaluechanged', connection.receive);
      device.addEventListener('gattserverdisconnected', connection.lost);
      try { await characteristic.startNotifications(); }
      catch (e) { connection.close(); throw e; }
      if (connection.state !== 'connected') {
        connection.close();
        throw new Error('Bluetooth disconnected during setup. Keep the device nearby and try connecting again.');
      }
      return connection;
    } catch (e) { device.gatt?.disconnect(); throw e; }
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
  private lost = (event?: Event) => {
    if (this.closed) return;
    this.closed = true; this.clear(); this.decoder.reset();
    this.characteristic.removeEventListener('characteristicvaluechanged', this.receive);
    this.device.removeEventListener('gattserverdisconnected', this.lost);
    if (useBluetooth.getState().connection === this) useBluetooth.setState({
      connection: null,
      ...(event ? { error: 'Bluetooth MIDI disconnected. Check that the device is powered on and nearby, then connect again.' } : {}),
    });
    for (const listener of this.disconnectListeners) listener();
    this.listeners.clear(); this.disconnectListeners.clear();
  };
  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onDisconnect(listener: () => void) { this.disconnectListeners.add(listener); return () => { this.disconnectListeners.delete(listener); }; }
  /** Queued GATT writes never overlap; a write failure closes the session and is visible in the UI. */
  send(bytes: readonly number[] | Uint8Array, timestamp = performance.now(), editor = false) {
    if (this.state !== 'connected') throw new Error('Bluetooth MIDI is disconnected.');
    if (this.queued + this.timers.size >= 256) {
      const error = 'Bluetooth MIDI cannot keep up. Connection closed; reduce MIDI traffic.';
      if (useBluetooth.getState().connection === this) useBluetooth.setState({ error });
      this.close();
      throw new Error(error);
    }
    const packets = encodeBleMidi(bytes, timestamp);
    const generation = this.generation;
    const enqueue = () => {
      this.queued++;
      this.chain = this.chain.then(async () => {
        if (this.closed || (!editor && generation !== this.generation)) return;
        if (!editor && performance.now() - timestamp > 250) throw new Error('Bluetooth MIDI command is over 250 ms late; pending commands discarded. Check the pedal state before reconnecting.');
        if (!editor) {
          const previous=this.diagnostics.performanceTiming;
          this.record({performanceTiming:{commands:(previous?.commands??0)+1,maxLateMs:Math.max(previous?.maxLateMs??0,performance.now()-timestamp),maxWriteMs:previous?.maxWriteMs??0}});
        }
        const timingGeneration=this.timingGeneration;
        for (const packet of packets) {
          // Once started, complete the message so clear() cannot leave a partial SysEx.
          if (this.closed) return;
          const started = performance.now();
          const clock = bytes.length === 1 && bytes[0] === 0xf8;
          if (clock) {
            const previous = this.diagnostics.clockTiming;
            const interval = this.lastClockWrite === null ? null : started - this.lastClockWrite;
            this.lastClockWrite = started;
            this.record({ clockTiming: {
              pulses: (previous?.pulses ?? 0) + 1,
              maxLateMs: Math.max(previous?.maxLateMs ?? 0, started - timestamp),
              maxWriteMs: previous?.maxWriteMs ?? 0,
              minIntervalMs: interval === null ? previous?.minIntervalMs ?? 0 : previous && previous.pulses > 1 ? Math.min(previous.minIntervalMs, interval) : interval,
              maxIntervalMs: Math.max(previous?.maxIntervalMs ?? 0, interval ?? 0),
            } });
          }
          // Some adapter failures leave the GATT promise pending indefinitely.
          // Do not retry a command that might already have reached the pedal.
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              this.characteristic.properties.writeWithoutResponse ? this.characteristic.writeValueWithoutResponse(packet as Uint8Array<ArrayBuffer>) : this.characteristic.writeValueWithResponse(packet as Uint8Array<ArrayBuffer>),
              new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Bluetooth MIDI write timed out; delivery is unknown. Check the pedal state before reconnecting.')), 1000); }),
            ]);
          } finally { if (timeout !== undefined) clearTimeout(timeout); }
          if (this.closed) return;
          if (!editor && timingGeneration===this.timingGeneration) this.record({performanceTiming:{...this.diagnostics.performanceTiming!,maxWriteMs:Math.max((this.diagnostics.performanceTiming?.maxWriteMs ?? 0),performance.now()-started)}});
          this.record({ writes: this.diagnostics.writes + 1, ...(clock && timingGeneration===this.timingGeneration ? { clockTiming: { ...this.diagnostics.clockTiming!, maxWriteMs: Math.max((this.diagnostics.clockTiming?.maxWriteMs ?? 0), performance.now() - started) } } : {}) });
        }
      }).catch(e => {
        // A rejected write can arrive after this session was closed and replaced.
        if (this.closed) return;
        useBluetooth.setState({ error: `Bluetooth write failed: ${String(e)}` });
        this.close();
      }).finally(() => { this.queued--; });
    };
    const delay = timestamp - performance.now();
    if (delay <= 1) enqueue();
    else { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.closed && generation === this.generation) enqueue(); }, delay); this.timers.add(timer); }
  }
  resetTiming() {
    this.timingGeneration++;
    this.lastClockWrite = null;
    this.record({performanceTiming:undefined,clockTiming:undefined});
  }
  clear() { this.lastClockWrite = null; this.generation++; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
  close() {
    if (this.closed) return;
    this.lost();
    this.device.gatt?.disconnect();
  }
}

/** Invoke directly from a click: browsers require transient user activation for the chooser. */
export async function connectBluetooth(): Promise<BleMidiConnection> {
  const current = useBluetooth.getState();
  if (current.connection?.state === 'connected') return current.connection;
  if (current.connecting) throw new Error('Bluetooth selection is already in progress.');
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
  if (!bluetooth) {
    const error = 'Web Bluetooth is unavailable. Use the desktop app or Chrome/Edge with a Bluetooth adapter.';
    useBluetooth.setState({ error });
    throw new Error(error);
  }
  useBluetooth.setState({ connecting: true, error: null, diagnostics: null });
  try {
    const device = await bluetooth.requestDevice({ filters: [{ services: [MIDI_SERVICE] }, { namePrefix: 'GP-180' }, { namePrefix: 'GP180' }, { namePrefix: 'GP-150' }, { namePrefix: 'GP150' }, { namePrefix: 'Valeton' }], optionalServices: [MIDI_SERVICE] });
    const connection = await BleMidiConnection.open(device);
    useBluetooth.setState({ connection });
    return connection;
  } catch (e) {
    const detail = e instanceof Error && e.name === 'NotFoundError'
      ? 'No Bluetooth MIDI device was selected or found before the scan ended. Enable Bluetooth MIDI on the pedal, disconnect its phone app, keep it nearby, and try again.'
      : e instanceof Error ? e.message : String(e);
    useBluetooth.setState({ error: `Bluetooth connection failed: ${detail}` });
    throw e;
  } finally { useBluetooth.setState({ connecting: false }); }
}

/** Reset timing only; preserve transport counters, queued messages and connection state. */
export function resetBluetoothTiming() {
  const {connection,diagnostics}=useBluetooth.getState();
  if(connection)connection.resetTiming();
  else if(diagnostics)useBluetooth.setState({diagnostics:{...diagnostics,performanceTiming:undefined,clockTiming:undefined}});
}
