// Records the pedal's USB audio (or any audio input) for the IR match: getUserMedia with every voice-call
// processing switched off, as the capture editor's live input does, into an AudioWorklet that hands back mono PCM.
// no-inline: a file this small would be inlined as a data: URL, which the app's CSP (script-src 'self') refuses to run.
import workletUrl from "./recorder-worklet.js?url&no-inline";

export interface AudioInput {
  deviceId: string;
  label: string;
}

/** The pedal shows up as a USB audio device named after it ("GP-5", "GP-50", "GP-200…") or after Valeton. */
export const isPedalInput = (label: string) => /gp-?(5|200)|valeton/i.test(label);

/** Audio inputs. Labels need the microphone permission, so this asks for it once when they're blank. */
export async function listInputs(): Promise<AudioInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error("Audio input isn't available here.");
  let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  if (devices.length > 0 && devices.every((d) => !d.label)) {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of probe.getTracks()) t.stop();
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  }
  return devices.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Audio input ${i + 1}` }));
}

export interface Level {
  rmsDb: number;
  peakDb: number;
}

const toDbfs = (v: number) => Math.max(-90, 20 * Math.log10(v + 1e-9));

/** A live input: meters right away, keeps samples between `start()` and `stop()`. */
export class InputRecorder {
  private chunks: Float32Array[] = [];
  private recording = false;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
    onLevel: (level: Level) => void,
  ) {
    node.port.onmessage = (e: MessageEvent<{ rms: number; peak: number; samples: Float32Array | null }>) => {
      onLevel({ rmsDb: toDbfs(e.data.rms), peakDb: toDbfs(e.data.peak) });
      if (this.recording && e.data.samples) this.chunks.push(e.data.samples);
    };
  }

  static async open(deviceId: string | null, onLevel: (level: Level) => void): Promise<InputRecorder> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Audio input isn't available here.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
    });
    const ctx = new AudioContext();
    try {
      if (!ctx.audioWorklet) throw new Error("Audio worklets aren't available here (they need a secure context).");
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, "tone-match-recorder", { numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain();
      mute.gain.value = 0; // pulls the graph without playing the input back
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(mute).connect(ctx.destination);
      await ctx.resume();
      return new InputRecorder(ctx, stream, node, onLevel);
    } catch (e) {
      for (const t of stream.getTracks()) t.stop();
      await ctx.close();
      throw e;
    }
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** Seconds recorded so far. */
  get seconds(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0) / this.ctx.sampleRate;
  }

  start(): void {
    this.chunks = [];
    this.recording = true;
    this.node.port.postMessage({ recording: true });
  }

  /** Stop and return the mono recording. */
  stop(): Float32Array {
    this.recording = false;
    this.node.port.postMessage({ recording: false });
    const out = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    return out;
  }

  async close(): Promise<void> {
    this.recording = false;
    this.node.port.onmessage = null;
    this.node.disconnect();
    for (const t of this.stream.getTracks()) t.stop();
    await this.ctx.close();
  }
}
