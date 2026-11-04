// Click track for the Rig: schedules clicks ahead on the audio clock (setInterval alone would drift and jitter).
// Reads the tempo before every click, so editing the preset's BPM while it runs takes effect on the next beat.

import { isPedalInput, listInputs } from "@/song/tonematch/recorder";

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

/** The pedal's USB sound card among the audio outputs, when it is plugged in. */
async function pedalOutput(): Promise<MediaDeviceInfo | null> {
  try {
    await listInputs(); // asks for the microphone permission once, which is what unlocks device names
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    return outputs.find((d) => isPedalInput(d.label)) ?? null;
  } catch {
    return null;
  }
}

const VOLUME_KEY = "vltn.metronomeVolume";

/** Click volume 0-1, as the player left it. */
export function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return localStorage.getItem(VOLUME_KEY) !== null && v >= 0 && v <= 1 ? v : 0.9;
  } catch {
    return 0.9;
  }
}

export class Metronome {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private level = loadVolume();
  private timer = 0;
  private next = 0;
  private beat = 0;

  constructor(private readonly bpm: () => number) {}

  get running() {
    return this.ctx !== null;
  }

  get volume() {
    return this.level;
  }

  /** 0-1; applies to the running click right away and is remembered. */
  setVolume(v: number) {
    this.level = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.level;
    try {
      localStorage.setItem(VOLUME_KEY, String(this.level));
    } catch {
      /* the volume lasts for this session */
    }
  }

  /** Starts the click on the pedal's USB audio, else the system output; resolves with the name of the output used. */
  async start(): Promise<string> {
    if (this.ctx) return "";
    const pedal = await pedalOutput();
    const ctx = new AudioContext(pedal ? ({ sinkId: pedal.deviceId } as AudioContextOptions) : undefined);
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.level;
    this.master.connect(ctx.destination);
    try {
      await ctx.resume();
      if (ctx.state !== "running") throw new Error("The audio output didn't start. Check that the output isn't muted or in use.");
    } catch (e) {
      this.stop();
      throw e;
    }
    this.next = ctx.currentTime + 0.05;
    this.beat = 0;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
    return pedal?.label ?? "the system output";
  }

  stop() {
    window.clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.next < ctx.currentTime + LOOKAHEAD_S) {
      this.click(ctx, this.next, this.beat % 4 === 0);
      this.next += 60 / Math.max(1, this.bpm());
      this.beat++;
    }
  }

  /** ponytail: fixed 4/4 accent on the downbeat; a time-signature setting if anyone asks. */
  private click(ctx: AudioContext, at: number, accent: boolean) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle"; // more overtones than a sine: carries over a played guitar at the same level
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(1, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    osc.connect(gain).connect(this.master ?? ctx.destination);
    osc.start(at);
    osc.stop(at + 0.05);
  }
}
