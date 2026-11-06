import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections, type BandSettings } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateDrums } from "./drums";
import { DRUM_PITCHES } from "./note";
import { parseChordName, type ChordAtBeat } from "./harmony";
import { previewWindow, runBandJob, runBandPreview, transferables, type BandRequest } from "./band-job";
import { loudnessOf } from "./level";
import type { BassSample, DrumLayer, SampleSet } from "./samples";
import type { PcmAudio } from "../types";

const RATE = 44100;
const SONG_SECONDS = 16;

/** Whether two channels hold exactly the same samples. Plain loop: a deep toEqual on a whole song's samples is slow enough to time out on CI. */
function sameSamples(a: Float32Array | undefined, b: Float32Array | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const constant = (value: number, length: number): PcmAudio => ({
  sampleRate: RATE,
  channels: [new Float32Array(length).fill(value), new Float32Array(length).fill(value)],
});

/** Stub samples for every drum piece the styles use, and three bass roots. The audio is constant, so the tests look at timing and level. */
function stubSamples(): SampleSet {
  const drums = new Map<number, DrumLayer[]>();
  for (const pitch of DRUM_PITCHES) drums.set(pitch, [{ velocity: [1, 127], nominal: 100, transpose: 0, audio: constant(0.1, RATE / 4) }]);
  const bass: BassSample[] = [36, 48, 60].map((root) => ({ root, layer: "p", velocity: [1, 127], audio: constant(0.1, RATE) }));
  return { drums, bass };
}

/** A steady grid: 120 BPM, one beat every half second, a downbeat on the first beat. */
function steadyGrid(seconds = SONG_SECONDS): BeatGrid {
  const beats: number[] = [];
  for (let time = 0; time < seconds; time += 0.5) beats.push(time);
  return { beatsPerBar: 4, beats, downbeat: 0, bpm: 120, steady: { bpm: 120, firstBeat: 0 } };
}

function request(overrides: Partial<BandRequest> = {}): BandRequest {
  const grid = steadyGrid();
  const chord = parseChordName("C");
  const harmony: ChordAtBeat[] = grid.beats.map((time, beat) => ({ beat, time, chord }));
  return {
    grid,
    harmony,
    plans: planSections([], SONG_SECONDS, DEFAULT_BAND_SETTINGS),
    settings: DEFAULT_BAND_SETTINGS,
    seed: 7,
    lengthFrames: SONG_SECONDS * RATE,
    parts: { drums: true, bass: true },
    sampleUrls: {},
    ...overrides,
  };
}

describe("runBandJob", () => {
  it("renders both parts at the song's length and returns their notes", () => {
    const result = runBandJob(request(), stubSamples());
    expect(result.drums?.channels[0]).toHaveLength(SONG_SECONDS * RATE);
    expect(result.bass?.channels[1]).toHaveLength(SONG_SECONDS * RATE);
    expect(result.notes.drums.length).toBeGreaterThan(0);
    expect(result.notes.bass.length).toBeGreaterThan(0);
  });

  it("renders only the parts the request asks for", () => {
    const result = runBandJob(request({ parts: { drums: false, bass: true } }), stubSamples());
    expect(result.drums).toBeUndefined();
    expect(result.notes.drums).toEqual([]);
    expect(result.bass).toBeDefined();
  });

  it("gives the same audio for the same seed, and different notes for another seed", () => {
    const first = runBandJob(request(), stubSamples());
    const again = runBandJob(request(), stubSamples());
    expect(sameSamples(again.drums?.channels[0], first.drums?.channels[0])).toBe(true);
    expect(sameSamples(again.bass?.channels[0], first.bass?.channels[0])).toBe(true);
    const other = runBandJob(request({ seed: 8 }), stubSamples());
    expect(JSON.stringify(other.notes)).not.toEqual(JSON.stringify(first.notes));
  });

  it("reports the stages in order", () => {
    const stages: string[] = [];
    runBandJob(request(), stubSamples(), (stage) => stages.push(stage));
    expect(stages).toEqual(["generating", "rendering"]);
  });
});

describe("previewWindow", () => {
  it("covers the bars from a downbeat exactly", () => {
    // 4 bars of 4 beats at 0.5 s is 8 s.
    expect(previewWindow(steadyGrid(), 4, 4)).toEqual({ start: 4, end: 12 });
  });

  it("starts at the time asked for, and ends on the grid's beats", () => {
    expect(previewWindow(steadyGrid(), 1.2, 1)).toEqual({ start: 1.2, end: 3.5 });
  });

  it("extends the grid past its last beat", () => {
    // Beats run to 15.5 s. Four beats past 15.0 land at 17.0 s.
    expect(previewWindow(steadyGrid(), 15, 1)).toEqual({ start: 15, end: 17 });
  });
});

describe("runBandPreview", () => {
  it("renders the bars from a time, moved to start at 0, and nothing outside them", () => {
    const result = runBandPreview(request(), stubSamples(), 4, 4);
    expect(result.drums?.channels[0]).toHaveLength(8 * RATE);
    for (const note of [...result.notes.drums, ...result.notes.bass]) {
      expect(note.time).toBeGreaterThanOrEqual(0);
      expect(note.time).toBeLessThan(8);
    }
  });
});

describe("transferables", () => {
  it("lists each rendered channel's buffer once", () => {
    const result = runBandJob(request(), stubSamples());
    const buffers = transferables(result);
    expect(buffers).toHaveLength(4);
    expect(buffers).toContain(result.drums?.channels[0].buffer);
    expect(buffers).toContain(result.bass?.channels[1].buffer);
  });

  it("lists nothing for a result without audio", () => {
    expect(transferables({ notes: { drums: [], bass: [] } })).toEqual([]);
  });
});

describe("runBandJob with follow-my-playing", () => {
  /** A mono click track with a click on every beat, the bar's downbeat loudest, so every bar repeats the same pattern. */
  const clicks = (seconds = SONG_SECONDS): PcmAudio => {
    const channel = new Float32Array(seconds * RATE);
    for (let beat = 0; beat < seconds * 2; beat++) channel[Math.round(beat * 0.5 * RATE)] = beat % 4 === 0 ? 1 : beat % 2 === 0 ? 0.6 : 0.3;
    return { sampleRate: RATE, channels: [channel] };
  };
  const followed = (settings: Partial<BandSettings>, audio: PcmAudio) =>
    request({ settings: { ...DEFAULT_BAND_SETTINGS, ...settings }, follow: { source: "guitar", audio } });

  it("follows a song that repeats its accents, and says which source it read", () => {
    const result = runBandJob(followed({}, clicks()), stubSamples());
    expect(result.follow).toEqual({ source: "guitar", following: true });
  });

  it("gives the same audio for the same seed, with the feel", () => {
    const first = runBandJob(followed({}, clicks()), stubSamples());
    const again = runBandJob(followed({}, clicks()), stubSamples());
    expect(again.notes).toEqual(first.notes);
    expect(sameSamples(again.drums?.channels[0], first.drums?.channels[0])).toBe(true);
  });

  it("gives the same notes as follow-my-playing off when auto finds no clear accents", () => {
    const flat = constant(0.1, SONG_SECONDS * RATE);
    const result = runBandJob(followed({}, { sampleRate: RATE, channels: [flat.channels[0]] }), stubSamples());
    const off = runBandJob(followed({ followPlaying: false }, flat), stubSamples());
    expect(result.follow).toEqual({ source: "guitar", following: false });
    expect(result.notes).toEqual(off.notes);
    expect(sameSamples(result.drums?.channels[0], off.drums?.channels[0])).toBe(true);
  });

  it("follows even a flat source when the source is chosen by hand", () => {
    const flat = constant(0.1, SONG_SECONDS * RATE);
    const result = runBandJob(followed({ followSource: "guitar" }, { sampleRate: RATE, channels: [flat.channels[0]] }), stubSamples());
    expect(result.follow).toEqual({ source: "guitar", following: true });
  });

  it("leaves the result without a follow report when the setting is off", () => {
    const result = runBandJob(followed({ followPlaying: false }, clicks()), stubSamples());
    expect(result.follow).toBeUndefined();
  });
});

describe("runBandJob humanising", () => {
  it("at amount 0 gives the generated drum notes exactly", () => {
    const settings: BandSettings = { ...DEFAULT_BAND_SETTINGS, humanise: { amount: 0, feel: "style" } };
    const result = runBandJob(request({ settings }), stubSamples());
    expect(result.notes.drums).toEqual(generateDrums(request().grid, request().plans, settings, 7));
  });

  it("moves the notes at a higher amount, and keeps how many notes there are and which pitches", () => {
    const flat = runBandJob(request({ settings: { ...DEFAULT_BAND_SETTINGS, humanise: { amount: 0, feel: "style" } } }), stubSamples());
    const humanised = runBandJob(request({ settings: { ...DEFAULT_BAND_SETTINGS, humanise: { amount: 1, feel: "laid-back" } } }), stubSamples());
    expect(humanised.notes.drums).toHaveLength(flat.notes.drums.length);
    expect(humanised.notes.bass).toHaveLength(flat.notes.bass.length);
    const pitches = (notes: { pitch: number }[]) => notes.map((note) => note.pitch).sort((a, b) => a - b);
    expect(pitches(humanised.notes.drums)).toEqual(pitches(flat.notes.drums));
    expect(pitches(humanised.notes.bass)).toEqual(pitches(flat.notes.bass));
    expect(humanised.notes.drums.map((note) => note.time)).not.toEqual(flat.notes.drums.map((note) => note.time));
  });
});

describe("runBandJob levels", () => {
  /** A steady stereo tone of SONG_SECONDS. Its loudness follows its amplitude, so a test can know the song's level. */
  const tone = (amplitude: number): PcmAudio => {
    const channel = new Float32Array(SONG_SECONDS * RATE);
    for (let i = 0; i < channel.length; i++) channel[i] = amplitude * Math.sin((2 * Math.PI * 110 * i) / RATE);
    return { sampleRate: RATE, channels: [channel, channel.slice()] };
  };
  const mix = tone(0.05);
  const songLufs = loudnessOf(mix);

  it("sets the bass 7 LU under the song when there is no bass stem, and reports how far under", () => {
    const result = runBandJob(request({ mix }), stubSamples());
    const bass = result.levels?.bass;
    expect(bass).toBeDefined();
    expect(bass!.limitedByPeak).toBe(false);
    expect(bass!.belowSongDb).toBeCloseTo(7, 0);
    expect(Math.abs(loudnessOf(result.bass!) - (songLufs - 7))).toBeLessThan(0.5);
  });

  it("sets the drums 4 LU under the song when there is no drums stem", () => {
    const result = runBandJob(request({ mix }), stubSamples());
    expect(result.levels?.drums?.belowSongDb).toBeCloseTo(4, 0);
    expect(Math.abs(loudnessOf(result.drums!) - (songLufs - 4))).toBeLessThan(0.5);
  });

  it("matches the original bass stem's loudness when the split has one", () => {
    const stem = tone(0.02);
    const result = runBandJob(request({ mix, originals: { bass: stem } }), stubSamples());
    expect(Math.abs(loudnessOf(result.bass!) - loudnessOf(stem))).toBeLessThan(0.5);
    expect(result.levels?.bass?.belowSongDb).toBeCloseTo(songLufs - loudnessOf(stem), 0);
  });

  it("levels nothing when the request has no mix to measure", () => {
    const result = runBandJob(request(), stubSamples());
    expect(result.levels).toBeUndefined();
  });

  it("levels the preview the same way Generate does", () => {
    const full = runBandJob(request({ mix }), stubSamples());
    const preview = runBandPreview(request({ mix }), stubSamples(), 4, 4);
    expect(preview.levels?.bass?.gainDb).toBeCloseTo(full.levels!.bass!.gainDb, 6);
    expect(preview.bass?.channels[0]).toHaveLength(8 * RATE);
  });
});

describe("runBandJob bass ends", () => {
  it("keeps every bass note ended before the next, after humanising moves the starts", () => {
    const result = runBandJob(request({ settings: { ...DEFAULT_BAND_SETTINGS, humanise: { amount: 1, feel: "laid-back" } } }), stubSamples());
    const sorted = [...result.notes.bass].sort((a, b) => a.time - b.time);
    expect(sorted.length).toBeGreaterThan(1);
    for (let i = 0; i + 1 < sorted.length; i++) expect(sorted[i].time + sorted[i].duration).toBeLessThanOrEqual(sorted[i + 1].time - 0.01 + 1e-9);
  });
});
