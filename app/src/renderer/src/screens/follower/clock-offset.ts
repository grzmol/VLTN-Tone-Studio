// The follower's clock offset (spec 44), estimated NTP style. A ping leaves the follower at t0 (its own clock), the server reads it at t1
// and answers at t2 (the server's clock), and the pong arrives at t3 (the follower's clock again). Half the difference of the two
// one-way gaps is the offset that puts the follower on the server's clock, and the round trip is what the ping spent on the network.
// Delay is not symmetric on a Wi-Fi link, so the samples with the shortest round trips are the most trustworthy: the estimate is the
// median of the offsets from the few fastest ones.

/** One completed ping: the four times, in milliseconds. */
export interface PingSample {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

export interface OffsetEstimate {
  /** Add this to the follower's clock to get the server's clock, in milliseconds. */
  offset: number;
  /** The shortest round trip among the samples used, in milliseconds. */
  rtt: number;
  /** How many samples the estimate used. */
  samples: number;
}

/** The samples the estimate keeps. Older ones are dropped, so a long session follows the clocks as they drift. */
export const MAX_SAMPLES = 32;
/** The fastest samples the estimate uses. */
export const KEEP_FASTEST = 8;

/** The offset a sample implies: ((t1 - t0) + (t2 - t3)) / 2. */
export function offsetOf(sample: PingSample): number {
  return (sample.t1 - sample.t0 + (sample.t2 - sample.t3)) / 2;
}

/** The round trip a sample spent on the network and in the server: (t3 - t0) - (t2 - t1). */
export function roundTripOf(sample: PingSample): number {
  return sample.t3 - sample.t0 - (sample.t2 - sample.t1);
}

/** The sample for a pong: the server's two times and the follower's own send time and arrival time. */
export function pingSample(pong: { t0: number; t1: number; t2: number }, arrived: number): PingSample {
  return { t0: pong.t0, t1: pong.t1, t2: pong.t2, t3: arrived };
}

/**
 * The estimate from the samples. The `keep` samples with the shortest round trips are used, and the offset is their median, so one slow
 * or odd reply cannot move it. A sample with a negative round trip (a clock that went backwards, or a bad reply) is dropped. Null when
 * there is no usable sample.
 */
export function estimateOffset(samples: readonly PingSample[], keep: number = KEEP_FASTEST): OffsetEstimate | null {
  const usable = samples
    .filter((sample) => [sample.t0, sample.t1, sample.t2, sample.t3].every(Number.isFinite) && roundTripOf(sample) >= 0)
    .sort((a, b) => roundTripOf(a) - roundTripOf(b))
    .slice(0, Math.max(1, keep));
  if (!usable.length) return null;
  const offsets = usable.map(offsetOf).sort((a, b) => a - b);
  const middle = offsets.length >> 1;
  const offset = offsets.length % 2 ? offsets[middle] : (offsets[middle - 1] + offsets[middle]) / 2;
  return { offset, rtt: roundTripOf(usable[0]), samples: usable.length };
}
