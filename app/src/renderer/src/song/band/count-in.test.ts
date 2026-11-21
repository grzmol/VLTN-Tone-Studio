import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, isBandSettings, parseBandSettings, planSections } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { runBandJob, transferables, type BandRequest } from "./band-job";
import { COUNT_TAIL, DEFAULT_COUNT_IN, STICK_CLICK, countInOf, parseCountIn } from "./count-in";
import { parseChordName, type ChordAtBeat } from "./harmony";
import { CLOSED_HAT, DRUM_PITCHES } from "./note";
import type { BassSample, DrumLayer, SampleSet } from "./samples";
import type { PcmAudio } from "../types";

const RATE = 44100;

function gridFrom(firstBeat: number, seconds = 16): BeatGrid {
  const beats: number[] = [];
  for (let time = firstBeat; time < seconds; time += 0.5) beats.push(time);
  return { beatsPerBar: 4, beats, downbeat: 0, bpm: 120, steady: { bpm: 120, firstBeat } };
}

describe("parseCountIn", () => {
  it("gives no count for anything that is not one, so a song saved before counts existed plays as it did", () => {
    for (const value of [undefined, null, "sticks", { bars: 3 }, { sound: "hat" }]) {
      expect(parseCountIn(value).bars).toBe(0);
    }
    expect(parseBandSettings({}).countIn).toEqual(DEFAULT_COUNT_IN);
  });

  it("keeps the bars and the sound, and is part of what makes band settings valid", () => {
    expect(parseCountIn({ bars: 2, sound: "hat" })).toEqual({ bars: 2, sound: "hat" });
    expect(parseCountIn({ bars: 1, sound: "cowbell" })).toEqual({ bars: 1, sound: "sticks" });
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, countIn: { bars: 1, sound: "hat" } })).toBe(true);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, countIn: { bars: 5, sound: "hat" } })).toBe(false);
  });
});

describe("countInOf", () => {
  it("has no count when the settings ask for none", () => {
    expect(countInOf(gridFrom(0), DEFAULT_COUNT_IN)).toBeNull();
  });

  it("is 4 hits a bar at beat spacing, the last one beat before the first downbeat", () => {
    const one = countInOf(gridFrom(0), { bars: 1, sound: "sticks" })!;
    expect(one.notes).toHaveLength(4);
    expect(one.notes.map((note) => note.time)).toEqual([0, 0.5, 1, 1.5]);
    // The buffer starts two seconds before the song, so its last hit (1.5 s in) is 0.5 s, one beat, before the downbeat at song time 0.
    expect(one.start).toBe(-2);
    expect(one.start + one.notes[3].time).toBeCloseTo(-0.5);
    const two = countInOf(gridFrom(0), { bars: 2, sound: "sticks" })!;
    expect(two.notes).toHaveLength(8);
    expect(two.start).toBe(-4);
    expect(two.length).toBeCloseTo(4 + COUNT_TAIL);
  });

  it("is louder in the last bar, and uses the hat when asked", () => {
    const stick = countInOf(gridFrom(0), { bars: 2, sound: "sticks" })!;
    expect(stick.notes.map((note) => note.velocity)).toEqual([95, 95, 95, 95, 105, 105, 105, 105]);
    expect(stick.notes.every((note) => note.pitch === STICK_CLICK)).toBe(true);
    expect(countInOf(gridFrom(0), { bars: 1, sound: "hat" })!.notes.every((note) => note.pitch === CLOSED_HAT)).toBe(true);
  });

  it("counts from the downbeat's tempo and starts inside the song when there is room before it", () => {
    // The first downbeat is 5 s in: a bar of count fits in the 5 s before it, so the buffer starts at 3 s, in the song.
    const count = countInOf(gridFrom(5), { bars: 1, sound: "sticks" })!;
    expect(count.start).toBe(3);
    // Beats 5 s late, at half a second: the count ends one beat (0.5 s) before 5 s.
    expect(count.start + count.notes[3].time).toBeCloseTo(4.5);
  });

  it("has no count for a grid with no bar after its downbeat to take the tempo from", () => {
    expect(countInOf({ ...gridFrom(0), beats: [0, 0.5, 1] }, { bars: 1, sound: "hat" })).toBeNull();
  });
});

const constant = (value: number, length: number): PcmAudio => ({
  sampleRate: RATE,
  channels: [new Float32Array(length).fill(value), new Float32Array(length).fill(value)],
});

function stubSamples(): SampleSet {
  const drums = new Map<number, DrumLayer[]>();
  for (const pitch of DRUM_PITCHES) drums.set(pitch, [{ velocity: [1, 127], nominal: 100, transpose: 0, takes: [constant(0.1, RATE / 4)] }]);
  const bass: BassSample[] = [36, 48, 60].map((root) => ({ root, layer: "p", velocity: [1, 127], audio: constant(0.1, RATE) }));
  return { drums, bass };
}

function request(countIn: BandRequest["settings"]["countIn"], drums = true): BandRequest {
  const grid = gridFrom(0);
  const chord = parseChordName("C");
  const harmony: ChordAtBeat[] = grid.beats.map((time, beat) => ({ beat, time, chord }));
  const settings = { ...DEFAULT_BAND_SETTINGS, countIn };
  return {
    grid,
    harmony,
    keys: [],
    plans: planSections([], 16, settings),
    settings,
    seed: 3,
    lengthFrames: 16 * RATE,
    parts: { drums, bass: true },
    sampleUrls: {},
  };
}

describe("runBandJob with a count-in", () => {
  it("renders the count as its own buffer, beside the drums, and leaves the drums as they were", () => {
    const without = runBandJob(request(DEFAULT_COUNT_IN), stubSamples());
    const withCount = runBandJob(request({ bars: 1, sound: "sticks" }), stubSamples());
    expect(without.countIn).toBeUndefined();
    expect(withCount.countIn?.audio.channels[0].length).toBeGreaterThanOrEqual(Math.floor(2.3 * RATE));
    expect(withCount.countIn?.start).toBe(-2);
    const peak = Math.max(...withCount.countIn!.audio.channels[0].map(Math.abs));
    expect(peak).toBeGreaterThan(0);
    expect(withCount.notes.drums).toEqual(without.notes.drums);
    expect(withCount.drums?.channels[0]).toHaveLength(16 * RATE);
    expect(transferables(withCount).length).toBe(transferables(without).length + 2);
  });

  it("has no count when the drums are not asked for", () => {
    expect(runBandJob(request({ bars: 2, sound: "hat" }, false), stubSamples()).countIn).toBeUndefined();
  });
});
