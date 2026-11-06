import { create } from "zustand";

/*
 * Autoscroll for the lyrics reader. The position is song time from the playback clock, so a speed change, a section jump or a loop is
 * followed without any extra work. Everything here is pure: the reader turns a position into a scroll offset, and writes it straight to
 * the scroll box, so the scroll never causes a React render.
 *
 * Three styles:
 * - line: the last timed line that has started is kept at the reading position;
 * - continuous: the page moves smoothly between the timed lines, for a song where only some lines have times;
 * - constant: the page moves at a set number of lines per minute, or at the rate that spreads the song across the chart.
 */

export const AUTOSCROLL_MODES = ["line", "continuous", "constant"] as const;
export type AutoscrollMode = (typeof AUTOSCROLL_MODES)[number];

export const AUTOSCROLL_LABELS: Record<AutoscrollMode, string> = {
  line: "Line by line",
  continuous: "Between timed lines",
  constant: "Constant speed",
};

/** The slowest and fastest constant speed, in lines per minute */
export const LINES_PER_MINUTE = { min: 1, max: 240, initial: 6 } as const;

/** Where the current line is kept: this share of the visible lyrics from the top */
const READING_LINE = 0.3;

/** Keeps the value between the limits. A value that is not a number is the initial speed. */
export function clampLinesPerMinute(value: number): number {
  if (!Number.isFinite(value)) return LINES_PER_MINUTE.initial;
  return Math.min(LINES_PER_MINUTE.max, Math.max(LINES_PER_MINUTE.min, Math.round(value)));
}

/** The constant speed that spreads `rowCount` lines across `duration` seconds, so the last line lands at the end. Null without a usable duration. */
export function fitLinesPerMinute(rowCount: number, duration: number): number | null {
  if (!(duration > 0) || rowCount < 2) return null;
  return clampLinesPerMinute(((rowCount - 1) * 60) / duration);
}

/** Whether `value` is one of the autoscroll styles. */
export function isAutoscrollMode(value: string): value is AutoscrollMode {
  return (AUTOSCROLL_MODES as readonly string[]).includes(value);
}

/** A row of the reader as the scroll sees it: its song time (NaN when untimed) and its distance from the top of the lyrics, in pixels. */
export interface ScrollRow {
  time: number;
  top: number;
}

/**
 * The lyrics offset that the reading line should be at for `position`, or null when the style has no target yet (line mode before any
 * timed line has started, or continuous mode with no timed line at all).
 */
export function autoscrollTarget(mode: AutoscrollMode, position: number, rows: readonly ScrollRow[], linesPerMinute: number): number | null {
  if (!rows.length) return null;
  const timed = rows.filter((row) => Number.isFinite(row.time)).sort((a, b) => a.time - b.time);
  if (mode === "line") {
    const started = timed.filter((row) => row.time <= position);
    return started.length ? started[started.length - 1].top : null;
  }
  if (mode === "continuous") {
    if (!timed.length) return null;
    if (position <= timed[0].time) return 0;
    const last = timed[timed.length - 1];
    if (position >= last.time) return last.top;
    const index = timed.findLastIndex((row) => row.time <= position);
    const from = timed[index],
      to = timed[index + 1];
    if (to.time <= from.time) return from.top;
    return from.top + ((to.top - from.top) * (position - from.time)) / (to.time - from.time);
  }
  // Constant: a virtual line number grows with song time, and the offset is interpolated between the rows it falls between.
  const virtual = (Math.max(0, position) * clampLinesPerMinute(linesPerMinute)) / 60;
  const last = rows.length - 1;
  if (virtual >= last) return rows[last].top;
  const index = Math.floor(virtual);
  return rows[index].top + ((rows[index + 1].top - rows[index].top) * (virtual - index));
}

/** The scroll position that puts the target line at the reading position, never above the top. */
export function scrollTopFor(target: number, viewportHeight: number): number {
  return Math.max(0, target - viewportHeight * READING_LINE);
}

/** How long a manual scroll or a remote scroll pauses autoscroll, in milliseconds. */
export const AUTOSCROLL_HOLD_MS = 6000;

let heldUntil = 0;
const resumeListeners = new Set<() => void>();

/**
 * Pauses autoscroll for a while after the performer scrolls by hand or by a remote action, so the page does not pull back under them. When
 * the hold ends, the listeners are told so the page can return to the song position.
 */
export function holdAutoscroll(now: number = performance.now(), ms: number = AUTOSCROLL_HOLD_MS): void {
  heldUntil = Math.max(heldUntil, now + ms);
  setTimeout(() => {
    if (performance.now() >= heldUntil) for (const listener of resumeListeners) listener();
  }, ms + 1);
}

/** Whether a manual scroll is still holding autoscroll off. */
export function isAutoscrollHeld(now: number = performance.now()): boolean {
  return now < heldUntil;
}

/** Calls `listener` when a hold ends. Returns the function that stops listening. */
export function onAutoscrollResume(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

/** The keys that move the lyrics by hand. Pressing one of them holds autoscroll. */
export const SCROLL_KEYS = new Set(["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "]);

const STORAGE_KEY = "vltn.performance.autoscroll.v1";

interface AutoscrollSettings {
  mode: AutoscrollMode;
  linesPerMinute: number;
}

/** The stored choice, or the default when storage is missing, blocked or holds something else. */
function storedSettings(): AutoscrollSettings {
  const fallback: AutoscrollSettings = { mode: "line", linesPerMinute: LINES_PER_MINUTE.initial };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<AutoscrollSettings>;
    const mode = typeof parsed.mode === "string" && isAutoscrollMode(parsed.mode) ? parsed.mode : fallback.mode;
    return { mode, linesPerMinute: clampLinesPerMinute(Number(parsed.linesPerMinute ?? fallback.linesPerMinute)) };
  } catch {
    return fallback;
  }
}

/** The autoscroll style and speed the performer chose. Kept on this computer, so a rehearsal and the stage use the same choice. */
export const useAutoscroll = create<AutoscrollSettings & { update(patch: Partial<AutoscrollSettings>): void }>((set, get) => ({
  ...storedSettings(),
  update: (patch) => {
    const next = {
      mode: patch.mode !== undefined && isAutoscrollMode(patch.mode) ? patch.mode : get().mode,
      linesPerMinute: patch.linesPerMinute === undefined ? get().linesPerMinute : clampLinesPerMinute(patch.linesPerMinute),
    };
    set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* Storage can be blocked. The choice then lasts for this session only. */
    }
  },
}));
