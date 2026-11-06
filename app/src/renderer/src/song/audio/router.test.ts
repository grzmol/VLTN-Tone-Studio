import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_OUTPUTS, OutputRouter, type OutputConfig } from "./outputs";

/** A node that records its connections. `connect` returns the node so chains like `a.connect(b).connect(c)` work. */
function node() {
  const n = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    channelCount: 2,
    channelCountMode: "max",
    channelInterpretation: "speakers",
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    frequency: { setValueAtTime: vi.fn() },
    onended: null as null | (() => void),
    start: vi.fn(),
    stop: vi.fn(),
  };
  n.connect.mockReturnValue(n);
  return n;
}

class FakeContext {
  static instances: FakeContext[] = [];
  /** Sinks that reject, so a selection can fail */
  static rejectSinks = new Set<string>();
  currentTime = 2;
  timestamp = { contextTime: 1, performanceTime: 1000 };
  destination: { maxChannelCount: number; channelCount?: number; channelInterpretation?: string } = { maxChannelCount: 4 };
  gains: ReturnType<typeof node>[] = [];
  oscillators: ReturnType<typeof node>[] = [];
  merger: ReturnType<typeof node> | null = null;
  sinkIds: string[] = [];
  closed = false;
  constructor() {
    FakeContext.instances.push(this);
  }
  getOutputTimestamp() {
    return this.timestamp;
  }
  async setSinkId(sinkId: string) {
    this.sinkIds.push(sinkId);
    if (FakeContext.rejectSinks.has(sinkId)) throw new Error("NotFoundError");
  }
  createGain() {
    const gain = node();
    this.gains.push(gain);
    return gain;
  }
  createChannelMerger() {
    this.merger = node();
    return this.merger;
  }
  createOscillator() {
    const osc = node();
    this.oscillators.push(osc);
    return osc;
  }
  async resume() {}
  async close() {
    this.closed = true;
  }
}

/** Lets queued routing finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function devicesStub(list: { deviceId: string; label: string }[]) {
  const listeners: Array<() => void> = [];
  const stub = {
    devices: list,
    enumerate: vi.fn(async () => stub.devices.map((device) => ({ ...device, kind: "audiooutput" }))),
    listeners,
  };
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: stub.enumerate,
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
    },
  });
  return stub;
}

function outputs(overrides: Partial<OutputConfig> = {}): OutputConfig {
  return { ...DEFAULT_OUTPUTS, deviceId: "usb-4", label: "Interface", ...overrides };
}

function setup(devices = [{ deviceId: "usb-4", label: "Interface" }], maxChannels = 4) {
  const stub = devicesStub(devices);
  vi.stubGlobal("AudioContext", FakeContext);
  const warn = vi.fn();
  const ctx = new FakeContext();
  ctx.destination.maxChannelCount = maxChannels;
  const router = new OutputRouter(ctx as unknown as AudioContext, warn);
  return { stub, warn, ctx, router };
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeContext.instances = [];
  FakeContext.rejectSinks = new Set();
});

it("routes aux 1 to its own channel pair when the device has enough outputs", async () => {
  const { ctx, router } = setup(undefined, 6);
  await router.apply(outputs({ buses: { ...DEFAULT_OUTPUTS.buses, aux1: { channels: [4, 5], gain: 1 } } }));
  expect(ctx.merger).not.toBeNull();
  expect(ctx.gains[2].connect).toHaveBeenCalledWith(ctx.merger, 0, 4);
  expect(ctx.gains[2].connect).toHaveBeenCalledWith(ctx.merger, 1, 5);
});

it("falls back to outputs 1/2 with a warning when aux 1 asks for a pair the device lacks", async () => {
  const { ctx, router, warn } = setup(undefined, 4);
  await router.apply(outputs({ buses: { ...DEFAULT_OUTPUTS.buses, aux1: { channels: [4, 5], gain: 1 } } }));
  expect(ctx.merger).toBeNull();
  expect(ctx.gains[2].connect).toHaveBeenCalledWith(ctx.destination);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("keeps the same device and channel layout across unrelated device changes, without re-selecting or re-wiring", async () => {
  const { stub, ctx, router } = setup([{ deviceId: "usb-4", label: "Interface" }]);
  const config = outputs({ clickDevice: null, buses: { ...DEFAULT_OUTPUTS.buses, click: { channels: [2, 3], gain: 1 } } });
  await router.apply(config);
  expect(ctx.sinkIds).toEqual(["usb-4"]);
  const merger = ctx.merger;
  const mergerCalls = merger!.connect.mock.calls.length;

  // A Bluetooth headset appears: the main device is still there and the layout is the same.
  stub.devices = [...stub.devices, { deviceId: "bt-1", label: "Headset" }];
  stub.listeners[0]();
  await vi.waitFor(() => expect(stub.enumerate).toHaveBeenCalledTimes(2));
  await settle();
  expect(ctx.sinkIds).toEqual(["usb-4"]);
  expect(ctx.merger).toBe(merger);
  expect(merger!.connect.mock.calls.length).toBe(mergerCalls);

  // A gain change alone does not re-route either.
  await router.apply({ ...config, buses: { ...config.buses, aux1: { channels: [0, 1], gain: 0.5 } } });
  expect(ctx.sinkIds).toEqual(["usb-4"]);
  expect(ctx.merger).toBe(merger);
  router.dispose();
});

it("sends the click to its own device, with its own clock, and leaves it off the main output", async () => {
  const { ctx, router } = setup([
    { deviceId: "usb-4", label: "Interface" },
    { deviceId: "hp", label: "Headphones" },
  ]);
  // Forget the default wiring from the constructor, so only the routing under test is recorded.
  for (const gain of ctx.gains) gain.connect.mockClear();
  await router.apply(outputs({ clickDevice: { deviceId: "hp", label: "Headphones" } }));
  const click = FakeContext.instances.at(-1)!;
  expect(click).not.toBe(ctx);
  expect(click.sinkIds).toEqual(["hp"]);
  expect(router.clickTarget().ctx).toBe(click);
  expect(ctx.gains[1].connect).not.toHaveBeenCalledWith(ctx.destination);
  expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
});

it("keeps the click on Main with a warning when its own device cannot be selected", async () => {
  FakeContext.rejectSinks.add("hp");
  const { ctx, router, warn } = setup([
    { deviceId: "usb-4", label: "Interface" },
    { deviceId: "hp", label: "Headphones" },
  ]);
  await router.apply(outputs({ clickDevice: { deviceId: "hp", label: "Headphones" } }));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("Headphones"));
  expect(router.clickTarget().ctx).toBe(ctx);
  expect(ctx.gains[1].connect).toHaveBeenCalledWith(ctx.destination);
});

it("moves the click back to Main when its device disappears, and closes its context", async () => {
  const { stub, ctx, router, warn } = setup([
    { deviceId: "usb-4", label: "Interface" },
    { deviceId: "hp", label: "Headphones" },
  ]);
  await router.apply(outputs({ clickDevice: { deviceId: "hp", label: "Headphones" } }));
  const click = FakeContext.instances.at(-1)!;
  stub.devices = [{ deviceId: "usb-4", label: "Interface" }];
  stub.listeners[0]();
  await vi.waitFor(() => expect(click.closed).toBe(true));
  expect(router.clickTarget().ctx).toBe(ctx);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("Headphones"));
  router.dispose();
});

it("plays a test tone on the one bus it is asked for", async () => {
  const { ctx, router } = setup();
  await router.apply(outputs());
  router.testTone("aux2");
  // The tone's oscillator is chained through its gain into the bus, so the bus is the last thing the chain connects to.
  const osc = ctx.oscillators.at(-1)!;
  expect(osc.connect).toHaveBeenCalledWith(router.buses.aux2);
  expect(osc.connect).not.toHaveBeenCalledWith(router.buses.main);
});
