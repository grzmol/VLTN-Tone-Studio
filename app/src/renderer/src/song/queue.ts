import { overridesFor, withOverride, type EntryOverride } from "@shared/entry-overrides";

/*
 * The play queue (pure). The queue is the one list of what plays next: the playlist, the songs played so far and the songs still to come.
 * `position` is the playing song's index in it. Entries up to and including `position` are locked (the playing song and what has played),
 * so an edit can never change the song that is playing or the one before it. `overrides` lines up with `queue`: the per-entry autoplay and
 * end behaviour of each entry, moved with it on every edit. The live playback code reads `queue` and `position` directly, so every edit
 * goes through these functions and then the library re-prepares the next song (see `prefetchNext`).
 */

/** The most songs the queue holds, played and to come. */
export const QUEUE_MAX = 128;

export interface QueueState {
  queue: readonly string[];
  /** The playing song's index, or -1 when nothing has been loaded. */
  position: number;
  /** Per-entry overrides, aligned with `queue`. Missing means no entry has one. */
  overrides?: readonly (EntryOverride | null)[];
}
export type QueueEdit = { ok: true; queue: string[]; position: number; overrides: (EntryOverride | null)[] } | { ok: false; reason: string };

const LOCKED = "That song is playing or has already played.";

const ok = (queue: string[], position: number, overrides: (EntryOverride | null)[]): QueueEdit => ({ ok: true, queue, position, overrides });
const current = (state: QueueState) => overridesFor(state.queue.length, state.overrides);

/** The songs still to come, after the playing one. */
export function upcoming(state: QueueState): string[] {
  return state.queue.slice(state.position + 1);
}

/** Whether entry `index` can still be changed: it must come after the playing song. */
export function isEditable(state: QueueState, index: number): boolean {
  return Number.isInteger(index) && index > state.position && index < state.queue.length;
}

/** Puts `id` straight after the playing song. An upcoming copy of the same song moves up instead of being repeated. */
export function playNext(state: QueueState, id: string, override: EntryOverride | null = null): QueueEdit {
  if (state.queue[state.position] === id) return { ok: false, reason: "That song is already playing." };
  const keep = state.queue.map((entry, index) => !(index > state.position && entry === id));
  const queue = state.queue.filter((_, i) => keep[i]);
  const overrides = current(state).filter((_, i) => keep[i]);
  const at = state.position + 1;
  const next = [...queue.slice(0, at), id, ...queue.slice(at)];
  const nextOverrides = [...overrides.slice(0, at), override, ...overrides.slice(at)];
  if (next.length > QUEUE_MAX) return { ok: false, reason: `The queue holds up to ${QUEUE_MAX} songs.` };
  return ok(next, state.position, nextOverrides);
}

/** Adds `ids` to the end of the queue, in order, with their overrides. Refused as a whole when they would not all fit. */
export function addToQueue(state: QueueState, ids: readonly string[], overrides: readonly (EntryOverride | null)[] = []): QueueEdit {
  if (!ids.length) return ok([...state.queue], state.position, current(state));
  if (state.queue.length + ids.length > QUEUE_MAX) return { ok: false, reason: `The queue holds up to ${QUEUE_MAX} songs.` };
  return ok([...state.queue, ...ids], state.position, [...current(state), ...overridesFor(ids.length, overrides)]);
}

/** Removes the upcoming entry at `index`. The playing song and the songs before it cannot be removed. */
export function removeFromQueue(state: QueueState, index: number): QueueEdit {
  if (!isEditable(state, index)) return { ok: false, reason: LOCKED };
  return ok(
    state.queue.filter((_, i) => i !== index),
    state.position,
    current(state).filter((_, i) => i !== index),
  );
}

/**
 * Moves the upcoming entry at `from` to `to`. Both must be after the playing song. A target past the end goes to the bottom.
 */
export function moveInQueue(state: QueueState, from: number, to: number): QueueEdit {
  if (!isEditable(state, from)) return { ok: false, reason: LOCKED };
  const last = state.queue.length - 1;
  const target = Math.min(Math.max(to, state.position + 1), last);
  if (target === from) return ok([...state.queue], state.position, current(state));
  const next = [...state.queue];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  const overrides = current(state);
  const [movedOverride] = overrides.splice(from, 1);
  overrides.splice(target, 0, movedOverride);
  return ok(next, state.position, overrides);
}

/** Sets the override of the upcoming entry at `index`. The playing song and the songs before it cannot change. */
export function setEntryOverride(state: QueueState, index: number, override: EntryOverride | null): QueueEdit {
  if (!isEditable(state, index)) return { ok: false, reason: LOCKED };
  return ok([...state.queue], state.position, withOverride(current(state), index, override));
}

/** Moves the upcoming entry at `index` to the top of the upcoming songs, straight after the playing song. */
export function moveToTop(state: QueueState, index: number): QueueEdit {
  return moveInQueue(state, index, state.position + 1);
}

/** Moves the upcoming entry at `index` to the bottom of the queue. */
export function moveToBottom(state: QueueState, index: number): QueueEdit {
  return moveInQueue(state, index, state.queue.length - 1);
}
