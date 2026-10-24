import { afterEach, describe, expect, it, vi } from 'vitest';
import { BleMidiConnection, connectBluetooth, resetBluetoothTiming, type BleDevice, useBluetooth } from './connection';
import { BleMidiDecoder } from './ble-midi';

function fixture() {
  const characteristic = Object.assign(new EventTarget(), {
    value: undefined as DataView | undefined,
    properties: { write: true, writeWithoutResponse: true, notify: true, indicate: false },
    startNotifications: vi.fn(async () => characteristic), stopNotifications: vi.fn(async () => characteristic),
    writeValueWithResponse: vi.fn(async (_bytes: Uint8Array) => {}),
    writeValueWithoutResponse: vi.fn(async (_bytes: Uint8Array) => {}),
  });
  const gatt = { connected: true, connect: vi.fn(async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) })), disconnect: vi.fn(() => { gatt.connected = false; }) };
  const device: BleDevice = Object.assign(new EventTarget(), { id: 'test', name: 'GP-180', gatt });
  return { device, gatt, characteristic };
}
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { useBluetooth.getState().connection?.close(); useBluetooth.setState({ connection: null, connecting: false, error: null }); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Bluetooth connection lifecycle', () => {
  it('times out an unresolved write, discards queued commands and never retries uncertain delivery', async () => {
    vi.useFakeTimers();
    const f=fixture(),connection=await BleMidiConnection.open(f.device);
    useBluetooth.setState({connection});
    let finish!:()=>void;
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    connection.send([0xc0,1]);connection.send([0xc0,2]);
    connection.send([0xc0,3],performance.now()+1500);
    await settle();await vi.advanceTimersByTimeAsync(1001);await settle();
    expect(connection.state).toBe('disconnected');
    expect(useBluetooth.getState().error).toContain('delivery is unknown');
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    finish();await vi.advanceTimersByTimeAsync(1000);await settle();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect(useBluetooth.getState().diagnostics?.writes).toBe(0);
  });
  it('discards commands waiting over 250 ms behind a slow write instead of sending a late burst', async () => {
    vi.useFakeTimers();
    const f=fixture(),connection=await BleMidiConnection.open(f.device);
    useBluetooth.setState({connection});
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(()=>new Promise<void>(resolve=>setTimeout(resolve,300)));
    connection.send([0xc0,1]);connection.send([0xc0,2]);connection.send([0xc0,3]);
    await settle();await vi.advanceTimersByTimeAsync(350);await settle();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect(connection.state).toBe('disconnected');
    expect(useBluetooth.getState().error).toContain('over 250 ms late');
  });
  it('measures late clock dispatch and slow serialized GATT writes', async () => {
    vi.useFakeTimers();
    const f=fixture(), connection=await BleMidiConnection.open(f.device);
    f.characteristic.writeValueWithoutResponse.mockImplementation(async () => { await new Promise(resolve=>setTimeout(resolve,30)); });
    const start=performance.now();
    connection.send([0xf8],start);
    connection.send([0xf8],start+20);
    await vi.advanceTimersByTimeAsync(70); await settle();
    expect(useBluetooth.getState().diagnostics?.clockTiming).toMatchObject({pulses:2,maxLateMs:10,maxWriteMs:30,minIntervalMs:30,maxIntervalMs:30});
    expect(useBluetooth.getState().diagnostics?.performanceTiming).toMatchObject({commands:2,maxLateMs:10,maxWriteMs:30});
    connection.close();
  });
  it('sends channel-specific PC and CC over Bluetooth without Web MIDI or USB', async () => {
    vi.useFakeTimers(); vi.stubGlobal('navigator', {});
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    connection.send([0xc2, 7]);
    connection.send([0xb3, 12, 127], performance.now() + 100);
    await settle();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); await settle();
    const decoder = new BleMidiDecoder();
    expect(f.characteristic.writeValueWithoutResponse.mock.calls.flatMap(([b]) => decoder.decode(b)).map(b => [...b])).toEqual([[0xc2,7], [0xb3,12,127]]);
    connection.close();
  });
  it('bounds future scheduled cues and cancels them on overflow', async () => {
    vi.useFakeTimers();
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    for (let i = 0; i < 256; i++) connection.send([0xc0, i % 128], performance.now() + 1000);
    expect(() => connection.send([0xc0, 1], performance.now() + 1000)).toThrow('cannot keep up');
    await vi.advanceTimersByTimeAsync(1100); await settle();
    expect(f.characteristic.writeValueWithoutResponse).not.toHaveBeenCalled();
    expect(connection.state).toBe('disconnected');
  });
  it('retains completed writes and counts undecodable notifications after cleanup', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    connection.send([0xf8]);
    await settle();
    f.characteristic.value = new DataView(Uint8Array.from([0, 0]).buffer);
    f.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    f.characteristic.value = new DataView(Uint8Array.from([0x80, 0x80, 0xf8]).buffer);
    f.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    connection.close();
    expect(useBluetooth.getState().diagnostics).toMatchObject({ device: 'GP-180', writes: 1, notifications: 2, messages: 1, clockTiming: { pulses: 1 } });
  });
  it('rejects a connection lost while enabling notifications and allows another attempt', async () => {
    const f = fixture();
    f.characteristic.startNotifications.mockImplementationOnce(async () => {
      f.gatt.connected = false;
      f.device.dispatchEvent(new Event('gattserverdisconnected'));
      return f.characteristic;
    });
    const next = fixture();
    const requestDevice = vi.fn().mockResolvedValueOnce(f.device).mockResolvedValueOnce(next.device);
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
    await expect(connectBluetooth()).rejects.toThrow('disconnected during setup');
    expect(useBluetooth.getState().connection).toBeNull();
    expect(useBluetooth.getState().connecting).toBe(false);
    const reconnected = await connectBluetooth();
    expect(useBluetooth.getState().connection).toBe(reconnected);
    expect(useBluetooth.getState().error).toBeNull();
  });
  it('shows an error when Bluetooth is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(connectBluetooth()).rejects.toThrow('Web Bluetooth is unavailable');
    expect(useBluetooth.getState().error).toContain('Web Bluetooth is unavailable');
  });
  it('ignores a late write failure after a new session is connected', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    let rejectWrite!: (reason: Error) => void;
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject; }));
    connection.send([0xf8]);
    await settle();
    connection.close();
    const next = await BleMidiConnection.open(fixture().device);
    useBluetooth.setState({ connection: next, error: null });
    rejectWrite(new Error('old session failed'));
    await settle();
    expect(useBluetooth.getState().connection).toBe(next);
    expect(useBluetooth.getState().error).toBeNull();
  });
  it('finishes an in-flight SysEx when clearing pending performance cues', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    const message = [0xf0, ...Array(80).fill(1), 0xf7];
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(async () => { connection.clear(); });
    connection.send(message); connection.send([0xc0,3]); await settle();
    const decoder = new BleMidiDecoder();
    expect(f.characteristic.writeValueWithoutResponse.mock.calls.flatMap(([b]) => decoder.decode(b)).map(b => [...b])).toEqual([message]);
    connection.close();
  });
  it('serializes fragmented writes, delivers MIDI and releases listeners on disconnect', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const received = vi.fn(), lost = vi.fn(); connection.subscribe(received); connection.onDisconnect(lost);
    const message = [0xf0, ...Array(80).fill(1), 0xf7];
    connection.send(message); connection.send([0xc0,3]); await settle();
    const decoder = new BleMidiDecoder();
    expect(f.characteristic.writeValueWithoutResponse.mock.calls.flatMap(([b]) => decoder.decode(b)).map(b => [...b])).toEqual([message,[0xc0,3]]);
    f.characteristic.value = new DataView(Uint8Array.from([0x80,0x80,0xb0,80,127]).buffer);
    f.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect([...received.mock.calls[0][0]]).toEqual([0xb0,80,127]);
    f.device.dispatchEvent(new Event('gattserverdisconnected'));
    f.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(received).toHaveBeenCalledTimes(1); expect(lost).toHaveBeenCalledTimes(1);
    expect(useBluetooth.getState().connection).toBeNull(); expect(() => connection.send([0xf8])).toThrow();
    expect(useBluetooth.getState().error).toContain('Bluetooth MIDI disconnected');
  });
  it('clears future performance messages without cancelling editor requests', async () => {
    vi.useFakeTimers();
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    connection.send([0xc0,1], performance.now() + 1000);
    connection.send([0xc0,2], performance.now(), true);
    connection.clear(); await vi.advanceTimersByTimeAsync(1100); await settle();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect([...f.characteristic.writeValueWithoutResponse.mock.calls[0][0]].slice(-2)).toEqual([0xc0,2]);
    connection.close();
  });
  it('reports a failed write and closes the GATT connection', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    f.characteristic.writeValueWithoutResponse.mockRejectedValueOnce(new Error('radio lost'));
    connection.send([0xf8]); await settle();
    expect(connection.state).toBe('disconnected'); expect(f.gatt.disconnect).toHaveBeenCalledOnce();
    expect(useBluetooth.getState().error).toContain('radio lost');
  });
  it('disconnects if notifications fail during setup', async () => {
    const f = fixture(); f.characteristic.startNotifications.mockRejectedValueOnce(new Error('denied'));
    await expect(BleMidiConnection.open(f.device)).rejects.toThrow('denied');
    expect(f.gatt.disconnect).toHaveBeenCalled();
  });
});

it('offers both GP-150 and GP-180 Bluetooth names without requiring service advertising', async () => {
  const f=fixture();
  const requestDevice=vi.fn().mockResolvedValue(f.device);
  vi.stubGlobal('navigator',{bluetooth:{requestDevice}});
  await connectBluetooth();
  expect(requestDevice).toHaveBeenCalledWith(expect.objectContaining({filters:expect.arrayContaining([
    {namePrefix:'GP-150'},{namePrefix:'GP150'},{namePrefix:'GP-180'},{namePrefix:'GP180'},
  ])}));
});

it('resets live and disconnected timing without clearing scheduled messages',async()=>{
 vi.useFakeTimers();const f=fixture(),connection=await BleMidiConnection.open(f.device);
 useBluetooth.setState({connection});connection.send([248]);await settle();
 connection.send([192,1],performance.now()+100);
 resetBluetoothTiming();expect(useBluetooth.getState().diagnostics?.clockTiming).toBeUndefined();
 await vi.advanceTimersByTimeAsync(110);await settle();
 expect(useBluetooth.getState().diagnostics?.performanceTiming?.commands).toBe(1);
 expect(useBluetooth.getState().diagnostics?.writes).toBe(2);
 connection.close();resetBluetoothTiming();
 expect(useBluetooth.getState().diagnostics?.performanceTiming).toBeUndefined();
 expect(useBluetooth.getState().diagnostics?.writes).toBe(2);
});
it('does not restore old timing when a pending write completes after reset',async()=>{
 vi.useFakeTimers();const f=fixture(),connection=await BleMidiConnection.open(f.device);
 useBluetooth.setState({connection});
 f.characteristic.writeValueWithoutResponse.mockImplementationOnce(()=>new Promise<void>(resolve=>setTimeout(resolve,50)));
 connection.send([248]);await settle();resetBluetoothTiming();
 await vi.advanceTimersByTimeAsync(60);await settle();
 expect(useBluetooth.getState().diagnostics).toMatchObject({writes:1});
 expect(useBluetooth.getState().diagnostics?.performanceTiming).toBeUndefined();
 expect(useBluetooth.getState().diagnostics?.clockTiming).toBeUndefined();
});
