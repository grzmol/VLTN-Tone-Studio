/*
 * Joins between songs (pure). When a song ends and the next one is already decoded, the next one starts on the same audio clock:
 * gapless when there is no crossfade, a crossfade of the chosen length otherwise. A count-in on the incoming song turns the crossfade
 * off, because the count-in clicks need the silence before the audio. Whatever cannot be scheduled in time falls back to a gap.
 * The planner decides; the player and the session carry the plan out.
 */

/** The longest crossfade the setting allows, in seconds */
export const CROSSFADE_MAX_S = 10;
/** A join must be scheduled this long before its audio, so the session can take the next song over in time */
export const HANDOVER_LEAD_S = 0.5;
const CURVE_POINTS = 64;

/** Clamps a crossfade length to what the setting allows. Anything that is not a number is no crossfade. */
export function clampCrossfade(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.min(CROSSFADE_MAX_S, seconds)) : 0;
}

/**
 * Gain curve for a crossfade. The outgoing and incoming curves square-sum to one, so the level holds through the middle of the join
 * instead of dipping.
 */
export function equalPowerCurve(direction: "in" | "out"): Float32Array {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const p = (i / (CURVE_POINTS - 1)) * (Math.PI / 2);
    curve[i] = direction === "in" ? Math.sin(p) : Math.cos(p);
  }
  return curve;
}

/** A song's playable range inside its file, in seconds of song time. Both ends are clamped to the file. */
export interface PlayRange {
  start: number;
  end: number;
}

/** The playable range of a song of `duration` seconds, trimmed by the optional start and end. */
export function playRange(duration: number, trim: { trimStart?: number; trimEnd?: number }): PlayRange {
  const end = Number.isFinite(trim.trimEnd) ? Math.max(0, Math.min(duration, trim.trimEnd!)) : duration;
  const start = Number.isFinite(trim.trimStart) ? Math.max(0, Math.min(end, trim.trimStart!)) : 0;
  return { start, end };
}

/** Level, in dBFS, below which a moment counts as silence when a song is trimmed automatically */
export const SILENCE_DB = -60;

/**
 * The first and last moment above the silence level, in seconds, across every channel. Null when the whole song is silent. The
 * arrays are read, never changed.
 */
export function audibleRange(channels: readonly Float32Array[], sampleRate: number, thresholdDb = SILENCE_DB): PlayRange | null {
  const threshold = 10 ** (thresholdDb / 20);
  const frames = channels[0]?.length ?? 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      if (Math.abs(channel[i]) <= threshold) continue;
      if (first < 0) first = i;
      last = i;
      break;
    }
  }
  if (first < 0) return null;
  return { start: first / sampleRate, end: (last + 1) / sampleRate };
}

export interface TransitionInput {
  /** Audio time now */
  now: number;
  /** Audio time at which the outgoing song's playable range ends */
  songEnd: number;
  /** Crossfade length in seconds; anything outside the setting's range is clamped */
  crossfade: number;
  /** Whether the incoming song is decoded and can start now */
  ready: boolean;
  /** Whether the incoming song starts with a count-in. A count-in means no crossfade. */
  countIn: boolean;
  /** Set when the user asks to crossfade now, rather than at the end of the song */
  manual?: boolean;
}

export type Transition =
  | { kind: "gap"; reason: string }
  | {
      kind: "gapless" | "crossfade" | "countIn";
      /** Audio time at which the incoming song starts (its count-in, when there is one, comes first) */
      startAt: number;
      /** Length of the crossfade in seconds, 0 for a join with no fade */
      fadeLength: number;
      /** Audio time at which the outgoing song stops */
      stopAt: number;
    };

/**
 * Chooses how the next song joins. Automatic joins happen at the outgoing song's end, so a crossfade starts `crossfade` seconds
 * before it. A manual join starts once the join can be scheduled, and its crossfade ends the outgoing song.
 */
export function planTransition(input: TransitionInput): Transition {
  if (!input.ready) return { kind: "gap", reason: "The next song is not loaded yet, so there is a gap." };
  const fadeLength = input.countIn ? 0 : clampCrossfade(input.crossfade);
  const startAt = input.manual ? input.now + HANDOVER_LEAD_S : input.songEnd - fadeLength;
  if (startAt < input.now + HANDOVER_LEAD_S) return { kind: "gap", reason: "The next song could not start in time, so there is a gap." };
  const kind = input.countIn ? "countIn" : fadeLength > 0 ? "crossfade" : "gapless";
  return { kind, startAt, fadeLength, stopAt: input.manual ? startAt + fadeLength : input.songEnd };
}
