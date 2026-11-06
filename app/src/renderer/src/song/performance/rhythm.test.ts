import { describe, expect, it } from "vitest";
import { clicksWhilePlaying, clicksWhileStopped, countInBeats, preRollStart, recordTap, tapBpm, TAP_RESET_MS } from "./rhythm";

describe("metronome modes", () => {
  it("splits the modes into stopped and playing clicks", () => {
    expect({
      off: [clicksWhileStopped("off"), clicksWhilePlaying("off")],
      stopped: [clicksWhileStopped("stopped"), clicksWhilePlaying("stopped")],
      playing: [clicksWhileStopped("playing"), clicksWhilePlaying("playing")],
      both: [clicksWhileStopped("both"), clicksWhilePlaying("both")],
    }).toEqual({
      off: [false, false],
      stopped: [true, false],
      playing: [false, true],
      both: [true, true],
    });
  });
});

describe("count-in and pre-roll", () => {
  it("counts whole bars of beats", () => {
    expect(countInBeats(1, 4)).toBe(4);
    expect(countInBeats(2, 4)).toBe(8);
    expect(countInBeats(0, 4)).toBe(0);
  });

  it("starts audio two beats before a mid-song position at 120 BPM", () => {
    expect(preRollStart(60, 2, 120)).toBeCloseTo(59);
  });

  it("never starts before the song", () => {
    expect(preRollStart(0.5, 4, 120)).toBe(0);
    expect(preRollStart(10, 0, 120)).toBe(10);
  });
});

describe("tap tempo", () => {
  it("averages the last four taps", () => {
    let taps: number[] = [];
    for (const at of [0, 500, 1000, 1500, 2000]) taps = recordTap(taps, at);
    expect(taps).toEqual([500, 1000, 1500, 2000]);
    expect(tapBpm(taps)).toBe(120);
  });

  it("needs two taps and returns null until then", () => {
    expect(tapBpm([])).toBeNull();
    expect(tapBpm(recordTap([], 0))).toBeNull();
    expect(tapBpm(recordTap(recordTap([], 0), 600))).toBe(100);
  });

  it("starts a new sequence after two seconds of silence", () => {
    let taps = recordTap(recordTap([], 0), 500);
    taps = recordTap(taps, 500 + TAP_RESET_MS + 1);
    expect(taps).toEqual([500 + TAP_RESET_MS + 1]);
  });

  it("clamps to the song tempo range", () => {
    expect(tapBpm([0, 100])).toBe(300);
    expect(tapBpm([0, 5000])).toBe(30);
  });
});
