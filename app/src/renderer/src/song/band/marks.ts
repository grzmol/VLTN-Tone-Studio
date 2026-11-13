// Marks: small instructions a performer puts on one bar (a fill, a stop, a crash, a rest). A mark is kept by the bar's start time in song
// seconds, not by bar number, so it survives a change of the beat grid. Before the parts are generated each mark is resolved to the bar
// whose start is nearest its time. Pure: the grid comes in as a value and the marks are plain data saved with the band settings.

import type { BeatGrid } from "./beat-grid";
import type { Feel } from "./feel";
import { barSpans, beatSpan } from "./timing";

export const BAR_MARK_KINDS = ["fill", "no-fill", "stop", "crash", "no-crash", "drums-out", "bass-out", "hit"] as const;
export type BarMarkKind = (typeof BAR_MARK_KINDS)[number];

export interface BarMark {
  /** The bar's start, in song seconds. */
  time: number;
  kind: BarMarkKind;
  /** For a fill (1, 2 or 4) and a stop (1 to 4): how many beats at the end of the bar it takes. Left out, it is 2. */
  beats?: number;
}

/** A song with more marks than this keeps the first ones only, so a damaged file cannot grow without limit. */
export const MAX_BAR_MARKS = 200;
/** The beats a fill or a stop takes when the mark does not say. */
export const DEFAULT_MARK_BEATS = 2;
export const FILL_BEATS: readonly number[] = [1, 2, 4];
export const STOP_BEATS: readonly number[] = [1, 2, 3, 4];

/** The kinds that take a length in beats. */
export const hasBeats = (kind: BarMarkKind): boolean => kind === "fill" || kind === "stop";

/** The kinds that cannot be on a bar together: asking for one takes the other away. */
const EXCLUSIVE: readonly (readonly BarMarkKind[])[] = [
  ["fill", "no-fill"],
  ["crash", "no-crash"],
];

/** The beats a mark takes, or the default. */
export const markBeats = (mark: BarMark): number => mark.beats ?? DEFAULT_MARK_BEATS;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isKind = (value: unknown): value is BarMarkKind => BAR_MARK_KINDS.includes(value as BarMarkKind);

/** Reads saved marks: an entry is kept when its time and kind are valid, a fill or stop's beats are valid or left out, and at most MAX_BAR_MARKS are kept. */
export function parseBarMarks(value: unknown): BarMark[] {
  if (!Array.isArray(value)) return [];
  const marks: BarMark[] = [];
  for (const entry of value) {
    if (marks.length >= MAX_BAR_MARKS) break;
    if (!isRecord(entry) || typeof entry.time !== "number" || !Number.isFinite(entry.time) || entry.time < 0 || !isKind(entry.kind)) continue;
    const allowed = entry.kind === "fill" ? FILL_BEATS : STOP_BEATS;
    const beats = hasBeats(entry.kind) && typeof entry.beats === "number" && allowed.includes(entry.beats) ? { beats: entry.beats } : {};
    marks.push({ time: entry.time, kind: entry.kind, ...beats });
  }
  return marks;
}

/** The marks after `kind` is put on the bar at `time`: a mark of that kind there is replaced, and one it excludes is removed. */
export function withMark(marks: readonly BarMark[], time: number, kind: BarMarkKind, beats?: number): BarMark[] {
  const taken = EXCLUSIVE.find((pair) => pair.includes(kind))?.filter((other) => other !== kind) ?? [];
  const kept = marks.filter((mark) => !(mark.time === time && (mark.kind === kind || taken.includes(mark.kind))));
  return [...kept, { time, kind, ...(hasBeats(kind) && beats !== undefined ? { beats } : {}) }].slice(0, MAX_BAR_MARKS);
}

/** The marks without the ones on the bar that starts at `time`, or without the one of `kind` there when it is given. */
export function withoutMark(marks: readonly BarMark[], time: number, kind?: BarMarkKind): BarMark[] {
  return marks.filter((mark) => !(mark.time === time && (kind === undefined || mark.kind === kind)));
}

export interface BarMarks {
  /** The marks of each bar, by the bar's index in `barSpans(grid)`. A kind appears once per bar: the last mark of that kind wins. */
  byBar: Map<number, BarMark[]>;
  /** The marks that fall on no bar: past the song's end, or more than half a bar from every bar line. */
  dropped: BarMark[];
}

/**
 * Puts each mark on the bar whose start is nearest its time, when that is within half a bar; otherwise the mark is dropped. The result
 * lists the bars that have marks, so a song with none costs nothing.
 */
export function marksByBar(grid: BeatGrid, marks: readonly BarMark[]): BarMarks {
  const byBar = new Map<number, BarMark[]>();
  const dropped: BarMark[] = [];
  if (marks.length === 0) return { byBar, dropped };
  const spans = barSpans(grid);
  const beats = grid.beats;
  const startOf = (bar: number) => beats[spans[bar].start];
  for (const mark of marks) {
    let nearest = -1;
    for (let bar = 0; bar < spans.length; bar++) {
      if (nearest < 0 || Math.abs(startOf(bar) - mark.time) < Math.abs(startOf(nearest) - mark.time)) nearest = bar;
    }
    if (nearest < 0) {
      dropped.push(mark);
      continue;
    }
    const span = spans[nearest];
    const length = span.start + span.beats < beats.length ? beats[span.start + span.beats] - startOf(nearest) : span.beats * beatSpan(beats, beats.length - 1);
    if (Math.abs(startOf(nearest) - mark.time) > length / 2) {
      dropped.push(mark);
      continue;
    }
    const here = (byBar.get(nearest) ?? []).filter((other) => other.kind !== mark.kind);
    byBar.set(nearest, [...here, mark]);
  }
  return { byBar, dropped };
}

/** The mark of a kind on a bar, if there is one. */
export const markOf = (byBar: ReadonlyMap<number, readonly BarMark[]>, bar: number, kind: BarMarkKind): BarMark | undefined =>
  byBar.get(bar)?.find((mark) => mark.kind === kind);

/**
 * The feel with the stops of the stop marks added: the last `beats` beats of the bar are silent in both parts, and the next downbeat is a
 * hit (a kick and a crash in the drums, a note in the bass). The follow-my-playing feel is kept as it is; with it off, the feel holds only
 * these stops. A song with no stop marks gets the feel it had.
 */
export function withMarkStops(grid: BeatGrid, byBar: ReadonlyMap<number, readonly BarMark[]>, feel?: Feel): Feel | undefined {
  const stops = new Set(feel?.stops);
  const hits = new Set(feel?.hits);
  let any = false;
  const spans = barSpans(grid);
  for (const [bar, marks] of byBar) {
    const mark = marks.find((candidate) => candidate.kind === "stop");
    if (!mark) continue;
    any = true;
    const { start, beats } = spans[bar];
    const length = Math.min(markBeats(mark), beats);
    for (let beat = start + beats - length; beat < start + beats; beat++) stops.add(beat);
    if (start + beats < grid.beats.length) hits.add(start + beats);
  }
  return any ? { profiles: feel?.profiles ?? [], stops, hits } : feel;
}
