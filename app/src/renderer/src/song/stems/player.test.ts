import { afterEach, expect, it, vi } from "vitest";
import { createPlaybackEngine } from "../audio/playback-engine";
import { DEFAULT_OUTPUTS, type OutputConfig } from "../audio/outputs";
import type { Stems } from "../types";
import { StemPlayer } from "./player";

const loadDrumSample = vi.hoisted(() => vi.fn());
vi.mock("../band/samples", () => ({ loadDrumSample }));

class Context {
  static instances: Context[] = [];
  currentTime = 10;
  /** How far this context's audio clock runs behind the performance clock, as a second device's clock can */
  clockShift = 0;
  destination = {};
  oscillators: ReturnType<Context["node"]>[] = [];
  gains: ReturnType<Context["node"]>[] = [];
  sources: ReturnType<Context["node"]>[] = [];
  constructor() {
    Context.instances.push(this);
  }
  async resume() {}
  async close() {}
  getOutputTimestamp() {
    return { contextTime: this.currentTime - this.clockShift, performanceTime: this.currentTime * 1000 };
  }
  node() {
    return {
      connect: vi.fn().mockReturnThis(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
      frequency: { setValueAtTime: vi.fn() },
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setValueCurveAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      buffer: null,
      playbackRate: { value: 1 },
      fftSize: 2048,
    };
  }
  createBuffer() {
    return { copyToChannel: vi.fn() };
  }
  createGain() {
    const n = this.node();
    this.gains.push(n);
    return n;
  }
  createAnalyser() {
    return this.node();
  }
  createStereoPanner() {
    return { ...this.node(), pan: { value: 0, setTargetAtTime: vi.fn() } };
  }
  createBufferSource() {
    const n = this.node();
    this.sources.push(n);
    return n;
  }
  createBiquadFilter() {
    return { ...this.node(), Q: { setValueAtTime: vi.fn() } };
  }
  createOscillator() {
    const n = this.node();
    this.oscillators.push(n);
    return n;
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  loadDrumSample.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Context.instances = [];
});
it("anchors clicks and stems to one audio clock, preserves bar phase on seek, and cancels queued clicks on pause", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25 });
  await player.play();
  const ctx = Context.instances[0];
  expect(Context.instances).toHaveLength(1);
  expect(ctx.sources[0].start.mock.calls[0]).toEqual([10.02, 0]);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(10.02);
  player.pause();
  expect(ctx.oscillators[0].stop).toHaveBeenLastCalledWith();
  const count = ctx.oscillators.length;
  ctx.currentTime = 11;
  vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(count);
  await player.seek(3.75);
  await player.play();
  ctx.currentTime = 11.2;
  vi.advanceTimersByTime(25);
  const next = ctx.oscillators.at(-1)!;
  // Beat 8 is at song second 4, a downbeat, not a new bar at the seek point.
  expect(next.start.mock.calls[0][0]).toBeCloseTo(11.27);
  expect(next.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  const muted = ctx.oscillators.length;
  ctx.currentTime = 12;
  vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(muted);
  expect(player.isPlaying).toBe(true);
  await player.dispose();
});

it("can resume after pausing during the audio start pre-roll", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  expect(player.position).toBeLessThan(0);
  player.pause();
  expect(player.position).toBe(0);
  await player.play();
  expect(Context.instances[0].sources.at(-1)!.start).toHaveBeenCalledWith(10.02, 0);
  await player.dispose();
});

it("anchors the first downbeat after an intro and preserves its phase through pause and seek", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25, firstBeat: 1.25 });
  await player.play();
  const ctx = Context.instances[0];
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime = 11.2;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(11.27);
  expect(ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  ctx.currentTime = 11.4;
  player.pause();
  const count = ctx.oscillators.length;
  ctx.currentTime = 12;
  await player.play();
  expect(ctx.oscillators).toHaveLength(count);
  ctx.currentTime = 12.35;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(12.39);
  expect(ctx.oscillators.at(-1)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1000);
  await player.seek(3.2);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(12.42);
  expect(ctx.oscillators.at(-1)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  await player.dispose();
});

it("does not replay the beat just before a seek or burst missed clicks after a stall", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25, firstBeat: 1.25 });
  await player.seek(1.26);
  await player.play();
  const ctx = Context.instances[0];
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime = 13.2;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime = 13.45;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(1);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(13.51);
  await player.seek(9.9);
  const count = ctx.oscillators.length;
  ctx.currentTime = 14;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(count);
  await player.dispose();
});

it("clicks a count-in on the grid before the audio starts, and a pause during it returns to the requested position", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await player.play({ countInBeats: 4 });
  const ctx = Context.instances[0];
  // One bar at 120 BPM is two seconds: audio starts at 2.0 s after the first click.
  expect(ctx.sources[0].start.mock.calls[0][0]).toBeCloseTo(12.02);
  const clicks = ctx.oscillators.map((osc) => osc.start.mock.calls[0][0]);
  [10.02, 10.52, 11.02, 11.52].forEach((at, i) => expect(clicks[i]).toBeCloseTo(at));
  expect(ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  expect(ctx.oscillators[1].frequency.setValueAtTime.mock.calls[0][0]).toBe(1000);
  ctx.currentTime = 10.5;
  expect(player.position).toBeLessThan(0);
  player.pause();
  expect(player.position).toBe(0);
  await player.dispose();
});

it("starts the audio before the requested position by the pre-roll, clamped at the start of the song", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(10000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await player.seek(60);
  await player.play({ preRollBeats: 2 });
  expect(Context.instances[0].sources.at(-1)!.start.mock.calls[0][1]).toBeCloseTo(59);
  await player.dispose();
  const early = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(10000)] } });
  early.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await early.seek(0.5);
  await early.play({ preRollBeats: 4 });
  expect(Context.instances.at(-1)!.sources.at(-1)!.start.mock.calls[0][1]).toBe(0);
  await early.dispose();
});

it("clicks on its own grid while stopped, and stops the rehearsal when the song plays", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "stopped", bpm: 120, beats: 4, volume: 0.25 });
  const ctx = Context.instances[0];
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(10.02);
  ctx.currentTime = 10.5;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(10.52);
  await player.play();
  const count = ctx.oscillators.length;
  ctx.currentTime = 11;
  vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(count);
  expect(player.isPlaying).toBe(true);
  await player.dispose();
});

it("keeps the count-in when the metronome changes mid-count-in, and pause cancels it", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await player.play({ countInBeats: 4 });
  const ctx = Context.instances[0];
  const countIn = ctx.oscillators.slice(0, 4);
  // stop() with no argument is the cancel; the scheduled stop passes its end time.
  const cancelled = (osc: (typeof countIn)[number]) => osc.stop.mock.calls.some((call) => call.length === 0);
  ctx.currentTime = 10.2;
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.5 });
  expect(countIn.some(cancelled)).toBe(false);
  player.pause();
  expect(countIn.every(cancelled)).toBe(true);
  await player.dispose();
});

/** A Context whose destination reports a device's channel count, and which records the output nodes it creates. */
class OutputContext extends Context {
  destination: { maxChannelCount?: number; channelCount?: number; channelInterpretation?: string } = { maxChannelCount: 4, channelCount: 2 };
  analysers: ReturnType<Context["node"]>[] = [];
  createAnalyser() {
    const analyser = super.createAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }
  merger: ReturnType<Context["node"]> | null = null;
  sinkIds: string[] = [];
  /** How many of the next setSinkId calls reject */
  sinkFailures = 0;
  createChannelMerger() {
    this.merger = this.node();
    return this.merger;
  }
  async setSinkId(sinkId: string) {
    this.sinkIds.push(sinkId);
    if (this.sinkFailures > 0) {
      this.sinkFailures--;
      throw new Error("NotFoundError");
    }
  }
}

function oneStem(): Stems {
  return { other: { sampleRate: 100, channels: [new Float32Array(1000)] } } as Stems;
}

function interface4(click: [number, number]): OutputConfig {
  return {
    deviceId: "usb-4",
    label: "Interface",
    clickDevice: null,
    buses: { ...DEFAULT_OUTPUTS.buses, click: { channels: click, gain: 1 } },
  };
}

it("sends the click to outputs 3 and 4 and the tracks to 1 and 2 on a four-output interface", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const ctx = Context.instances[0] as OutputContext;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.sinkIds).toEqual(["usb-4"]);
  expect(ctx.merger).not.toBeNull();
  expect(ctx.destination.channelCount).toBe(4);
  expect(ctx.destination.channelInterpretation).toBe("discrete");
  // The first two gains are the main and click buses, created before any voice.
  const [main, click] = ctx.gains;
  expect(main.connect).toHaveBeenCalledWith(ctx.merger, 0, 0);
  expect(main.connect).toHaveBeenCalledWith(ctx.merger, 1, 1);
  expect(click.connect).toHaveBeenCalledWith(ctx.merger, 0, 2);
  expect(click.connect).toHaveBeenCalledWith(ctx.merger, 1, 3);
  await player.dispose();
});

it("falls back to the default output and warns when the device cannot be selected", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const warnings: string[] = [];
  player.onOutputWarning = (message) => warnings.push(message);
  const ctx = Context.instances[0] as OutputContext;
  ctx.sinkFailures = 1;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.sinkIds).toEqual(["usb-4", ""]);
  expect(ctx.merger).toBeNull();
  expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
  expect(ctx.gains[1].connect).toHaveBeenCalledWith(ctx.destination);
  expect(warnings).toHaveLength(1);
  await player.dispose();
});

it("keeps both buses on outputs 1 and 2 and warns when the device has no pair for the click", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const warnings: string[] = [];
  player.onOutputWarning = (message) => warnings.push(message);
  const ctx = Context.instances[0] as OutputContext;
  ctx.destination.maxChannelCount = 2;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.merger).toBeNull();
  expect(ctx.gains[1].connect).toHaveBeenCalledWith(ctx.destination);
  expect(warnings).toHaveLength(1);
  await player.dispose();
});

it("moves to the default output when the device disappears, and back when it returns", async () => {
  const listeners: Array<() => void> = [];
  let devices = [{ deviceId: "usb-4", label: "Interface", kind: "audiooutput" }];
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => devices,
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
    },
  });
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const warnings: string[] = [];
  player.onOutputWarning = (message) => warnings.push(message);
  const ctx = Context.instances[0] as OutputContext;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.merger).not.toBeNull();

  devices = [];
  listeners[0]();
  await vi.waitFor(() => expect(ctx.sinkIds).toEqual(["usb-4", ""]));
  expect(ctx.gains[1].connect).toHaveBeenLastCalledWith(ctx.destination);
  expect(warnings).toHaveLength(1);
  expect(player.isPlaying).toBe(false);

  devices = [{ deviceId: "usb-4", label: "Interface", kind: "audiooutput" }];
  listeners[0]();
  await vi.waitFor(() => expect(ctx.sinkIds).toEqual(["usb-4", "", "usb-4"]));
  expect(ctx.merger).not.toBeNull();
  await player.dispose();
});

it("plays the count-in on the click device at the time that device's clock reads", async () => {
  // The second context is the click device; its clock runs 5 s behind the main one.
  class SecondDevice extends OutputContext {
    clockShift = Context.instances.length > 1 ? 5 : 0;
  }
  vi.stubGlobal("AudioContext", SecondDevice);
  const player = new StemPlayer(oneStem());
  await player.setOutputs({ ...interface4([2, 3]), clickDevice: { deviceId: "hp", label: "Headphones" } });
  const [main, sink] = Context.instances as OutputContext[];
  expect(sink.sinkIds).toEqual(["hp"]);
  await player.play({ countInBeats: 4 });
  expect(main.oscillators).toHaveLength(0);
  // The main clock's beats are at 10.02, 10.52, 11.02 and 11.52; on the click device they read 5 s earlier.
  expect(sink.oscillators).toHaveLength(4);
  expect(sink.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(5.02);
  expect(sink.oscillators[1].start.mock.calls[0][0]).toBeCloseTo(5.52);
  expect(sink.oscillators[3].start.mock.calls[0][0]).toBeCloseTo(6.52);
  await player.dispose();
});

it("sends each track to its assigned bus, and leaves the others on Main", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer({
    drums: { sampleRate: 100, channels: [new Float32Array(1000)] },
    other: { sampleRate: 100, channels: [new Float32Array(1000)] },
  } as Stems);
  const ctx = Context.instances[0] as OutputContext;
  const [drumsAnalyser, otherAnalyser] = ctx.analysers;
  player.setTrackBuses({ drums: "aux1" });
  expect(drumsAnalyser.disconnect).toHaveBeenCalled();
  expect(drumsAnalyser.connect).toHaveBeenLastCalledWith(ctx.gains[2]);
  expect(otherAnalyser.connect).toHaveBeenLastCalledWith(ctx.gains[0]);
  await player.dispose();
});

it("plays a planned jump at its boundary: the stems stop there and restart at the target on the same audio clock", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  // Song 5 is 5 s after the start at 10.02 on the audio clock.
  expect(player.prepareJump(2, 5)).toBeCloseTo(15.02);
  const [old, next] = ctx.sources;
  expect(old.stop).toHaveBeenLastCalledWith(15.02);
  expect(next.start).toHaveBeenCalledWith(15.02, 2);
  ctx.currentTime = 14.9;
  expect(player.position).toBeCloseTo(4.88);
  ctx.currentTime = 15.5;
  expect(player.position).toBeCloseTo(2.48);
  // A second jump cannot be queued on top of the first.
  expect(player.prepareJump(0, 9)).toBeNull();
  await player.dispose();
});

it("cancels a waiting jump in time, and the stems keep their place", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  player.prepareJump(2, 5);
  const [old, next] = ctx.sources;
  expect(player.cancelJump()).toBe(true);
  expect(next.stop).toHaveBeenCalledWith(0);
  // The stems go back to the song's own end (10 s of audio from 10.02), not to a far-off stop.
  expect(old.stop).toHaveBeenLastCalledWith(20.02);
  ctx.currentTime = 14.9;
  expect(player.position).toBeCloseTo(4.88);
  // The cancelled jump leaves the timeline as it was, so a new one can be queued.
  expect(player.prepareJump(2, 6)).toBeCloseTo(16.02);
  await player.dispose();
});

it("refuses to cancel a jump that is already too close to take effect, and the jump then stands", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  player.prepareJump(2, 5);
  ctx.currentTime = 14.95;
  expect(player.cancelJump()).toBe(false);
  ctx.currentTime = 15.1;
  expect(player.position).toBeCloseTo(2.08);
  await player.dispose();
});

it("keeps the metronome on the song's bar grid through a jump, and clicks the target's beats", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25 });
  await player.play();
  const ctx = Context.instances[0];
  const step = (to: number) => {
    for (let t = ctx.currentTime; t < to; t += 0.25) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(25);
    }
    ctx.currentTime = to;
    vi.advanceTimersByTime(25);
  };
  step(12);
  player.prepareJump(2, 5);
  step(15.6);
  const times = ctx.oscillators.map((osc) => osc.start.mock.calls[0][0] as number);
  // Song 2 (beat 4, a downbeat) plays again at 15.02; song 2.5 at 15.52. The old passage's beat at song 5 is not clicked.
  const after = times.filter((t) => t >= 15);
  expect(after).toHaveLength(2);
  expect(after[0]).toBeCloseTo(15.02);
  expect(after[1]).toBeCloseTo(15.52);
  expect(ctx.oscillators.find((osc) => Math.abs((osc.start.mock.calls[0][0] as number) - 15.02) < 1e-6)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  await player.dispose();
});

const pcm = (frames: number) => ({ sampleRate: 100, channels: [new Float32Array(frames)] });

it("plays only the trimmed range, and fades in and out at its ends", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: pcm(1000) }, undefined, { trimStart: 2, trimEnd: 6, fadeIn: 0.5, fadeOut: 1 });
  expect(player.start).toBe(2);
  expect(player.duration).toBe(6);
  expect(player.position).toBe(2);
  await player.play();
  const ctx = Context.instances[0];
  expect(ctx.sources[0].start).toHaveBeenCalledWith(10.02, 2);
  expect(ctx.sources[0].stop).toHaveBeenCalledWith(14.02);
  const ramps = ctx.gains.flatMap((g) => g.gain.linearRampToValueAtTime.mock.calls);
  expect(ramps).toEqual([
    [1, 10.52],
    [0, 14.02],
  ]);
  await player.seek(1);
  // Playing from 10.02 on a clock still at 10, so the position is just short of the trim start.
  expect(player.position).toBeCloseTo(2, 1);
  await player.dispose();
});

it("hands over to the next song on the same clock, fading out the outgoing one", async () => {
  vi.stubGlobal("AudioContext", Context);
  const engine = createPlaybackEngine();
  const outgoing = new StemPlayer({ other: pcm(1000) }, engine);
  const incoming = new StemPlayer({ other: pcm(500) }, engine);
  await outgoing.play();
  const ctx = Context.instances[0];
  expect(Context.instances).toHaveLength(1);
  ctx.currentTime = 12;
  const join = { startAt: 19, fadeLength: 1, stopAt: 20.02, lead: {} };
  expect(outgoing.chainNext(incoming, join)).toBe(true);
  expect(ctx.sources[0].stop).toHaveBeenLastCalledWith(20.02);
  expect(ctx.sources[1].start).toHaveBeenCalledWith(19, 0);
  const curves = ctx.gains.flatMap((g) => g.gain.setValueCurveAtTime.mock.calls).map((call) => call.slice(1));
  expect(curves).toEqual([
    [19, 1],
    [19, 1],
  ]);
  expect(incoming.isPlaying).toBe(true);
  // The outgoing song's own end hands over without starting a rehearsal grid.
  const clicks = ctx.oscillators.length;
  ctx.currentTime = 20.02;
  ctx.sources[0].onended?.();
  expect(outgoing.isPlaying).toBe(false);
  expect(ctx.oscillators).toHaveLength(clicks);
  expect(outgoing.detachNext()).toBe(incoming);
  await outgoing.dispose();
  await incoming.dispose();
  await engine.close();
});

it("keeps a handed-over song's stems running to their end when it is disposed", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const engine = createPlaybackEngine();
  const outgoing = new StemPlayer({ other: pcm(1000) }, engine);
  const incoming = new StemPlayer({ other: pcm(500) }, engine);
  await outgoing.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  outgoing.chainNext(incoming, { startAt: 19, fadeLength: 1, stopAt: 20.02, lead: {} });
  expect(outgoing.detachNext()).toBe(incoming);
  ctx.currentTime = 19.5;
  await outgoing.dispose();
  // Stopping now would cut the crossfade short: only the scheduled stop may end the outgoing stems.
  expect(ctx.sources[0].stop.mock.calls.some((call) => call.length === 0)).toBe(false);
  vi.advanceTimersByTime(1000);
  await incoming.dispose();
  await engine.close();
});

it("cancels a hand-over when the outgoing song is paused, and the next song stops", async () => {
  vi.stubGlobal("AudioContext", Context);
  const engine = createPlaybackEngine();
  const outgoing = new StemPlayer({ other: pcm(1000) }, engine);
  const incoming = new StemPlayer({ other: pcm(500) }, engine);
  await outgoing.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  expect(outgoing.chainNext(incoming, { startAt: 19, fadeLength: 1, stopAt: 20.02, lead: {} })).toBe(true);
  outgoing.pause();
  expect(incoming.isPlaying).toBe(false);
  expect(outgoing.isPlaying).toBe(false);
  expect(ctx.sources[1].stop.mock.calls.some((call) => call.length === 0)).toBe(true);
  await outgoing.dispose();
  await incoming.dispose();
  await engine.close();
});

it("builds the buffers a channel at a time, yielding after each channel", async () => {
  vi.stubGlobal("AudioContext", Context);
  const stems = {
    drums: { sampleRate: 100, channels: [new Float32Array(10), new Float32Array(10)] },
    other: { sampleRate: 100, channels: [new Float32Array(10)] },
  } as Stems;
  const pause = vi.fn(async () => {});
  const player = await StemPlayer.create(stems, undefined, {}, pause);
  expect(pause).toHaveBeenCalledTimes(3);
  expect(player.names).toEqual(["drums", "other"]);
  await player.dispose();
});

it("applies a new trim while the song plays by moving its stop", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: pcm(1000) });
  await player.play();
  const ctx = Context.instances[0];
  player.setShape({ trimEnd: 4 });
  expect(player.duration).toBe(4);
  expect(ctx.sources[0].stop).toHaveBeenLastCalledWith(14.02);
  await player.dispose();
});

it("loops a song by jumping back to its trimmed start just before the end, with no gap", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: pcm(1000) }, undefined, { trimStart: 2, trimEnd: 8, endBehaviour: "loop" });
  await player.play();
  const ctx = Context.instances[0];
  expect(player.behaviour).toBe("loop");
  // The pass ends at 10.02 + 6 = 16.02. Within a second of that the next pass is scheduled from the start.
  ctx.currentTime = 15.2;
  vi.advanceTimersByTime(50);
  expect(ctx.sources[1].start).toHaveBeenCalledWith(16.02, 2);
  await player.dispose();
  vi.useRealTimers();
});

it("announces the loop pass it schedules, so the session can tell the MIDI scheduler", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: pcm(1000) }, undefined, { trimStart: 2, trimEnd: 8, endBehaviour: "loop" });
  const passes: unknown[] = [];
  player.onLoopScheduled = (loop) => passes.push(loop);
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 15.2;
  vi.advanceTimersByTime(50);
  expect(passes).toEqual([{ to: 2, at: 8, when: 16.02 }]);
  // One pass is announced once, however often the timer checks.
  vi.advanceTimersByTime(200);
  expect(passes).toHaveLength(1);
  await player.dispose();
  vi.useRealTimers();
});

it("swaps a render in at a beat, keeping the song position, and plays the new buffers at the new rate", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  // Ten song seconds at 100 frames a second, at the song's own speed
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  expect(player.position).toBeCloseTo(1.98);
  // At 50% the same song is twenty audio seconds: a buffer of 2000 frames
  const render = await player.renderBuffers({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } }, 0.5, async () => {});
  const swap = player.swapRender(render);
  // The next beat (0.5 s grid) at or after song 2.03 is song 2.5, which plays at audio 12.52
  expect(swap).toEqual({ at: 2.5, when: 12.52 });
  expect(ctx.sources[1].start.mock.calls[0]).toEqual([12.52, 5]);
  expect(ctx.sources[1].stop.mock.calls[0][0]).toBeCloseTo(27.52);
  expect(player.playbackRate).toBe(0.5);
  // The song time is continuous through the swap, then runs at half speed
  ctx.currentTime = 12.52;
  expect(player.position).toBeCloseTo(2.5);
  ctx.currentTime = 13.52;
  expect(player.position).toBeCloseTo(3);
  expect(player.swapRender(render)).toBeNull();
});

it("applies a render at once while stopped, and a later start plays it at the new rate", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  player.pause();
  const render = await player.renderBuffers({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } }, 0.5, async () => {});
  player.applyRender(render);
  expect(player.playbackRate).toBe(0.5);
  expect(player.position).toBeCloseTo(1.98);
  await player.play();
  // Song 1.98 sits at buffer 3.96 s, which the new source starts from
  expect(ctx.sources.at(-1)!.start.mock.calls[0][1]).toBeCloseTo(3.96);
});

it("counts a count-in at the song tempo times its rate", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } }, undefined, {}, "now", 0.5);
  await player.play({ bpm: 120, countInBeats: 4 });
  const ctx = Context.instances[0];
  // At 120 BPM a beat is 0.5 song seconds, which is one audio second at 50%
  const clicks = ctx.oscillators.slice(0, 4).map((o) => o.start.mock.calls[0][0]);
  expect(clicks).toEqual([10.02, 11.02, 12.02, 13.02]);
});

it("cancelling a render swap goes back to the old rate and buffers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  const render = await player.renderBuffers({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } }, 0.5, async () => {});
  player.swapRender(render);
  expect(player.playbackRate).toBe(0.5);
  // Too close to the swap to cancel: it stands
  ctx.currentTime = 12.4;
  expect(player.cancelJump()).toBe(false);
  expect(player.playbackRate).toBe(0.5);
  // Early enough, the swap is undone: the old rate is back
  ctx.currentTime = 11;
  expect(player.cancelJump()).toBe(true);
  expect(player.playbackRate).toBe(1);
});

it("scales every track by the master gain, with the mix, and ramps the change", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({
    drums: { sampleRate: 100, channels: [new Float32Array(1000)] },
    other: { sampleRate: 100, channels: [new Float32Array(1000)] },
  } as Stems);
  const ctx = Context.instances[0];
  player.setMix({ drums: { volume: 1, mute: false, solo: false }, other: { volume: 0.5, mute: false, solo: false } }, 2);
  // Only the volume gains are ramped by a mix change, so they are the nodes with a target set. Drums is built first.
  const ramped = ctx.gains.filter((g) => g.gain.setTargetAtTime.mock.calls.length > 0).map((g) => g.gain.setTargetAtTime.mock.calls[0][0]);
  expect(ramped).toEqual([2, 1]);
  await player.dispose();
});

/** Lets the player's background sample decode finish. */
const decoded = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Drum samples in these tests are one frame long and hold their note number; the stems are 1000 frames. */
const sample = (note: number) => ({ sampleRate: 44100, channels: [new Float32Array([note])] });
function stubBuffers() {
  vi.spyOn(Context.prototype, "createBuffer").mockImplementation(function (_channels: number, length: number) {
    const buffer = { length, note: -1, copyToChannel: (data: Float32Array) => void (buffer.note = data[0]) };
    return buffer;
  } as never);
}
type Sourced = { buffer: unknown; start: { mock: { calls: number[][] } }; stop: { mock: { calls: unknown[][] } } };
const clickSources = (ctx: Context) => (ctx.sources as unknown as Sourced[]).filter((source) => (source.buffer as { length: number } | null)?.length === 1);
const noteOf = (source: Sourced) => (source.buffer as { note: number }).note;

it("plays the count-in's drum sample on every beat, accented, and uses the blip until the sample is ready", async () => {
  vi.stubGlobal("AudioContext", Context);
  stubBuffers();
  let ready!: (audio: unknown) => void;
  loadDrumSample.mockImplementation(() => new Promise((resolve) => (ready = resolve)));
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.5, sound: "click", countInSound: "sticks" });
  const ctx = Context.instances[0];
  await vi.waitFor(() => expect(loadDrumSample).toHaveBeenCalledWith(37));
  // The sample is still decoding at Play, so the count-in uses the blip rather than staying silent.
  await player.play({ countInBeats: 4 });
  expect(ctx.oscillators).toHaveLength(4);
  expect(clickSources(ctx)).toHaveLength(0);
  player.pause();
  ready(sample(37));
  await decoded();
  const gainsBefore = ctx.gains.length;
  await player.play({ countInBeats: 4 });
  const clicks = clickSources(ctx);
  expect(clicks).toHaveLength(4);
  expect(ctx.oscillators).toHaveLength(4);
  expect(clicks.map(noteOf)).toEqual([37, 37, 37, 37]);
  expect(clicks.map((source) => source.start.mock.calls[0][0])).toEqual([10.02, 10.52, 11.02, 11.52].map((t) => expect.closeTo(t)));
  const accents = ctx.gains.slice(gainsBefore).map((gain) => gain.gain.setValueAtTime.mock.calls[0]?.[0]);
  expect(accents.filter((v) => v === 0.5 || v === 0.5 * 0.65)).toEqual([0.5, 0.5 * 0.65, 0.5 * 0.65, 0.5 * 0.65]);
  await player.dispose();
});

it("uses the kick on the downbeat and the closed hat on the other beats for kick-hat", async () => {
  vi.stubGlobal("AudioContext", Context);
  stubBuffers();
  loadDrumSample.mockImplementation(async (note: number) => sample(note));
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "kick-hat" });
  await decoded();
  await player.play({ countInBeats: 4 });
  expect(clickSources(Context.instances[0]).map(noteOf)).toEqual([36, 42, 42, 42]);
  await player.dispose();
});

it("stops sample clicks on pause as it does blips", async () => {
  vi.stubGlobal("AudioContext", Context);
  stubBuffers();
  loadDrumSample.mockImplementation(async (note: number) => sample(note));
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "hihat" });
  await decoded();
  await player.play({ countInBeats: 4 });
  const clicks = clickSources(Context.instances[0]);
  expect(clicks).toHaveLength(4);
  player.pause();
  expect(clicks.every((source) => source.stop.mock.calls.some((call) => call.length === 0))).toBe(true);
  await player.dispose();
});

it("falls back to the blip when a sample fails to load", async () => {
  vi.stubGlobal("AudioContext", Context);
  stubBuffers();
  loadDrumSample.mockRejectedValue(new Error("no file"));
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "ride" });
  await decoded();
  await player.play({ countInBeats: 4 });
  expect(Context.instances[0].oscillators).toHaveLength(4);
  await player.dispose();
});

it("plays rock as kick, snare, kick, snare over a bar, and the toms from high to low", async () => {
  vi.stubGlobal("AudioContext", Context);
  stubBuffers();
  loadDrumSample.mockImplementation(async (note: number) => sample(note));
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "rock", countInSound: "toms" });
  await decoded();
  await player.play({ countInBeats: 4 });
  expect(clickSources(Context.instances[0]).map(noteOf)).toEqual([50, 47, 45, 45]);
  player.pause();
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "rock", countInSound: "same" });
  await player.play({ countInBeats: 4 });
  expect(clickSources(Context.instances[0]).slice(4).map(noteOf)).toEqual([36, 38, 36, 38]);
  await player.dispose();
});

it("plays the cowbell on two oscillators and the woodblock on a noise burst, and stops them on pause", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  const ctx = Context.instances[0];
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "cowbell", countInSound: "same" });
  await player.play({ countInBeats: 2 });
  // Two square oscillators a click, and no drum sample was asked for.
  expect(ctx.oscillators).toHaveLength(4);
  expect(loadDrumSample).not.toHaveBeenCalled();
  player.pause();
  expect(ctx.oscillators.every((osc) => osc.stop.mock.calls.some((call) => call.length === 0))).toBe(true);
  const before = ctx.sources.length;
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "woodblock", countInSound: "same" });
  await player.play({ countInBeats: 2 });
  // The first new source is the song's own stem; the rest are the two noise bursts.
  const noise = ctx.sources.slice(before + 1);
  expect(noise).toHaveLength(2);
  player.pause();
  expect(noise.every((source) => source.stop.mock.calls.some((call) => call.length === 0))).toBe(true);
  await player.dispose();
});

it("Listen schedules one bar on the click bus and does not start the song", async () => {
  vi.stubGlobal("AudioContext", Context);
  stubBuffers();
  loadDrumSample.mockImplementation(async (note: number) => sample(note));
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 3, volume: 0.25, sound: "snare" });
  await decoded();
  const ctx = Context.instances[0];
  const stems = ctx.sources.length;
  await player.previewClicks();
  const bar = clickSources(ctx);
  expect(bar).toHaveLength(3);
  expect(bar.map((source) => source.start.mock.calls[0][0])).toEqual([10.05, 10.55, 11.05].map((t) => expect.closeTo(t)));
  // No stem source was started: only the three clicks were added.
  expect(ctx.sources.length - stems).toBe(3);
  expect(player.isPlaying).toBe(false);
  // Listening again cuts the first bar off.
  await player.previewClicks();
  expect(bar.every((source) => source.stop.mock.calls.some((call) => call.length === 0))).toBe(true);
  await player.dispose();
});

it("tells the click listener about every beat and stays silent when 'also play' is off", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  const heard: [number, number, number][] = [];
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25, sound: "click" });
  player.setClickListener((click) => heard.push([click.when, click.beat, click.beats]), false);
  await player.play({ countInBeats: 4 });
  expect(heard.map((h) => h[1])).toEqual([0, 1, 2, 3]);
  expect(heard[0][0]).toBeCloseTo(10.02);
  expect(Context.instances[0].oscillators).toHaveLength(0);
  await player.dispose();
});

it("plays your own samples on the right beats, and the blip for an empty slot", async () => {
  vi.stubGlobal("AudioContext", Context);
  stubBuffers();
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.5, sound: "custom" });
  const ctx = Context.instances[0];
  // The downbeat has a sample (a single frame holding 7); the other beats have none yet.
  player.setCustomClickSamples({ down: sample(7), other: null });
  await player.play({ countInBeats: 4 });
  expect(clickSources(ctx).map(noteOf)).toEqual([7]);
  expect(ctx.oscillators).toHaveLength(3);
  player.pause();
  player.setCustomClickSamples({ down: sample(7), other: sample(9) });
  await player.play({ countInBeats: 4 });
  expect(clickSources(ctx).slice(1).map(noteOf)).toEqual([7, 9, 9, 9]);
  // Samples are never asked of the band's kit.
  expect(loadDrumSample).not.toHaveBeenCalled();
  await player.dispose();
});

it("plays to the end of the longest stem, so a generated part that rings past the song is not cut", () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: pcm(1000), bass: pcm(1300) });
  expect(player.length).toBe(13);
  expect(player.duration).toBe(13);
});

const countOf = (start: number, seconds = 1) => ({ track: "other", audio: { sampleRate: 100, channels: [new Float32Array(seconds * 100)] }, start });

it("starts the song after the drummer's count: the count plays ahead of the song and ends where the song begins", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } });
  await player.play({ drummer: countOf(-2) });
  const ctx = Context.instances[0];
  // The count plays from the call (10.02), and the song starts two seconds later, where the count ends.
  const [count, song] = [ctx.sources[1], ctx.sources[0]];
  expect(count.start.mock.calls[0][0]).toBeCloseTo(10.02);
  expect(song.start.mock.calls[0][0]).toBeCloseTo(12.02);
  expect(count.playbackRate.value).toBe(1);
  await player.dispose();
});

it("plays the drummer's count and the metronome's count-in together, each ending where the song begins", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } });
  // One bar of clicks at 120 BPM is 2 s, and the drummer's count is 3 s: the song starts after the longer, and the clicks start 1 s into it.
  await player.play({ bpm: 120, countInBeats: 4, drummer: countOf(-3) });
  const ctx = Context.instances[0];
  expect(ctx.sources[0].start.mock.calls[0][0]).toBeCloseTo(13.02);
  expect(ctx.sources[1].start.mock.calls[0][0]).toBeCloseTo(10.02);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(11.02);
  await player.dispose();
});

it("leaves the drummer's count out of a start that is not from the beginning of the song", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } });
  await player.seek(5);
  await player.play({ drummer: countOf(-2) });
  const ctx = Context.instances[0];
  expect(ctx.sources).toHaveLength(1);
  expect(ctx.sources[0].start.mock.calls[0][0]).toBeCloseTo(10.02);
  await player.dispose();
});

it("plays a count that falls inside the song where it is, and stops it with the clicks on pause", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } });
  await player.play({ drummer: countOf(3) });
  const ctx = Context.instances[0];
  // The song starts at once, and the count joins it three seconds in.
  expect(ctx.sources[0].start.mock.calls[0][0]).toBeCloseTo(10.02);
  expect(ctx.sources[1].start.mock.calls[0][0]).toBeCloseTo(13.02);
  player.pause();
  expect(ctx.sources[1].stop).toHaveBeenCalledWith();
  await player.dispose();
});

it("counts at the song's speed, so the count keeps the song's tempo", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(2000)] } }, undefined, {}, "now", 0.5);
  await player.play({ drummer: countOf(-2) });
  const ctx = Context.instances[0];
  // Two song seconds at half speed are four audio seconds, and the count's buffer plays at half speed to fill them.
  expect(ctx.sources[0].start.mock.calls[0][0]).toBeCloseTo(14.02);
  expect(ctx.sources[1].playbackRate.value).toBe(0.5);
  await player.dispose();
});
