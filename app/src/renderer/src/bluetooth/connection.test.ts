import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BleMidiConnection, connectBluetooth, reconnectDelay, resetBluetoothTiming, stopBluetoothReconnect, type BleDevice, useBluetooth } from "./connection";
import { BleMidiDecoder } from "./ble-midi";

function fixture() {
  const characteristic = Object.assign(new EventTarget(), {
    value: undefined as DataView | undefined,
    properties: { write: true, writeWithoutResponse: true, notify: true, indicate: false },
    startNotifications: vi.fn(async () => characteristic),
    stopNotifications: vi.fn(async () => characteristic),
    writeValueWithResponse: vi.fn(async (_bytes: Uint8Array) => {}),
    writeValueWithoutResponse: vi.fn(async (_bytes: Uint8Array) => {}),
  });
  const gatt = {
    connected: true,
    connect: vi.fn(async () => {
      gatt.connected = true;
      return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) };
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false;
    }),
  };
  const device: BleDevice = Object.assign(new EventTarget(), { id: "test", name: "GP-180", gatt });
  return { device, gatt, characteristic };
}
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
/** Let the coalescing window elapse so buffered messages are written. */
const flush = async (ms = 20) => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};
const decodeWrites = (write: { mock: { calls: unknown[][] } }) => {
  const decoder = new BleMidiDecoder();
  return write.mock.calls.flatMap(([b]) => decoder.decode(b as Uint8Array)).map((b) => [...b]);
};
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  stopBluetoothReconnect();
  useBluetooth.getState().connection?.close();
  useBluetooth.setState({ connection: null, connecting: false, error: null, reconnect: null });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("Bluetooth connection lifecycle", () => {
  it("times out an unresolved write, discards queued commands and never retries uncertain delivery", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    let finish!: () => void;
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    connection.send([0xc0, 1]);
    connection.send([0xc0, 2]);
    connection.send([0xc0, 3], performance.now() + 1500);
    await flush();
    await vi.advanceTimersByTimeAsync(1001);
    await settle();
    expect(connection.state).toBe("disconnected");
    expect(useBluetooth.getState().error).toContain("delivery is unknown");
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect(useBluetooth.getState().diagnostics?.writes).toBe(0);
  });
  it("drops commands that waited over 250 ms behind a slow write and keeps the link open", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
    connection.send([0xc0, 1]);
    await flush(10);
    connection.send([0xc0, 2]);
    connection.send([0xc0, 3]);
    await flush(350);
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect(connection.state).toBe("connected");
    expect(useBluetooth.getState().error).toBeNull();
    expect(useBluetooth.getState().diagnostics?.dropped).toBe(2);
    connection.send([0xc0, 4]);
    await flush();
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([
      [0xc0, 1],
      [0xc0, 4],
    ]);
  });
  it("drops a message whose intended time is already over 250 ms past", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    connection.send([0xc0, 1], performance.now() - 300);
    connection.send([0xc0, 2]);
    await flush();
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([[0xc0, 2]]);
    expect(connection.state).toBe("connected");
    expect(useBluetooth.getState().diagnostics).toMatchObject({ dropped: 1, writes: 1 });
  });
  it("measures late clock dispatch and slow serialized GATT writes", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    f.characteristic.writeValueWithoutResponse.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const start = performance.now();
    connection.send([0xf8], start);
    connection.send([0xf8], start + 20);
    await flush(100);
    expect(useBluetooth.getState().diagnostics?.clockTiming).toMatchObject({ pulses: 2, maxLateMs: 18, maxWriteMs: 30, minIntervalMs: 30, maxIntervalMs: 30 });
    expect(useBluetooth.getState().diagnostics?.performanceTiming).toMatchObject({ commands: 2, maxLateMs: 18, maxWriteMs: 30 });
    connection.close();
  });
  it("sends channel-specific PC and CC over Bluetooth without Web MIDI or USB", async () => {
    vi.stubGlobal("navigator", {});
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    connection.send([0xc2, 7]);
    connection.send([0xb3, 12, 127], performance.now() + 100);
    await flush();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    await flush(100);
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([
      [0xc2, 7],
      [0xb3, 12, 127],
    ]);
    connection.close();
  });
  it("packs a burst into one write and carries each message's intended time", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    const start = performance.now();
    connection.send([0xc0, 1], start);
    connection.send([0xb0, 7, 90], start);
    connection.send([0xf8], start);
    await flush();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([[0xc0, 1], [0xb0, 7, 90], [0xf8]]);
    connection.close();
  });
  it("writes 48 clock pulses and 2 program changes within one second in about 100 writes or fewer, in order", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    const start = performance.now(),
      expected: number[][] = [];
    for (let i = 0; i < 48; i++) {
      connection.send([0xf8], start + i * 20.8);
      expected.push([0xf8]);
      if (i === 5 || i === 30) {
        connection.send([0xc0, i], start + i * 20.8);
        expected.push([0xc0, i]);
      }
    }
    await flush(1100);
    const writes = f.characteristic.writeValueWithoutResponse.mock.calls.length;
    expect(writes).toBeGreaterThan(0);
    expect(writes).toBeLessThanOrEqual(100);
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual(expected);
    expect(connection.state).toBe("connected");
    connection.close();
  });
  it("batches harder when only write-with-response is offered", async () => {
    const f = fixture();
    f.characteristic.properties.writeWithoutResponse = false;
    const connection = await BleMidiConnection.open(f.device);
    const start = performance.now();
    connection.send([0xf8], start);
    await flush(10);
    connection.send([0xf8], start + 10);
    await flush(20);
    expect(f.characteristic.writeValueWithoutResponse).not.toHaveBeenCalled();
    expect(f.characteristic.writeValueWithResponse).toHaveBeenCalledTimes(1);
    expect(decodeWrites(f.characteristic.writeValueWithResponse)).toEqual([[0xf8], [0xf8]]);
    connection.close();
  });
  it("bounds future scheduled cues and cancels them on overflow", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    for (let i = 0; i < 256; i++) connection.send([0xc0, i % 128], performance.now() + 1000);
    expect(() => connection.send([0xc0, 1], performance.now() + 1000)).toThrow("cannot keep up");
    await flush(1100);
    expect(f.characteristic.writeValueWithoutResponse).not.toHaveBeenCalled();
    expect(connection.state).toBe("disconnected");
  });
  it("retains completed writes and counts undecodable notifications after cleanup", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    connection.send([0xf8]);
    await flush();
    f.characteristic.value = new DataView(Uint8Array.from([0, 0]).buffer);
    f.characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    f.characteristic.value = new DataView(Uint8Array.from([0x80, 0x80, 0xf8]).buffer);
    f.characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    connection.close();
    expect(useBluetooth.getState().diagnostics).toMatchObject({ device: "GP-180", writes: 1, notifications: 2, messages: 1, clockTiming: { pulses: 1 } });
  });
  it("coalesces the timing counters recorded before a write into one store update", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    const updates = vi.fn();
    const stop = useBluetooth.subscribe(updates);
    connection.send([0xf8]);
    connection.send([192, 1]);
    await flush();
    stop();
    expect(useBluetooth.getState().diagnostics).toMatchObject({ writes: 1 });
    // Performance and clock timing are recorded together before the write; the write count follows after it completes.
    expect(updates.mock.calls.length).toBeLessThanOrEqual(2);
    connection.close();
  });
  it("rejects a connection lost while enabling notifications and allows another attempt", async () => {
    const f = fixture();
    f.characteristic.startNotifications.mockImplementationOnce(async () => {
      f.gatt.connected = false;
      f.device.dispatchEvent(new Event("gattserverdisconnected"));
      return f.characteristic;
    });
    const next = fixture();
    const requestDevice = vi.fn().mockResolvedValueOnce(f.device).mockResolvedValueOnce(next.device);
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
    await expect(connectBluetooth()).rejects.toThrow("disconnected during setup");
    expect(useBluetooth.getState().connection).toBeNull();
    expect(useBluetooth.getState().connecting).toBe(false);
    expect(useBluetooth.getState().reconnect).toBeNull();
    const reconnected = await connectBluetooth();
    expect(useBluetooth.getState().connection).toBe(reconnected);
    expect(useBluetooth.getState().error).toBeNull();
  });
  it("shows an error when Bluetooth is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(connectBluetooth()).rejects.toThrow("Web Bluetooth is unavailable");
    expect(useBluetooth.getState().error).toContain("Web Bluetooth is unavailable");
  });
  it("ignores a late write failure after a new session is connected", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    let rejectWrite!: (reason: Error) => void;
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    connection.send([0xf8]);
    await flush();
    connection.close();
    const next = await BleMidiConnection.open(fixture().device);
    useBluetooth.setState({ connection: next, error: null });
    rejectWrite(new Error("old session failed"));
    await settle();
    expect(useBluetooth.getState().connection).toBe(next);
    expect(useBluetooth.getState().error).toBeNull();
  });
  it("finishes an in-flight SysEx when clearing pending performance cues", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    const message = [0xf0, ...Array(80).fill(1), 0xf7];
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(async () => {
      connection.clear();
    });
    connection.send(message);
    connection.send([0xc0, 3]);
    await flush();
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([message]);
    connection.close();
  });
  it("serializes fragmented writes, delivers MIDI and releases listeners on disconnect", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const received = vi.fn(),
      lost = vi.fn();
    connection.subscribe(received);
    connection.onDisconnect(lost);
    const message = [0xf0, ...Array(80).fill(1), 0xf7];
    connection.send(message);
    connection.send([0xc0, 3]);
    await flush();
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([message, [0xc0, 3]]);
    f.characteristic.value = new DataView(Uint8Array.from([0x80, 0x80, 0xb0, 80, 127]).buffer);
    f.characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    expect([...received.mock.calls[0][0]]).toEqual([0xb0, 80, 127]);
    f.device.dispatchEvent(new Event("gattserverdisconnected"));
    f.characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    expect(received).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(useBluetooth.getState().connection).toBeNull();
    expect(() => connection.send([0xf8])).toThrow();
    expect(useBluetooth.getState().error).toContain("Bluetooth MIDI disconnected");
  });
  it("clears future performance messages without cancelling editor requests", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    connection.send([0xc0, 1], performance.now() + 1000);
    connection.send([0xc0, 2], performance.now(), true);
    connection.clear();
    await flush(1100);
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect([...f.characteristic.writeValueWithoutResponse.mock.calls[0][0]].slice(-2)).toEqual([0xc0, 2]);
    connection.close();
  });
  it("reports a failed write and closes the GATT connection", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    f.characteristic.writeValueWithoutResponse.mockRejectedValueOnce(new Error("radio lost"));
    connection.send([0xf8]);
    await flush();
    expect(connection.state).toBe("disconnected");
    expect(f.gatt.disconnect).toHaveBeenCalledOnce();
    expect(useBluetooth.getState().error).toContain("radio lost");
  });
  it("disconnects if notifications fail during setup", async () => {
    const f = fixture();
    f.characteristic.startNotifications.mockRejectedValueOnce(new Error("denied"));
    await expect(BleMidiConnection.open(f.device)).rejects.toThrow("denied");
    expect(f.gatt.disconnect).toHaveBeenCalled();
  });
});

describe("Bluetooth auto-reconnect", () => {
  it("backs off 0.5, 1, 2, 4 s up to a 30 s cap", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
  it("retries after range loss without the chooser, then restores the link disarmed", async () => {
    const requestDevice = vi.fn();
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const lost = vi.fn();
    connection.onDisconnect(lost);
    f.gatt.connect.mockClear();
    f.gatt.connect.mockRejectedValueOnce(new Error("out of range")).mockRejectedValueOnce(new Error("out of range"));
    f.gatt.connected = false;
    f.device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(lost).toHaveBeenCalledOnce();
    expect(useBluetooth.getState().reconnect).toEqual({ attempt: 1 });
    await flush(499);
    expect(f.gatt.connect).not.toHaveBeenCalled();
    await flush(1);
    expect(f.gatt.connect).toHaveBeenCalledTimes(1);
    expect(useBluetooth.getState().reconnect).toEqual({ attempt: 2 });
    await flush(1000);
    expect(f.gatt.connect).toHaveBeenCalledTimes(2);
    expect(useBluetooth.getState().reconnect).toEqual({ attempt: 3 });
    await flush(2000);
    expect(f.gatt.connect).toHaveBeenCalledTimes(3);
    const restored = useBluetooth.getState().connection;
    expect(restored).not.toBeNull();
    expect(restored).not.toBe(connection);
    expect(restored?.state).toBe("connected");
    expect(useBluetooth.getState().reconnect).toBeNull();
    expect(useBluetooth.getState().error).toBeNull();
    expect(useBluetooth.getState().diagnostics?.reconnects).toBe(1);
    expect(requestDevice).not.toHaveBeenCalled();
    expect(lost).toHaveBeenCalledOnce();
  });
  it("reconnects after a write failure too", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    f.characteristic.writeValueWithoutResponse.mockRejectedValueOnce(new Error("radio lost"));
    connection.send([0xc0, 1]);
    await flush();
    expect(useBluetooth.getState().reconnect).toEqual({ attempt: 1 });
    await flush(500);
    expect(useBluetooth.getState().connection?.state).toBe("connected");
  });
  it("does not reconnect after the user disconnects", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    f.gatt.connect.mockClear();
    connection.close();
    await flush(60_000);
    expect(f.gatt.connect).not.toHaveBeenCalled();
    expect(useBluetooth.getState().reconnect).toBeNull();
    expect(useBluetooth.getState().connection).toBeNull();
  });
  it("stops retrying when the user cancels", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    f.gatt.connect.mockClear();
    f.gatt.connect.mockRejectedValue(new Error("out of range"));
    f.device.dispatchEvent(new Event("gattserverdisconnected"));
    await flush(500);
    expect(f.gatt.connect).toHaveBeenCalledTimes(1);
    stopBluetoothReconnect();
    await flush(60_000);
    expect(f.gatt.connect).toHaveBeenCalledTimes(1);
    expect(useBluetooth.getState().reconnect).toBeNull();
    expect(useBluetooth.getState().connection).toBeNull();
  });
  /** Lose the link, then hold the first reconnect attempt inside gatt.connect() until `finish` is called. */
  async function attemptInFlight() {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const server = await f.gatt.connect();
    let finish!: () => void;
    f.gatt.connect.mockClear();
    f.gatt.connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(server);
        }),
    );
    f.gatt.connected = false;
    f.device.dispatchEvent(new Event("gattserverdisconnected"));
    await flush(500);
    expect(f.gatt.connect).toHaveBeenCalledTimes(1);
    return { f, finish };
  }
  it("keeps a link the user opened by hand when a reconnect attempt that was running finishes late", async () => {
    const { f, finish } = await attemptInFlight();
    vi.stubGlobal("navigator", { bluetooth: { requestDevice: vi.fn().mockResolvedValue(f.device) } });
    const manual = await connectBluetooth();
    expect(useBluetooth.getState().connection).toBe(manual);
    expect(useBluetooth.getState().reconnect).toBeNull();
    f.gatt.disconnect.mockClear();
    finish();
    await flush(60_000);
    expect(f.gatt.disconnect).not.toHaveBeenCalled();
    expect(manual.state).toBe("connected");
    expect(useBluetooth.getState().connection).toBe(manual);
    expect(useBluetooth.getState().reconnect).toBeNull();
    expect(useBluetooth.getState().diagnostics?.reconnects).not.toBe(1);
  });
  it("does not retry after a manual connect when the running attempt fails late", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    let fail!: () => void;
    f.gatt.connect.mockClear();
    f.gatt.connect.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = () => reject(new Error("out of range"));
        }),
    );
    f.gatt.connected = false;
    f.device.dispatchEvent(new Event("gattserverdisconnected"));
    await flush(500);
    vi.stubGlobal("navigator", { bluetooth: { requestDevice: vi.fn().mockResolvedValue(f.device) } });
    const manual = await connectBluetooth();
    f.gatt.connect.mockClear();
    fail();
    await flush(60_000);
    expect(f.gatt.connect).not.toHaveBeenCalled();
    expect(manual.state).toBe("connected");
    expect(useBluetooth.getState().reconnect).toBeNull();
  });
  it("aborts the attempt that is already running when the user stops reconnecting", async () => {
    const { f, finish } = await attemptInFlight();
    expect(useBluetooth.getState().reconnect).toEqual({ attempt: 1 });
    stopBluetoothReconnect();
    expect(useBluetooth.getState().reconnect).toBeNull();
    f.gatt.connected = true;
    finish();
    await flush(60_000);
    expect(useBluetooth.getState().connection).toBeNull();
    expect(useBluetooth.getState().reconnect).toBeNull();
    expect(f.gatt.connect).toHaveBeenCalledTimes(1);
    expect(f.gatt.disconnect).toHaveBeenCalled();
  });
});

it("offers both GP-150 and GP-180 Bluetooth names without requiring service advertising", async () => {
  const f = fixture();
  const requestDevice = vi.fn().mockResolvedValue(f.device);
  vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
  await connectBluetooth();
  expect(requestDevice).toHaveBeenCalledWith(
    expect.objectContaining({
      filters: expect.arrayContaining([{ namePrefix: "GP-150" }, { namePrefix: "GP150" }, { namePrefix: "GP-180" }, { namePrefix: "GP180" }]),
    }),
  );
});

it("resets live and disconnected timing without clearing scheduled messages", async () => {
  const f = fixture(),
    connection = await BleMidiConnection.open(f.device);
  useBluetooth.setState({ connection });
  connection.send([248]);
  await flush();
  connection.send([192, 1], performance.now() + 100);
  resetBluetoothTiming();
  expect(useBluetooth.getState().diagnostics?.clockTiming).toBeUndefined();
  await flush(120);
  expect(useBluetooth.getState().diagnostics?.performanceTiming?.commands).toBe(1);
  expect(useBluetooth.getState().diagnostics?.writes).toBe(2);
  connection.close();
  resetBluetoothTiming();
  expect(useBluetooth.getState().diagnostics?.performanceTiming).toBeUndefined();
  expect(useBluetooth.getState().diagnostics?.writes).toBe(2);
});
it("does not restore old timing when a pending write completes after reset", async () => {
  const f = fixture(),
    connection = await BleMidiConnection.open(f.device);
  useBluetooth.setState({ connection });
  f.characteristic.writeValueWithoutResponse.mockImplementationOnce(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  connection.send([248]);
  await flush(10);
  resetBluetoothTiming();
  await flush(60);
  expect(useBluetooth.getState().diagnostics).toMatchObject({ writes: 1 });
  expect(useBluetooth.getState().diagnostics?.performanceTiming).toBeUndefined();
  expect(useBluetooth.getState().diagnostics?.clockTiming).toBeUndefined();
});

describe("same-timestamp ordering", () => {
  it("keeps a pair in order in one packet when the second is sent just after the first is timed", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const due = performance.now() + 1.2;
    connection.send([0xc0, 0], due);
    await vi.advanceTimersByTimeAsync(0.5);
    connection.send([0xcf, 68], due);
    await flush();
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([
      [0xc0, 0],
      [0xcf, 68],
    ]);
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
  });
  it("sends a pair with the same timestamp in one packet, in send order", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const due = performance.now() + 60;
    connection.send([0xc0, 0], due);
    connection.send([0xcf, 68], due);
    await flush(80);
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([
      [0xc0, 0],
      [0xcf, 68],
    ]);
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
  });
  it("sends a message timed earlier before a held pair, and keeps the pair's order", async () => {
    const f = fixture(),
      connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const now = performance.now();
    connection.send([0xc0, 0], now + 50);
    connection.send([0xcf, 68], now + 50);
    connection.send([0x90, 60, 100], now + 10);
    await flush(80);
    expect(decodeWrites(f.characteristic.writeValueWithoutResponse)).toEqual([
      [0x90, 60, 100],
      [0xc0, 0],
      [0xcf, 68],
    ]);
  });
});
