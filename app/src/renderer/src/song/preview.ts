import type { SongRange } from "./range";
import type { PcmAudio } from "./types";

// Plays the chosen part of the loaded song before it is split, so it can be checked by ear. Only that part is copied
// into a WebAudio buffer, each time playback starts.

export class PartPreview {
  private ctx = new AudioContext({ sampleRate: 44100 });
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private from = 0;
  /** Called when the part has played to its end */
  onEnded: (() => void) | null = null;

  constructor(private readonly audio: PcmAudio) {}

  get isPlaying(): boolean {
    return this.source !== null;
  }

  /** Position in the song, in seconds, while playing */
  get position(): number {
    return this.from + (this.ctx.currentTime - this.startedAt);
  }

  async play({ start, end }: SongRange): Promise<void> {
    this.stop();
    await this.ctx.resume();
    const rate = this.audio.sampleRate;
    const from = Math.round(start * rate);
    const to = Math.round(end * rate);
    const buffer = this.ctx.createBuffer(this.audio.channels.length, Math.max(1, to - from), rate);
    this.audio.channels.forEach((ch, c) => buffer.copyToChannel(ch.subarray(from, to) as Float32Array<ArrayBuffer>, c));
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.onEnded?.();
    };
    this.startedAt = this.ctx.currentTime + 0.02;
    this.from = start;
    source.start(this.startedAt);
    this.source = source;
  }

  stop(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.ctx.close();
  }
}
