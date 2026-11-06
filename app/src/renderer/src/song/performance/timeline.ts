/*
 * Where song time sits on the audio clock (pure). Playback is a list of segments: the song plays from `songStart` at audio
 * time `ctxStart` until `songEnd`, and a jump starts a new segment. Position and the metronome read the same list, so they
 * stay in step through a loop or a skip without either knowing about the other.
 *
 * A segment plays at a rate (see speed.ts): one song second takes 1 / rate audio seconds. Song time, the metronome grid and the
 * cues all stay in song time, so only the mapping between song and audio time knows the rate.
 */

export interface Segment {
  /** Audio time at which the segment starts */
  ctxStart: number;
  /** Song time at `ctxStart` */
  songStart: number;
  /** Song time at which the segment ends (Infinity for the one still playing) */
  songEnd: number;
  /** Playback rate of the segment: 1 is the song's own speed. Missing means 1. */
  rate?: number;
}

/** The rate a segment plays at. A segment without one plays at the song's own speed. */
export function rateOf(segment: Segment): number {
  return segment.rate ?? 1;
}

/** Index of the segment that holds audio time `ctx`: the last one that has begun, or the first before any has (a count-in). */
export function segmentIndexAt(segments: readonly Segment[], ctx: number): number {
  let index = 0;
  for (let i = 0; i < segments.length; i++) if (segments[i].ctxStart <= ctx) index = i;
  return index;
}

/** Song time at audio time `ctx`. Negative during a count-in, because the first segment runs backwards from its start. */
export function songTimeAt(segments: readonly Segment[], ctx: number): number {
  if (!segments.length) return 0;
  const segment = segments[segmentIndexAt(segments, ctx)];
  return segment.songStart + (ctx - segment.ctxStart) * rateOf(segment);
}

/** Audio time at which song time `at` plays on the last segment, which is the one a boundary is planned on. */
export function audioTimeOf(segments: readonly Segment[], at: number): number {
  const last = segments[segments.length - 1];
  return last.ctxStart + (at - last.songStart) / rateOf(last);
}

/** The first beat (by index, from `firstBeat`) at or after song time `song`, never before beat zero. */
export function beatAtOrAfter(song: number, firstBeat: number, interval: number): number {
  return Math.max(0, Math.ceil((song - firstBeat) / interval - 1e-7));
}

/** One click: its audio time and its beat index on the grid. */
export interface Click {
  when: number;
  beat: number;
}

/** Where the next click is to be read from: a segment and a beat index within the grid. */
export interface GridCursor {
  segment: number;
  beat: number;
}

/** Where a grid starts at audio time `ctx`: the first beat at or after the song time playing then. */
export function gridStart(segments: readonly Segment[], ctx: number, firstBeat: number, interval: number): GridCursor {
  const segment = segmentIndexAt(segments, ctx);
  const song = Math.max(segments[segment].songStart, songTimeAt(segments, ctx));
  return { segment, beat: beatAtOrAfter(song, firstBeat, interval) };
}

/**
 * The clicks due up to audio time `until`, read from `cursor`. Beats inside a skipped span are never clicked, because no
 * segment covers them. A beat that is already past `now` is skipped rather than played late, so a stalled timer never bursts.
 * The segment that is still open waits for its end, which is in the future until a jump has been planned.
 */
export function gridClicks(
  segments: readonly Segment[],
  cursor: GridCursor,
  now: number,
  until: number,
  firstBeat: number,
  interval: number,
): { clicks: Click[]; cursor: GridCursor } {
  const clicks: Click[] = [];
  let { segment, beat } = cursor;
  while (segment < segments.length) {
    const current = segments[segment];
    const song = firstBeat + beat * interval;
    if (song >= current.songEnd) {
      // The segment ends at audio time `ctxStart + (songEnd - songStart) / rate`. Move on only once that is no longer in the future.
      if (current.ctxStart + (current.songEnd - current.songStart) / rateOf(current) > until) break;
      segment++;
      if (segment >= segments.length) break;
      beat = beatAtOrAfter(segments[segment].songStart, firstBeat, interval);
      continue;
    }
    if (song < current.songStart) {
      // Always move forward, even when rounding lands the beat just before the start.
      beat = Math.max(beat + 1, beatAtOrAfter(current.songStart, firstBeat, interval));
      continue;
    }
    const when = current.ctxStart + (song - current.songStart) / rateOf(current);
    if (when > until) break;
    if (when >= now) clicks.push({ when, beat });
    beat++;
  }
  return { clicks, cursor: { segment, beat } };
}
