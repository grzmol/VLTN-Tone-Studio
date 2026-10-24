import { STEM_NAMES, type StemName, type Stems } from "../types";
import { stemGains, type Mix } from "./mix";

// Plays a split's stems (four or six) in sync through WebAudio: one buffer source per stem → its gain (mixer) → an analyser
// (level meter) → the output. Pausing or seeking restarts the sources at the new position.

const RAMP_S = 0.015;

interface Voice {
  buffer: AudioBuffer;
  gain: GainNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
}

export interface MetronomeSettings { enabled: boolean; bpm: number; beats: number; volume: number; firstBeat?: number }

export class StemPlayer {
  readonly duration: number;
  private ctx = new AudioContext({ sampleRate: 44100 });
  /** The split's stems, STEM_NAMES order */
  readonly names: StemName[];
  private voices: Partial<Record<StemName, Voice>>;
  private startedAt = 0;
  private offset = 0;
  private playing = false;
  private metronome: MetronomeSettings = { enabled: false, bpm: 120, beats: 4, volume: 0.25 };
  private clickTimer: ReturnType<typeof setInterval> | null = null;
  private clicks = new Set<OscillatorNode>();
  private meterBuffer = new Float32Array(2048);
  /** Called when playback reaches the end on its own */
  onEnded: (() => void) | null = null;

  constructor(stems: Stems) {
    this.names = STEM_NAMES.filter((name) => stems[name]);
    if (!this.names.length) throw new Error("There are no stems to play.");
    const first = stems[this.names[0]]!;
    this.duration = first.channels[0].length / first.sampleRate;
    this.voices = Object.fromEntries(
      this.names.map((name) => {
        const pcm = stems[name]!;
        const buffer = this.ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
        pcm.channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
        const gain = this.ctx.createGain();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = this.meterBuffer.length;
        gain.connect(analyser).connect(this.ctx.destination);
        return [name, { buffer, gain, analyser, source: null }];
      }),
    );
  }

  private voice(name: StemName): Voice {
    return this.voices[name]!;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Playback position in seconds */
  get position(): number {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.ctx.currentTime - this.startedAt);
  }

  async play(): Promise<void> {
    if (this.playing) return;
    await this.ctx.resume();
    if (this.offset >= this.duration) this.offset = 0;
    const when = this.ctx.currentTime + 0.02;
    for (const name of this.names) {
      const v = this.voice(name);
      const source = this.ctx.createBufferSource();
      source.buffer = v.buffer;
      source.connect(v.gain);
      source.start(when, this.offset);
      v.source = source;
    }
    // One source tells the end; the others end on the same sample.
    const leader = this.voice(this.names[0]);
    const lead = leader.source!;
    lead.onended = () => {
      if (!this.playing || leader.source !== lead) return;
      this.stopSources();
      this.playing = false;
      this.offset = this.duration;
      this.onEnded?.();
    };
    this.startedAt = when - this.offset;
    this.playing = true;
    this.startMetronome();
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = Math.max(0, this.position);
    this.playing = false;
    this.stopSources();
  }

  async seek(seconds: number): Promise<void> {
    const t = Math.max(0, Math.min(this.duration, seconds));
    if (!this.playing) {
      this.offset = t;
      return;
    }
    this.pause();
    this.offset = t;
    await this.play();
  }

  setMix(mix: Mix): void {
    const gains = stemGains(mix);
    for (const name of this.names) this.voice(name).gain.gain.setTargetAtTime(gains[name], this.ctx.currentTime, RAMP_S);
  }

  /** Uses the stems' AudioContext and song-time origin, including after pause/seek. */
  setMetronome(settings: MetronomeSettings): void {
    this.stopMetronome();
    this.metronome = settings;
    if (this.playing) this.startMetronome();
  }

  private startMetronome(): void {
    const { enabled, bpm, beats, volume } = this.metronome;
    const firstBeat = Number.isFinite(this.metronome.firstBeat) && this.metronome.firstBeat! >= 0 ? this.metronome.firstBeat! : 0;
    if (!enabled || !Number.isFinite(bpm) || bpm <= 0 || !Number.isInteger(beats) || beats < 1) return;
    const interval = 60 / bpm;
    // Never schedule a beat before the requested seek position during audio pre-roll.
    const nextBeat = () => Math.max(0, Math.ceil((Math.max(this.offset, this.ctx.currentTime - this.startedAt) - firstBeat) / interval - 1e-7));
    let beat = nextBeat();
    const fill = () => {
      // Skip missed beats instead of playing a burst when the window resumes.
      beat = Math.max(beat, nextBeat());
      while (this.startedAt + firstBeat + beat * interval < this.ctx.currentTime + 0.1 && firstBeat + beat * interval < this.duration) {
        const when = Math.max(this.ctx.currentTime, this.startedAt + firstBeat + beat * interval);
        const down = beat % beats === 0;
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(down ? 1500 : 1000, when);
        gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * (down ? 1 : 0.65), when);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
        osc.connect(gain).connect(this.ctx.destination);
        this.clicks.add(osc);
        osc.onended = () => { this.clicks.delete(osc); osc.disconnect(); gain.disconnect(); };
        osc.start(when); osc.stop(when + 0.05);
        beat++;
      }
    };
    fill();
    this.clickTimer = setInterval(fill, 25);
  }

  private stopMetronome(): void {
    if (this.clickTimer) clearInterval(this.clickTimer);
    this.clickTimer = null;
    for (const osc of this.clicks) { osc.stop(); osc.disconnect(); }
    this.clicks.clear();
  }

  /** Current RMS level (0..1) of each stem after its gain */
  levels(): Partial<Record<StemName, number>> {
    return Object.fromEntries(
      this.names.map((name) => {
        if (!this.playing) return [name, 0];
        this.voice(name).analyser.getFloatTimeDomainData(this.meterBuffer);
        let sum = 0;
        for (const x of this.meterBuffer) sum += x * x;
        return [name, Math.sqrt(sum / this.meterBuffer.length)];
      }),
    );
  }

  async dispose(): Promise<void> {
    this.playing = false;
    this.stopSources();
    await this.ctx.close();
  }

  private stopSources() {
    this.stopMetronome();
    for (const name of this.names) {
      const v = this.voice(name);
      if (!v.source) continue;
      v.source.onended = null;
      v.source.stop();
      v.source.disconnect();
      v.source = null;
    }
  }
}
