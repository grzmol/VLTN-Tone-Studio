// Where the music was, kept for a renderer crash (spec 120). The session writes it while a song plays; after the window reloads the app
// offers to resume from it. It lives in localStorage because that survives a reload of the page, and the library is never touched: a
// partial state must not overwrite the saved songs. Writing is best effort, since a full or blocked store must never disturb playback.
import { isEntryOverride, type EntryOverride } from "@shared/entry-overrides";

export const RESUME_POINT_KEY = "vltn.performance.resume.v1";
/** A point older than this is a different evening, not a crash. */
export const RESUME_MAX_AGE_MS = 30 * 60 * 1000;

export interface ResumePoint {
  version: 1;
  savedAt: number;
  /** Library playing-set id, null for a single song or a queue that is not a set. */
  playlistId: string | null;
  /** Song ids in play order. */
  queue: string[];
  /** Index in `queue`. */
  position: number;
  songId: string;
  /** Seconds into the song. */
  songTime: number;
  playing: boolean;
  sendCues: boolean;
  stageMode: boolean;
  /** The queue's per-entry overrides, so an entry that waits for Play still waits after the reload. */
  overrides?: (EntryOverride | null)[];
}

let held = false;

/** While the app offers to resume, the old point must not be replaced by the paused, rewound state of the freshly loaded song. */
export function holdResumePoint(hold: boolean): void {
  held = hold;
}

export function resumePointHeld(): boolean {
  return held;
}

/** Writes the point unless a resume is on offer. */
export function saveResumePoint(point: ResumePoint): void {
  if (held) return;
  try {
    localStorage.setItem(RESUME_POINT_KEY, JSON.stringify(point));
  } catch {
    // a convenience for the crash case only
  }
}

/** Forgets the point, and any hold on it. */
export function clearResumePoint(): void {
  held = false;
  try {
    localStorage.removeItem(RESUME_POINT_KEY);
  } catch {
    // nothing to clear
  }
}

const isIndex = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** The stored point, or null when it is missing, malformed, from another version or older than 30 minutes. */
export function loadResumePoint(now: number): ResumePoint | null {
  try {
    const raw = localStorage.getItem(RESUME_POINT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ResumePoint> | null;
    if (!v || typeof v !== "object" || v.version !== 1) return null;
    if (typeof v.savedAt !== "number" || !Number.isFinite(v.savedAt) || now - v.savedAt > RESUME_MAX_AGE_MS || v.savedAt - now > 60_000) return null;
    if (!Array.isArray(v.queue) || !v.queue.length || !v.queue.every((id) => typeof id === "string" && id)) return null;
    if (!isIndex(v.position) || v.queue[v.position] !== v.songId || typeof v.songId !== "string") return null;
    if (typeof v.songTime !== "number" || !Number.isFinite(v.songTime) || v.songTime < 0) return null;
    if (v.playlistId !== null && typeof v.playlistId !== "string") return null;
    if (typeof v.playing !== "boolean" || typeof v.sendCues !== "boolean" || typeof v.stageMode !== "boolean") return null;
    const overrides = Array.isArray(v.overrides) && v.overrides.every((o) => o === null || isEntryOverride(o)) ? v.overrides : undefined;
    return { ...(v as ResumePoint), overrides };
  } catch {
    return null;
  }
}
