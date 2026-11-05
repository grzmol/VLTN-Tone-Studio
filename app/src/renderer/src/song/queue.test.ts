import { describe, expect, it } from "vitest";
import {
  QUEUE_MAX,
  addToQueue,
  isEditable,
  moveInQueue,
  moveToBottom,
  moveToTop,
  playNext,
  removeFromQueue,
  upcoming,
  type QueueState,
  setEntryOverride,
} from "./queue";

/** A queue where "a" is playing, "b" and "c" are played before it, and "d" "e" "f" are still to come. */
const state: QueueState = { queue: ["b", "c", "a", "d", "e", "f"], position: 2 };

describe("what plays next", () => {
  it("lists only the songs still to come", () => {
    expect(upcoming(state)).toEqual(["d", "e", "f"]);
    expect(upcoming({ queue: ["x"], position: -1 })).toEqual(["x"]);
  });

  it("locks the playing song and the songs before it", () => {
    expect([0, 1, 2, 3].map((i) => isEditable(state, i))).toEqual([false, false, false, true]);
  });
});

describe("play next", () => {
  it("puts a song straight after the playing one", () => {
    expect(playNext(state, "z")).toMatchObject({ ok: true, queue: ["b", "c", "a", "z", "d", "e", "f"], position: 2 });
  });

  it("moves an upcoming copy up rather than repeating it", () => {
    expect(playNext(state, "e")).toMatchObject({ ok: true, queue: ["b", "c", "a", "e", "d", "f"], position: 2 });
  });

  it("refuses the song that is already playing", () => {
    expect(playNext(state, "a")).toEqual({ ok: false, reason: "That song is already playing." });
  });

  it("works with nothing loaded", () => {
    expect(playNext({ queue: [], position: -1 }, "a")).toMatchObject({ ok: true, queue: ["a"], position: -1 });
  });

  it("refuses when the queue is full", () => {
    const full: QueueState = { queue: Array.from({ length: QUEUE_MAX }, (_, i) => `s${i}`), position: 0 };
    expect(playNext(full, "x")).toEqual({ ok: false, reason: `The queue holds up to ${QUEUE_MAX} songs.` });
  });
});

describe("add to queue", () => {
  it("appends songs in order", () => {
    expect(addToQueue(state, ["x", "y"])).toMatchObject({ ok: true, queue: ["b", "c", "a", "d", "e", "f", "x", "y"], position: 2 });
  });

  it("adds nothing for an empty list", () => {
    expect(addToQueue(state, [])).toMatchObject({ ok: true, queue: state.queue, position: 2 });
  });

  it("holds the queue to 128 songs, and refuses the whole addition when it would not fit", () => {
    const nearly: QueueState = { queue: Array.from({ length: QUEUE_MAX - 1 }, (_, i) => `s${i}`), position: -1 };
    expect(addToQueue(nearly, ["one"]).ok).toBe(true);
    expect(addToQueue(nearly, ["one", "two"])).toEqual({ ok: false, reason: `The queue holds up to ${QUEUE_MAX} songs.` });
  });
});

describe("removing and moving entries", () => {
  it("removes an upcoming entry", () => {
    expect(removeFromQueue(state, 4)).toMatchObject({ ok: true, queue: ["b", "c", "a", "d", "f"], position: 2 });
  });

  it("will not remove the playing song or a played one", () => {
    expect(removeFromQueue(state, 2).ok).toBe(false);
    expect(removeFromQueue(state, 0).ok).toBe(false);
  });

  it("moves an entry down the upcoming songs", () => {
    expect(moveInQueue(state, 3, 5)).toMatchObject({ ok: true, queue: ["b", "c", "a", "e", "f", "d"], position: 2 });
  });

  it("moves an entry up, but never above the playing song", () => {
    expect(moveInQueue(state, 5, 0)).toMatchObject({ ok: true, queue: ["b", "c", "a", "f", "d", "e"], position: 2 });
  });

  it("moves an entry to the top or the bottom of the upcoming songs", () => {
    expect(moveToTop(state, 5)).toMatchObject({ ok: true, queue: ["b", "c", "a", "f", "d", "e"], position: 2 });
    expect(moveToBottom(state, 3)).toMatchObject({ ok: true, queue: ["b", "c", "a", "e", "f", "d"], position: 2 });
  });

  it("leaves the queue alone when an entry is dropped where it already is", () => {
    expect(moveInQueue(state, 4, 4)).toMatchObject({ ok: true, queue: state.queue, position: 2 });
  });

  it("refuses to move a locked entry", () => {
    expect(moveInQueue(state, 1, 4).ok).toBe(false);
  });

  it("never changes the playing position through an edit", () => {
    const edits = [playNext(state, "z"), addToQueue(state, ["z"]), removeFromQueue(state, 3), moveInQueue(state, 5, 3)];
    for (const edit of edits) if (edit.ok) expect(edit.position).toBe(2);
  });
});

describe("per-entry overrides in the queue", () => {
  const loop = { endBehaviour: "loop" as const };
  const withLoop: QueueState = { queue: ["b", "c", "a", "d", "e", "f"], position: 2, overrides: [null, null, null, loop, null, null] };

  it("keeps an override with its song when the song moves", () => {
    const moved = moveInQueue(withLoop, 3, 5);
    expect(moved).toMatchObject({ ok: true, queue: ["b", "c", "a", "e", "f", "d"], overrides: [null, null, null, null, null, loop] });
  });

  it("removes an override with its song", () => {
    expect(removeFromQueue(withLoop, 3)).toMatchObject({ ok: true, queue: ["b", "c", "a", "e", "f"], overrides: [null, null, null, null, null] });
  });

  it("sets and clears an upcoming entry's override, and refuses one that is locked", () => {
    const stop = { endBehaviour: "stop" as const };
    expect(setEntryOverride(withLoop, 4, stop)).toMatchObject({ ok: true, overrides: [null, null, null, loop, stop, null] });
    expect(setEntryOverride(withLoop, 3, null)).toMatchObject({ ok: true, overrides: [null, null, null, null, null, null] });
    expect(setEntryOverride(withLoop, 1, stop).ok).toBe(false);
  });

  it("gives a song played next its own override, and the copy it moves up keeps none", () => {
    const stop = { endBehaviour: "stop" as const };
    expect(playNext(withLoop, "e", stop)).toMatchObject({ ok: true, queue: ["b", "c", "a", "e", "d", "f"], overrides: [null, null, null, stop, loop, null] });
  });

  it("adds songs with their overrides, and an empty override list adds none", () => {
    const stop = { endBehaviour: "stop" as const };
    expect(addToQueue(withLoop, ["x", "y"], [stop, null])).toMatchObject({ ok: true, overrides: [null, null, null, loop, null, null, stop, null] });
    expect(addToQueue(withLoop, ["x"])).toMatchObject({ ok: true, overrides: [null, null, null, loop, null, null, null] });
  });
});
