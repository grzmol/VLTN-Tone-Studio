// The click on a second device: its own AudioContext with its own sink. The two audio clocks run independently, so every click time is
// mapped from the main clock to this one. Each clock is read through getOutputTimestamp(), which ties its audio time to the shared
// performance clock. The mapping is read again every couple of seconds, so a drifting device moves the clicks; the tracks never move.

/** One AudioContext's time as the output device reports it: `contextTime` in seconds, `performanceTime` in milliseconds. */
export interface ClockPair {
  contextTime: number;
  performanceTime: number;
}

/** How often the mapping is read again, in milliseconds. */
export const RECHECK_MS = 2000;

/** `time` on the `from` clock, converted to the `to` clock through the performance clock both devices share. */
export function mapTime(from: ClockPair, to: ClockPair, time: number): number {
  const performanceMs = from.performanceTime + (time - from.contextTime) * 1000;
  return to.contextTime + (performanceMs - to.performanceTime) / 1000;
}

/**
 * The clock pair for `ctx`. Before the device has started its output timestamp is zero, so the pair falls back to the current
 * audio time and the current performance time. That is only a guess, and the next recheck replaces it.
 */
export function clockPair(ctx: AudioContext, now: () => number = () => performance.now()): ClockPair {
  const { contextTime = 0, performanceTime = 0 } = ctx.getOutputTimestamp();
  if (performanceTime > 0) return { contextTime, performanceTime };
  return { contextTime: ctx.currentTime, performanceTime: now() };
}

export class SeparateClickOutput {
  readonly bus: GainNode;
  /** The main and click clocks, read together and kept until the next recheck */
  private pairs: { main: ClockPair; click: ClockPair };
  private timer: ReturnType<typeof setInterval>;

  private constructor(
    readonly ctx: AudioContext,
    readonly deviceId: string,
    private readonly mainCtx: AudioContext,
  ) {
    this.bus = ctx.createGain();
    this.bus.channelCount = 2;
    this.bus.channelCountMode = "explicit";
    this.bus.channelInterpretation = "speakers";
    this.bus.connect(ctx.destination);
    this.pairs = this.read();
    this.timer = setInterval(() => (this.pairs = this.read()), RECHECK_MS);
  }

  /** Opens the click on `deviceId`. Rejects when the device cannot be selected; the caller then keeps the click on Main. */
  static async open(mainCtx: AudioContext, deviceId: string): Promise<SeparateClickOutput> {
    const ctx = new AudioContext({ sampleRate: 44100 });
    try {
      await ctx.setSinkId(deviceId);
    } catch (error) {
      await ctx.close();
      throw error;
    }
    return new SeparateClickOutput(ctx, deviceId, mainCtx);
  }

  private read() {
    return { main: clockPair(this.mainCtx), click: clockPair(this.ctx) };
  }

  /** The click's audio time for a main-clock time `time`. */
  localTime(time: number): number {
    return mapTime(this.pairs.main, this.pairs.click, time);
  }

  async resume(): Promise<void> {
    await this.ctx.resume();
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer);
    this.bus.disconnect();
    await this.ctx.close();
  }
}
