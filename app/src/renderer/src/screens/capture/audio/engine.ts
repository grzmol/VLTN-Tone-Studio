// Audition: the NAM wasm engine (neural-amp-modeler-wasm, by TONE3000) in an AudioWorklet.
// Graph: source → drive → pre filters → one NamNode per compare choice (all running, sample-aligned) →
// per-choice gain (only the selected one is open) → post filters → output.
// The rendered preview is the same graph in an OfflineAudioContext.
import { NamNode } from "neural-amp-modeler-wasm/engine";
import workletUrl from "neural-amp-modeler-wasm/dist/engine/nam-worklet.js?url";
import wasmUrl from "neural-amp-modeler-wasm/dist/engine/nam-engine.wasm?url";
import type { Shaping } from "@shared/host/capture";
import { postFilters, preFilters, type FilterSpec } from "../nam/shaping";
import diGuitarUrl from "./di-guitar.flac?url";
import { irLevelGain } from "./ir-level";

export const SAMPLE_RATE = 48000;
/** Below the 0.5 breakpoint selects the Lite submodel; negative = the full model (NAM core semantics). */
export const SLIM_SIZE = { full: -1, lite: 0.25 } as const;

export interface ModelChoice {
  id: string;
  slimSize: number;
}

export interface ChainSettings {
  shaping: Shaping;
  /** Output gain per choice id, dB */
  gainDb: Record<string, number>;
}

export const CLIPS = [{ id: "di-guitar", label: "Guitar DI", url: diGuitarUrl }] as const;
export type ClipId = (typeof CLIPS)[number]["id"];

let wasmBytes: Promise<ArrayBuffer> | null = null;
const fetchWasm = () =>
  (wasmBytes ??= fetch(wasmUrl).then((r) => {
    if (!r.ok) throw new Error(`The audio engine couldn't be loaded (${r.status})`);
    return r.arrayBuffer();
  }));

let requestId = 1_000_000_000; // above the package's own counter, so ids never collide on a node

async function createNode(ctx: BaseAudioContext, text: string, slimSize: number): Promise<NamNode> {
  const node = new NamNode(ctx);
  await node.request({ type: "init", requestId: requestId++, wasmBytes: await fetchWasm() });
  await node.loadModel(text, { slimSize });
  return node;
}

const registered = new WeakMap<BaseAudioContext, Promise<void>>();
function registerWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = registered.get(ctx);
  if (!p) {
    if (!ctx.audioWorklet) return Promise.reject(new Error("Audio worklets aren't available here (they need a secure context)."));
    p = ctx.audioWorklet.addModule(workletUrl);
    registered.set(ctx, p);
  }
  return p;
}

const dbToGain = (db: number) => 10 ** (db / 20);

/** Live contexts glide (no zipper noise); offline renders start at the final values. */
function setParam(param: AudioParam, value: number, ctx: BaseAudioContext, timeConstant: number) {
  if (ctx instanceof OfflineAudioContext) param.value = value;
  else param.setTargetAtTime(value, ctx.currentTime, timeConstant);
}

function applyFilter(node: BiquadFilterNode, spec: FilterSpec) {
  node.type = spec.type;
  setParam(node.frequency, spec.frequency, node.context, 0.01);
  setParam(node.Q, spec.Q, node.context, 0.01);
  setParam(node.gain, spec.gain, node.context, 0.01);
}

/** The shaping + model chain, built in any BaseAudioContext. */
class Chain {
  readonly input: GainNode;
  readonly output: GainNode;
  private pre: BiquadFilterNode[];
  private post: BiquadFilterNode[];
  private gains = new Map<string, GainNode>();

  constructor(
    private ctx: BaseAudioContext,
    nodes: Map<string, NamNode>,
  ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.pre = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    this.post = [ctx.createBiquadFilter(), ctx.createBiquadFilter(), ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    let last: AudioNode = this.input;
    for (const f of this.pre) last = last.connect(f);
    const postIn = ctx.createGain();
    for (const [id, nam] of nodes) {
      const g = ctx.createGain();
      g.gain.value = 0;
      last.connect(nam).connect(g).connect(postIn);
      this.gains.set(id, g);
    }
    last = postIn;
    for (const f of this.post) last = last.connect(f);
    last.connect(this.output);
  }

  apply(settings: ChainSettings, selected: string) {
    setParam(this.input.gain, dbToGain(settings.shaping.driveDb), this.ctx, 0.01);
    preFilters(settings.shaping).forEach((spec, i) => applyFilter(this.pre[i], spec));
    postFilters(settings.shaping).forEach((spec, i) => applyFilter(this.post[i], spec));
    for (const [id, g] of this.gains) {
      const target = id === selected ? dbToGain(settings.gainDb[id] ?? 0) : 0;
      setParam(g.gain, target, this.ctx, 0.004); // ~10 ms crossfade: instant to the ear, no click
    }
  }
}

async function decodeClip(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The DI clip couldn't be loaded (${res.status})`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/** Live audition: one AudioContext at the model's 48 kHz. */
export class Audition {
  private ctx: AudioContext | null = null;
  private nodes = new Map<string, NamNode>();
  private chain: Chain | null = null;
  private source: AudioBufferSourceNode | MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private clips = new Map<string, AudioBuffer>();
  private startedAt = 0;
  private modelText: string | null = null;
  private loading: Promise<void> | null = null;

  /** Load the capture into one node per choice. Call again when the file changes. */
  async load(text: string, choices: ModelChoice[], settings: ChainSettings, selected: string): Promise<void> {
    if (this.modelText === text && this.chain) {
      this.chain.apply(settings, selected);
      return;
    }
    this.modelText = text;
    const run = async () => {
      const ctx = (this.ctx ??= new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" }));
      await registerWorklet(ctx);
      this.teardownNodes();
      for (const c of choices) this.nodes.set(c.id, await createNode(ctx, text, c.slimSize));
      this.chain = new Chain(ctx, this.nodes);
      this.chain.output.connect(ctx.destination);
      this.chain.apply(settings, selected);
    };
    this.loading = run();
    await this.loading;
  }

  update(settings: ChainSettings, selected: string) {
    this.chain?.apply(settings, selected);
  }

  get playing() {
    return this.source !== null;
  }

  async playClip(clipId: ClipId): Promise<{ duration: number }> {
    await this.loading;
    const ctx = this.ctx;
    if (!ctx || !this.chain) throw new Error("The capture isn't loaded yet");
    await ctx.resume();
    this.stop();
    const clip = CLIPS.find((c) => c.id === clipId)!;
    let buffer = this.clips.get(clipId);
    if (!buffer) {
      buffer = await decodeClip(ctx, clip.url);
      this.clips.set(clipId, buffer);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.chain.input);
    src.start();
    this.startedAt = ctx.currentTime;
    this.source = src;
    return { duration: buffer.duration };
  }

  /** Live input from the default audio input (Settings has no audio device choice yet). Mono: channel 1. */
  async playLive(): Promise<void> {
    await this.loading;
    const ctx = this.ctx;
    if (!ctx || !this.chain) throw new Error("The capture isn't loaded yet");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Live input isn't available here.");
    await ctx.resume();
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } },
    });
    const src = ctx.createMediaStreamSource(this.stream);
    const split = ctx.createChannelSplitter(2);
    src.connect(split);
    split.connect(this.chain.input, 0);
    this.source = src;
  }

  /** Seconds into the looped clip, or null when not playing a clip. */
  position(duration: number): number | null {
    if (!this.ctx || !(this.source instanceof AudioBufferSourceNode)) return null;
    return (this.ctx.currentTime - this.startedAt) % duration;
  }

  stop() {
    if (this.source instanceof AudioBufferSourceNode) this.source.stop();
    this.source?.disconnect();
    this.source = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }

  private teardownNodes() {
    for (const n of this.nodes.values()) void n.dispose();
    this.nodes.clear();
    this.chain?.output.disconnect();
    this.chain = null;
  }

  async dispose() {
    this.stop();
    this.teardownNodes();
    this.modelText = null;
    await this.ctx?.close();
    this.ctx = null;
  }
}

/**
 * Offline render of one choice of the chain; returns the mono output. The input is a built-in clip, or mono samples already at
 * SAMPLE_RATE (the output then has the samples' length). With `cabIr` (samples at SAMPLE_RATE) the output goes through a convolver
 * after the chain, and the output keeps the input's length, so the IR's tail is cut off. The IR is level-matched: its output is scaled
 * back to the RMS of the chain's output before the IR (ir-level.ts), so the IR changes the tone, not the loudness.
 */
export async function renderOffline(
  text: string,
  choice: ModelChoice,
  settings: ChainSettings,
  input: ClipId | Float32Array,
  cabIr: Float32Array | null = null,
): Promise<Float32Array> {
  // A clip is decoded at 48 kHz with a throwaway offline context, then rendered into a context of the clip's length.
  const clip = typeof input === "string" ? CLIPS.find((c) => c.id === input)! : null;
  const decoded = clip ? await decodeClip(new OfflineAudioContext(1, 1, SAMPLE_RATE), clip.url) : null;
  const frames = decoded ? decoded.length : (input as Float32Array).length;
  const ir = cabIr && cabIr.length > 0 ? cabIr : null;
  // With an IR the context has two channels: the chain's output before the IR (channel 0) and after it (channel 1). One render gives
  // both, so the level can be matched without a second NAM render.
  const ctx = new OfflineAudioContext(ir ? 2 : 1, ir ? frames + ir.length : frames, SAMPLE_RATE);
  await registerWorklet(ctx);
  const nam = await createNode(ctx, text, choice.slimSize);
  const chain = new Chain(ctx, new Map([[choice.id, nam]]));
  chain.apply(settings, choice.id);
  if (ir) {
    const merger = ctx.createChannelMerger(2);
    const convolver = ctx.createConvolver();
    // The convolver's own normalisation scales the IR by about -29 dB for a unit impulse. The level is matched below instead.
    convolver.normalize = false;
    const irBuffer = ctx.createBuffer(1, ir.length, SAMPLE_RATE);
    irBuffer.copyToChannel(ir as Float32Array<ArrayBuffer>, 0);
    convolver.buffer = irBuffer;
    chain.output.connect(merger, 0, 0);
    chain.output.connect(convolver).connect(merger, 0, 1);
    merger.connect(ctx.destination);
  } else {
    chain.output.connect(ctx.destination);
  }
  const src = ctx.createBufferSource();
  if (decoded) {
    src.buffer = decoded;
  } else {
    const buffer = ctx.createBuffer(1, frames, SAMPLE_RATE);
    buffer.copyToChannel(input as Float32Array<ArrayBuffer>, 0);
    src.buffer = buffer;
  }
  src.connect(chain.input);
  src.start();
  const out = await ctx.startRendering();
  void nam.dispose();
  if (!ir) return out.getChannelData(0).slice(0, frames);
  const dry = out.getChannelData(0).subarray(0, frames);
  const wet = out.getChannelData(1).subarray(0, frames);
  const gain = irLevelGain(dry, wet);
  const matched = new Float32Array(frames);
  for (let i = 0; i < frames; i++) matched[i] = wet[i] * gain;
  return matched;
}

/** Peak per bucket (absolute, full scale = 1) for the waveform. */
export function peaks(samples: Float32Array, buckets: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const end = Math.min(samples.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out.push(max);
  }
  return out;
}
