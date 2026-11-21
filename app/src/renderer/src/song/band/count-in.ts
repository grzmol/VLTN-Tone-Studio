// The drummer's count-in (spec 136, part B). Pure: it decides where the count's hits fall, and band-job.ts renders them with the drum
// samples. The count is its own short buffer, not part of the drums track: a song rarely has a free bar before its first beat, so the session
// plays the buffer ahead of the song, through the drums' bus.

import type { BeatGrid } from "./beat-grid";
import { CLOSED_HAT, type NoteEvent } from "./note";
import { barBeats } from "./timing";

/** What the drummer counts on: sticks clicked together, or the closed hat. */
export const COUNT_IN_SOUNDS = ["sticks", "hat"] as const;
export type CountInSound = (typeof COUNT_IN_SOUNDS)[number];

export interface CountInSettings {
  /** Bars counted before the song's first downbeat. 0 is no count. */
  bars: 0 | 1 | 2;
  sound: CountInSound;
}

export const DEFAULT_COUNT_IN: CountInSettings = { bars: 0, sound: "sticks" };

/**
 * The pitch of a stick click. It is General MIDI's own "sticks" note, which the kit has no sample for: the render plays the cross-stick
 * sample five semitones up, cut to STICK_SECONDS.
 */
export const STICK_CLICK = 31;
export const STICK_TRANSPOSE = 5;
export const STICK_SECONDS = 0.06;
/** A hit of the count is this loud, and the hits of the last bar are louder. */
const COUNT_VELOCITY = 95;
const LAST_BAR_VELOCITY = 105;
/** How long the count's buffer runs on after its last hit, so a hat's ring is not cut. */
export const COUNT_TAIL = 0.3;

export function isCountIn(value: unknown): value is CountInSettings {
  if (typeof value !== "object" || value === null) return false;
  const count = value as Record<string, unknown>;
  return (count.bars === 0 || count.bars === 1 || count.bars === 2) && COUNT_IN_SOUNDS.includes(count.sound as CountInSound);
}

/** Reads a saved count-in. A song saved before counts existed, or a damaged value, has none. */
export function parseCountIn(value: unknown): CountInSettings {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_COUNT_IN };
  const count = value as Record<string, unknown>;
  const bars = count.bars === 1 || count.bars === 2 ? count.bars : 0;
  const sound = COUNT_IN_SOUNDS.includes(count.sound as CountInSound) ? (count.sound as CountInSound) : DEFAULT_COUNT_IN.sound;
  return { bars, sound };
}

/** The drummer's count: where it starts in song seconds, how long its buffer runs, and its hits placed from the start of that buffer. */
export interface CountIn {
  /** Song time of the buffer's start. Negative when the song has no room before its first downbeat: the session then plays the count ahead of the song. */
  start: number;
  /** Seconds the buffer lasts, including the tail after the last hit. */
  length: number;
  notes: NoteEvent[];
}

/**
 * The hits of the count. They are one beat apart, at the tempo of the grid's first bar, and the last one falls one beat before the first
 * downbeat. Null when the settings ask for no count, or the grid has no downbeat with a bar after it to take the tempo from.
 */
export function countInOf(grid: BeatGrid, settings: CountInSettings): CountIn | null {
  if (settings.bars === 0) return null;
  const perBar = barBeats(grid);
  const first = Math.max(0, Math.round(grid.downbeat));
  if (first + perBar >= grid.beats.length) return null;
  const interval = (grid.beats[first + perBar] - grid.beats[first]) / perBar;
  if (!(interval > 0)) return null;
  const hits = settings.bars * perBar;
  const start = grid.beats[first] - hits * interval;
  const pitch = settings.sound === "hat" ? CLOSED_HAT : STICK_CLICK;
  const notes: NoteEvent[] = Array.from({ length: hits }, (_, hit) => ({
    time: hit * interval,
    pitch,
    velocity: hit >= hits - perBar ? LAST_BAR_VELOCITY : COUNT_VELOCITY,
    duration: STICK_SECONDS,
  }));
  return { start, length: hits * interval + COUNT_TAIL, notes };
}
