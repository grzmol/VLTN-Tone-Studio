import { SeparateClickOutput } from "./click-output";

// Routes the tracks and the click to output buses. A bus is a stereo channel pair on one device: the tracks might sit on outputs
// 1/2 and the click on 3/4 of a multichannel interface. The click can also use a second device of its own (a headphone jack for the
// in-ear click, say), and the aux buses are spare pairs for other tracks. When the device has fewer channels, or cannot be selected,
// the buses fall back to the default stereo output so audio never goes silent. The caller is told about every fallback.
//
// The planning and the device lookup are pure functions. OutputRouter is the thin WebAudio adapter around them.

declare global {
  interface AudioContext {
    // Chromium 110 and later. The DOM typings this project builds against do not declare it yet.
    setSinkId(sinkId: string): Promise<void>;
  }
}

export const BUS_NAMES = ["main", "click", "aux1", "aux2"] as const;

export type BusName = (typeof BUS_NAMES)[number];

export const BUS_LABELS: Record<BusName, string> = { main: "Main", click: "Click", aux1: "Aux 1", aux2: "Aux 2" };

export interface Bus {
  /** Zero-based output pair, [0, 1] is outputs 1 and 2 */
  channels: [number, number];
  /** Linear gain, 0 to 2 */
  gain: number;
}

export interface OutputDevice {
  deviceId: string;
  label: string;
}

export interface OutputConfig {
  /** The main device. "" is the system default. */
  deviceId: string;
  /** The main device's label, so a saved device can be found again when its ID changes */
  label: string;
  /** A device of its own for the click, or null to share the main device */
  clickDevice: OutputDevice | null;
  buses: Record<BusName, Bus>;
}

/** Calls `value` for each bus, in BUS_NAMES order. */
function busRecord<T>(value: (name: BusName) => T): Record<BusName, T> {
  return Object.fromEntries(BUS_NAMES.map((name) => [name, value(name)])) as Record<BusName, T>;
}

export const DEFAULT_OUTPUTS: OutputConfig = {
  deviceId: "",
  label: "",
  clickDevice: null,
  buses: busRecord((): Bus => ({ channels: [0, 1], gain: 1 })),
};

const SETTINGS_KEY = "vltn.performance.outputs.v1";

export interface RoutePlan {
  /** Channels the destination needs. Ignored when `multichannel` is false. */
  outputs: number;
  /** False means every bus connects straight to the stereo destination */
  multichannel: boolean;
  buses: Record<BusName, [number, number]>;
  /** Set when a requested pair does not exist on the device, so every bus uses outputs 1/2 */
  fellBack: boolean;
}

/** `gain` kept between 0 and 2. Anything that is not a number is silence. */
export function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 0;
  return Math.max(0, Math.min(2, gain));
}

/** Every bus on outputs 1/2 of the main device, and the click on the main device too. Used when a device cannot be selected. */
export function stereoOnly(config: OutputConfig): OutputConfig {
  return { ...config, clickDevice: null, buses: busRecord((name): Bus => ({ ...config.buses[name], channels: [0, 1] })) };
}

/**
 * The channel layout for `config` on a device with `maxChannels` outputs. A pair must be two neighbouring outputs that the device
 * has. If any bus asks for a pair the device lacks, every bus falls back to outputs 1/2.
 */
export function planRoutes(config: OutputConfig, maxChannels = 2): RoutePlan {
  const available = Math.max(2, maxChannels);
  const pairs = BUS_NAMES.map((name) => config.buses[name].channels);
  const stereo = busRecord((): [number, number] => [0, 1]);
  const valid = pairs.every(([left, right]) => Number.isInteger(left) && left >= 0 && right === left + 1 && right < available);
  if (!valid) return { outputs: 2, multichannel: false, buses: stereo, fellBack: true };
  const top = Math.max(...pairs.map(([, right]) => right));
  if (top < 2) return { outputs: 2, multichannel: false, buses: stereo, fellBack: false };
  return { outputs: available, multichannel: true, buses: busRecord((name) => config.buses[name].channels), fellBack: false };
}

/**
 * The device ID to use for `config`, given the devices the system lists. "" is the default output. A saved device keeps its ID when it is
 * still there, else the first device with the same label. Returns null when the device is gone.
 */
export function resolveDeviceId(config: OutputDevice, devices: OutputDevice[]): string | null {
  if (!config.deviceId) return "";
  if (devices.some((device) => device.deviceId === config.deviceId)) return config.deviceId;
  const byLabel = config.label ? devices.find((device) => device.label === config.label) : undefined;
  return byLabel?.deviceId ?? null;
}

function readBus(bus: Partial<Bus> | undefined, fallback: Bus): Bus {
  if (!bus || !Array.isArray(bus.channels) || bus.channels.length !== 2 || typeof bus.gain !== "number") return fallback;
  const [left, right] = bus.channels;
  return { channels: [left, right], gain: clampGain(bus.gain) };
}

function readDevice(device: Partial<OutputDevice> | null | undefined): OutputDevice | null {
  if (!device || typeof device.deviceId !== "string" || !device.deviceId) return null;
  return { deviceId: device.deviceId, label: typeof device.label === "string" ? device.label : "" };
}

/** The saved outputs, or the defaults when nothing usable is stored. */
export function loadOutputSettings(storage: Storage | null): OutputConfig {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_OUTPUTS;
    const saved = JSON.parse(raw) as Partial<OutputConfig>;
    return {
      deviceId: typeof saved.deviceId === "string" ? saved.deviceId : "",
      label: typeof saved.label === "string" ? saved.label : "",
      clickDevice: readDevice(saved.clickDevice),
      buses: busRecord((name) => readBus(saved.buses?.[name], DEFAULT_OUTPUTS.buses[name])),
    };
  } catch {
    return DEFAULT_OUTPUTS;
  }
}

/** Saves the outputs. Storage can be full or blocked, and the audio must not depend on it, so a failure is ignored. */
export function saveOutputSettings(storage: Storage | null, config: OutputConfig): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(config));
  } catch {
    // Keep the settings in memory for this session.
  }
}

/** The system's audio outputs, or null when the platform cannot list them. */
export async function listOutputDevices(): Promise<OutputDevice[] | null> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput").map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    return null;
  }
}

/** Where a click goes: its context, its bus, and how to turn a main-clock time into that context's time. */
export interface ClickTarget {
  ctx: AudioContext;
  bus: GainNode;
  localTime: (time: number) => number;
}

/** What is wired right now. Re-routing happens only when this changes. */
function routeKey(mainId: string | null, clickId: string | null, config: OutputConfig): string {
  return JSON.stringify([mainId, clickId, BUS_NAMES.map((name) => config.buses[name].channels)]);
}

/**
 * Connects the buses to the main AudioContext's destination. `main`, `aux1` and `aux2` (and `click`, unless it has its own device) are
 * stereo gain nodes that the player feeds. They join a ChannelMergerNode when the device has a channel pair past 1/2, else they go
 * straight to the destination.
 */
export class OutputRouter {
  readonly buses: Record<BusName, GainNode>;
  private merger: ChannelMergerNode | null = null;
  private click: SeparateClickOutput | null = null;
  private config = DEFAULT_OUTPUTS;
  /** The route key that is wired now. An empty string means the last attempt failed, so the next attempt tries again. */
  private applied = "";
  private queue: Promise<void> = Promise.resolve();
  private readonly onDeviceChange = () => void this.apply(this.config);

  constructor(
    private readonly ctx: AudioContext,
    private readonly warn: (message: string) => void,
  ) {
    this.buses = busRecord(() => {
      // Always stereo, so a mono click still has a right channel to send to a multichannel output.
      const bus = ctx.createGain();
      bus.channelCount = 2;
      bus.channelCountMode = "explicit";
      bus.channelInterpretation = "speakers";
      return bus;
    });
    this.wire(planRoutes(DEFAULT_OUTPUTS), false);
    globalThis.navigator?.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);
  }

  /** Channels the main device reports. A stereo device, or one that reports nothing, has two. */
  get channels(): number {
    return this.ctx.destination.maxChannelCount || 2;
  }

  /** Applies `config`. Calls run one after another, so a device change cannot overlap a selection. */
  apply(config: OutputConfig): Promise<void> {
    this.config = config;
    this.queue = this.queue.then(() => this.route(config)).catch((error) => this.warn(`The audio outputs could not be set. ${String(error)}`));
    return this.queue;
  }

  /** Resumes the main context and, when the click has its own device, that context too. */
  async resume(): Promise<void> {
    await this.ctx.resume();
    await this.click?.resume();
  }

  /** Where a click goes: the click's own device when it has one, else the main click bus. */
  clickTarget(): ClickTarget {
    const click = this.click;
    if (click) return { ctx: click.ctx, bus: click.bus, localTime: (time) => click.localTime(time) };
    return { ctx: this.ctx, bus: this.buses.click, localTime: (time) => time };
  }

  /** A short tone on one bus only, so each output can be checked. */
  testTone(name: BusName): void {
    const { ctx, bus } = name === "click" ? this.clickTarget() : { ctx: this.ctx, bus: this.buses[name] };
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + 0.05;
    osc.frequency.setValueAtTime(880, start);
    gain.gain.setValueAtTime(0.25, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    osc.connect(gain).connect(bus);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + 0.5);
    void ctx.resume();
  }

  dispose(): void {
    globalThis.navigator?.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    void this.closeClick();
  }

  private async route(config: OutputConfig): Promise<void> {
    this.setGains(config);
    const devices = await listOutputDevices();
    const resolve = (device: OutputDevice): string | null => (devices ? resolveDeviceId(device, devices) : device.deviceId);
    const mainId = resolve(config);
    const clickId = config.clickDevice ? resolve(config.clickDevice) : null;
    // Changes that only move a gain, or an unrelated device appearing, leave the sinks alone.
    const key = routeKey(mainId, clickId, config);
    if (key === this.applied) return;
    this.applied = "";
    if (mainId === null || !(await this.selectSink(mainId))) {
      this.warn(`"${config.label || config.deviceId || "The audio output"}" is not available. Audio is playing on the default output.`);
      await this.closeClick();
      await this.selectSink("");
      this.wire(planRoutes(stereoOnly(config)), false);
      this.applied = key;
      return;
    }
    const plan = planRoutes(config, this.ctx.destination.maxChannelCount);
    if (plan.fellBack) this.warn("This output does not have the channels set for the buses. Every bus uses outputs 1 and 2.");
    const separate = await this.openClick(config.clickDevice, clickId);
    this.wire(plan, separate);
    this.applied = key;
  }

  /** Opens, keeps or closes the click's own device. Returns true when the click is on that device. */
  private async openClick(device: OutputDevice | null, deviceId: string | null): Promise<boolean> {
    if (!device) {
      await this.closeClick();
      return false;
    }
    if (deviceId === null) {
      this.warn(`"${device.label || device.deviceId}" is not available. The click is playing on the main output.`);
      await this.closeClick();
      return false;
    }
    if (this.click?.deviceId === deviceId) return true;
    await this.closeClick();
    try {
      this.click = await SeparateClickOutput.open(this.ctx, deviceId);
      return true;
    } catch {
      this.warn(`"${device.label || device.deviceId}" could not be used for the click. The click is playing on the main output.`);
      return false;
    }
  }

  private async closeClick(): Promise<void> {
    const click = this.click;
    this.click = null;
    await click?.dispose();
  }

  private async selectSink(deviceId: string): Promise<boolean> {
    try {
      await this.ctx.setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  private setGains(config: OutputConfig): void {
    for (const name of BUS_NAMES) {
      const { ctx, bus } = name === "click" ? this.clickTarget() : { ctx: this.ctx, bus: this.buses[name] };
      bus.gain.setValueAtTime(clampGain(config.buses[name].gain), ctx.currentTime);
    }
  }

  /** Connects every bus that stays on the main device. The click is left out when it has its own device. */
  private wire(plan: RoutePlan, separateClick: boolean): void {
    const destination = this.ctx.destination;
    const names = BUS_NAMES.filter((name) => !(separateClick && name === "click"));
    for (const name of BUS_NAMES) this.buses[name].disconnect();
    this.merger?.disconnect();
    this.merger = null;
    destination.channelCount = plan.outputs;
    if (!plan.multichannel) {
      destination.channelInterpretation = "speakers";
      for (const name of names) this.buses[name].connect(destination);
      return;
    }
    // "discrete" maps merger input N to output N, instead of speaker-layout mixing that would fold 3/4 back onto 1/2.
    destination.channelInterpretation = "discrete";
    const merger = this.ctx.createChannelMerger(plan.outputs);
    for (const name of names) {
      const [left, right] = plan.buses[name];
      this.buses[name].connect(merger, 0, left);
      this.buses[name].connect(merger, 1, right);
    }
    merger.connect(destination);
    this.merger = merger;
  }
}
