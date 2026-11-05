import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BleMidiConnection, connectBluetooth, reconnectDelay, stopBluetoothReconnect, type BleDevice, useBluetooth } from "./connection";
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
  it("times out an unresolved write, discards writes queued behind it and never retries uncertain delivery", async () => {
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
    expect(useBluetooth.getState().diagnostics).toMatchObject({ device: "GP-180", writes: 1, notifications: 2, messages: 1 });
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
