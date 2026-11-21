/** Audio-clock lookahead; timers only fill the schedule, not trigger the sound. */
export class Rhythm {
  private ctx = new AudioContext();
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private beat = 0;
  private disposed = false;
  bpm = 120;
  beats = 4;
  mode: "click" | "drums" = "click";
  volume = 0.25;
  async start() {
    await this.ctx.resume();
    if (this.timer || this.disposed) return;
    this.next = this.ctx.currentTime + 0.04;
    this.beat = 0;
    this.timer = setInterval(() => {
      if (this.next < this.ctx.currentTime) this.next = this.ctx.currentTime + 0.01;
      while (this.next < this.ctx.currentTime + 0.1) {
        const down = this.beat % this.beats === 0;
        const osc = this.ctx.createOscillator(),
          gain = this.ctx.createGain();
        osc.type = this.mode === "click" ? "sine" : this.beat % 2 ? "triangle" : "sine";
        osc.frequency.setValueAtTime(this.mode === "click" ? (down ? 1500 : 1000) : this.beat % 2 ? 220 : 110, this.next);
        if (this.mode === "drums") osc.frequency.exponentialRampToValueAtTime(45, this.next + 0.12);
        gain.gain.setValueAtTime(this.volume * (down ? 1 : 0.65), this.next);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.next + (this.mode === "click" ? 0.04 : 0.15));
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(this.next);
        osc.stop(this.next + 0.16);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
        this.next += 60 / this.bpm;
        this.beat++;
      }
    }, 25);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ctx.close();
  }
}

/** When the metronome clicks: never, only on its grid while stopped (rehearsal), only while the song plays, or both. */
export type MetronomeMode = "off" | "stopped" | "playing" | "both";

export const METRONOME_MODES: readonly { id: MetronomeMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "stopped", label: "While stopped" },
  { id: "playing", label: "While playing" },
  { id: "both", label: "Both" },
];

export function isMetronomeMode(value: unknown): value is MetronomeMode {
  return METRONOME_MODES.some((mode) => mode.id === value);
}

export function clicksWhileStopped(mode: MetronomeMode): boolean {
  return mode === "stopped" || mode === "both";
}

export function clicksWhilePlaying(mode: MetronomeMode): boolean {
  return mode === "playing" || mode === "both";
}

/** Seconds of one beat at `bpm`. */
export function beatSeconds(bpm: number): number {
  return 60 / bpm;
}

/** Beats in the count-in before the audio starts: whole bars of `beatsPerBar` clicks. */
export function countInBeats(bars: number, beatsPerBar: number): number {
  return Math.max(0, Math.floor(bars)) * beatsPerBar;
}

/** Where the audio starts when playback is asked to begin at `position` with `preRollBeats` of lead-in. Never before the song starts. */
export function preRollStart(position: number, preRollBeats: number, bpm: number): number {
  return Math.max(0, position - Math.max(0, preRollBeats) * beatSeconds(bpm));
}

/** Taps kept for the average: the last four. */
export const TAP_WINDOW = 4;
/** A pause this long starts a new tap sequence. */
export const TAP_RESET_MS = 2000;

/** Adds a tap at `at` (ms). A tap after a long pause starts again from scratch. */
export function recordTap(taps: readonly number[], at: number): number[] {
  const last = taps[taps.length - 1];
  const earlier = last !== undefined && at - last > TAP_RESET_MS ? [] : taps;
  return [...earlier, at].slice(-TAP_WINDOW);
}

/** Tempo from the average interval between the taps, within the song tempo range; null until there are two taps. */
export function tapBpm(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;
  const averageMs = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  if (averageMs <= 0) return null;
  return Math.min(300, Math.max(30, Math.round(60000 / averageMs)));
}
