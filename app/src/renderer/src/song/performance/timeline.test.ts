import { describe, expect, it } from "vitest";
import { audioTimeOf, gridClicks, gridStart, songTimeAt, type Segment } from "./timeline";

const straight: Segment[] = [{ ctxStart: 10, songStart: 0, songEnd: Infinity }];
/** Plays song 0–4 from audio 10, jumps back to song 2 at audio 14 (a loop of 2–4), and keeps going. */
const looped: Segment[] = [
  { ctxStart: 10, songStart: 0, songEnd: 4 },
  { ctxStart: 14, songStart: 2, songEnd: Infinity },
];
/** Plays song 0–4, then skips 4–8 and continues from 8 at audio 14. */
const skipped: Segment[] = [
  { ctxStart: 10, songStart: 0, songEnd: 4 },
  { ctxStart: 14, songStart: 8, songEnd: Infinity },
];

describe("songTimeAt", () => {
  it("maps audio time to song time on the segment that holds it", () => {
    expect(songTimeAt(straight, 12.5)).toBeCloseTo(2.5);
    expect(songTimeAt(looped, 13)).toBeCloseTo(3);
    expect(songTimeAt(looped, 14.5)).toBeCloseTo(2.5);
    expect(songTimeAt(skipped, 14)).toBeCloseTo(8);
  });

  it("runs backwards before the first segment starts, for a count-in", () => {
    expect(songTimeAt([{ ctxStart: 12, songStart: 0, songEnd: Infinity }], 10)).toBeCloseTo(-2);
  });

  it("reads zero with no segments", () => {
    expect(songTimeAt([], 10)).toBe(0);
  });

  it("gives the audio time a boundary plays at on the open segment", () => {
    expect(audioTimeOf(straight, 4)).toBeCloseTo(14);
    expect(audioTimeOf(looped, 6)).toBeCloseTo(18);
  });
});

describe("gridClicks", () => {
  it("clicks every beat on the audio clock until the window ends", () => {
    const { clicks, cursor } = gridClicks(straight, { segment: 0, beat: 0 }, 10, 10.9, 0, 0.5);
    expect(clicks.map((c) => c.when)).toEqual([10, 10.5]);
    expect(clicks.map((c) => c.beat)).toEqual([0, 1]);
    expect(cursor.beat).toBe(2);
  });

  it("keeps the bar phase across a jump: beats keep their absolute index, and the loop clicks the repeated passage again", () => {
    const { clicks } = gridClicks(looped, { segment: 0, beat: 0 }, 10, 15, 0, 0.5);
    // Song 0–4 on audio 10–14, then song 2 onwards again from 14: beats 4–7 are clicked twice, each time on their own beat.
    expect(clicks.map((c) => [c.when, c.beat])).toEqual([
      [10, 0],
      [10.5, 1],
      [11, 2],
      [11.5, 3],
      [12, 4],
      [12.5, 5],
      [13, 6],
      [13.5, 7],
      [14, 4],
      [14.5, 5],
      [15, 6],
    ]);
  });

  it("does not click the span a skip jumps over", () => {
    const { clicks } = gridClicks(skipped, { segment: 0, beat: 0 }, 10, 15, 0, 0.5);
    // Beats 8–15 (song 4–7.5) are never clicked: the song is not there. Playback resumes at song 8, on beat 16.
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18]);
    expect(clicks.find((c) => c.beat === 16)!.when).toBe(14);
  });

  it("waits at the end of a segment until the window reaches it, then moves on to the jump", () => {
    const waiting = gridClicks(looped, { segment: 0, beat: 6 }, 13, 13.2, 0, 0.5);
    expect(waiting.clicks.map((c) => c.beat)).toEqual([6]);
    expect(waiting.cursor).toEqual({ segment: 0, beat: 7 });
    // Beat 8 is song 4, the end of segment 0 at audio 14. The window reaches it, so the next click is the jump's first (song 2, beat 4).
    const moved = gridClicks(looped, { segment: 0, beat: 8 }, 13.9, 14.2, 0, 0.5);
    expect(moved.clicks.map((c) => [c.when, c.beat])).toEqual([[14, 4]]);
    expect(moved.cursor).toEqual({ segment: 1, beat: 5 });
  });

  it("skips beats that are already past rather than playing them late", () => {
    const { clicks } = gridClicks(straight, { segment: 0, beat: 4 }, 12.2, 12.6, 0, 0.5);
    expect(clicks.map((c) => c.when)).toEqual([12.5]);
  });

  it("always makes progress, even when a segment starts between two beats", () => {
    const segments: Segment[] = [{ ctxStart: 0, songStart: 0.2499999999, songEnd: Infinity }];
    const { clicks } = gridClicks(segments, { segment: 0, beat: 0 }, 0, 1, 0, 0.5);
    expect(clicks.length).toBeGreaterThan(0);
  });
});

describe("gridStart", () => {
  it("starts at the first beat at or after the song time playing", () => {
    expect(gridStart(straight, 11.2, 0, 0.5)).toEqual({ segment: 0, beat: 3 });
  });

  it("starts at beat zero during a count-in", () => {
    expect(gridStart([{ ctxStart: 12, songStart: 0, songEnd: Infinity }], 10, 0, 0.5)).toEqual({ segment: 0, beat: 0 });
  });
});

describe("playback rate", () => {
  // Plays song 0–4 at 50% from audio 10: a song second takes two audio seconds.
  const slow: Segment[] = [{ ctxStart: 10, songStart: 0, songEnd: 4, rate: 0.5 }];
  // Plays song 0–4 at 50% from audio 10 (ends at 18), then song 4 onward at full speed from 18.
  const mixed: Segment[] = [
    { ctxStart: 10, songStart: 0, songEnd: 4, rate: 0.5 },
    { ctxStart: 18, songStart: 4, songEnd: Infinity, rate: 1 },
  ];

  it("maps song time through the rate", () => {
    expect(songTimeAt(slow, 12)).toBeCloseTo(1);
    expect(songTimeAt(slow, 18)).toBeCloseTo(4);
    expect(songTimeAt(mixed, 20)).toBeCloseTo(6);
  });

  it("maps a song time to the audio time it plays at", () => {
    expect(audioTimeOf(slow, 4)).toBeCloseTo(18);
    expect(audioTimeOf(mixed, 6)).toBeCloseTo(20);
  });

  it("runs a count-in backwards at the rate", () => {
    expect(songTimeAt([{ ctxStart: 12, songStart: 0, songEnd: Infinity, rate: 0.5 }], 10)).toBeCloseTo(-1);
  });

  it("clicks each song beat at its rated audio time", () => {
    // Beats every song second, from song 0: at 50% they land every two audio seconds.
    const { clicks } = gridClicks(slow, { segment: 0, beat: 0 }, 10, 18, 0, 1);
    expect(clicks).toEqual([
      { when: 10, beat: 0 },
      { when: 12, beat: 1 },
      { when: 14, beat: 2 },
      { when: 16, beat: 3 },
    ]);
  });

  it("does not click past a rated segment's end until the audio reaches it", () => {
    const { clicks } = gridClicks(slow, { segment: 0, beat: 0 }, 10, 17, 0, 1);
    expect(clicks.map((c) => c.when)).toEqual([10, 12, 14, 16]);
  });

  it("keeps the beat phase when a rated song hands over to a full-speed one", () => {
    const { clicks } = gridClicks(mixed, { segment: 0, beat: 0 }, 10, 20, 0, 1);
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(clicks.at(-1)!.when).toBeCloseTo(20);
  });
});
