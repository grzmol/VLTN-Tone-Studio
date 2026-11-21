import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, TONE_BLOCK_TYPE, planSections, type BandSettings } from "./arrangement";
import { fixedBeatGrid, type BeatGrid } from "./beat-grid";
import type { Section } from "../performance/sections";
import { generateDrums } from "./drums";
import { DRUM_PITCHES, KICK } from "./note";
import { parseChordName, type ChordAtBeat } from "./harmony";
import { sectionPreviewBars, previewWindow, runBandJob, runBandPreview, transferables, type BandRequest } from "./band-job";
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
  for (const pitch of DRUM_PITCHES) drums.set(pitch, [{ velocity: [1, 127], nominal: 100, transpose: 0, takes: [constant(0.1, RATE / 4)] }]);
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

describe("runBandJob: the built-in room", () => {
  /** Drums that are one frame long, so everything between the hits is the room. */
  function clickKit(): SampleSet {
    const click = { sampleRate: RATE, channels: [new Float32Array(1).fill(0.5), new Float32Array(1).fill(0.5)] };
    const drums = new Map<number, DrumLayer[]>();
    for (const pitch of DRUM_PITCHES) drums.set(pitch, [{ velocity: [1, 127], nominal: 100, transpose: 0, takes: [click] }]);
    const tail = new Float32Array(RATE / 2);
    tail[0] = 1;
    tail[Math.round(0.1 * RATE)] = 0.5;
    return { drums, bass: [], room: { sampleRate: RATE, channels: [tail, tail] } };
  }
  const drumsOf = (settings: Partial<BandSettings>, samples = clickKit()): Float32Array =>
    runBandJob(request({ settings: { ...DEFAULT_BAND_SETTINGS, ...settings }, parts: { drums: true, bass: false } }), samples).drums!.channels[0];
  const quiet = (channel: Float32Array): number => channel.reduce((count, value) => count + (Math.abs(value) < 1e-9 ? 1 : 0), 0);

  it("gives the same drums with the room at 0 as a kit that has no room", () => {
    const { room, ...noRoom } = clickKit();
    expect(room).toBeDefined();
    expect(sameSamples(drumsOf({ drumRoom: 0 }), drumsOf({ drumRoom: 0.25 }, noRoom))).toBe(true);
  });

  it("adds sound after the dry hit has ended when the room is up", () => {
    const dry = drumsOf({ drumRoom: 0 });
    const wet = drumsOf({ drumRoom: 0.25 });
    expect(quiet(dry)).toBeGreaterThan(SONG_SECONDS * RATE * 0.9);
    // Dry, only the hits' own frames make sound; with the room, every hit is followed by its tail.
    expect(wet.length - quiet(wet)).toBeGreaterThan((dry.length - quiet(dry)) * 5);
  });

  it("gives a kit that wants more room more of it", () => {
    const loud = { ...clickKit(), roomScale: 1.6 };
    const energy = (channel: Float32Array): number => channel.reduce((sum, value) => sum + value * value, 0);
    expect(energy(drumsOf({ drumRoom: 0.25 }, loud))).toBeGreaterThan(energy(drumsOf({ drumRoom: 0.25 })));
    expect(sameSamples(drumsOf({ drumRoom: 0 }, loud), drumsOf({ drumRoom: 0 }))).toBe(true);
  });

  it("skips the room when the drum tone chain has a space block that is on", () => {
    const space = { type: TONE_BLOCK_TYPE.space, role: "space" as const, file: null, inputDb: 0, outputDb: 0, mix: 0.3, on: true };
    const withChain = (on: boolean): Partial<BandSettings> => ({ drumRoom: 0.5, drumTone: { kind: "chain", blocks: [{ ...space, on }], dryWet: 1, fast: false } });
    expect(sameSamples(drumsOf(withChain(true)), drumsOf({ drumRoom: 0 }))).toBe(true);
    expect(sameSamples(drumsOf(withChain(false)), drumsOf({ drumRoom: 0.5 }))).toBe(true);
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

describe("runBandJob bass techniques", () => {
  it("keeps the slides and dead notes the bass generator makes when humanising is on", () => {
    const settings: BandSettings = {
      ...DEFAULT_BAND_SETTINGS,
      humanise: { amount: 0.5, feel: "style" },
      bassMode: "roots",
      complexity: 1,
      sections: {
        funk: { style: "funk", bassPart: "ring", busy: 3, deadNotes: true, slides: false, fills: 0 },
        ballad: { style: "ballad", bassPart: "pulse", busy: 2, loud: 1, deadNotes: false, slides: true, fills: 0 },
      },
    };
    const sections: Section[] = [
      { id: "funk", name: "Verse", start: 0, end: 16, mode: "continue" },
      { id: "ballad", name: "Chorus", start: 16, end: 64, mode: "continue" },
    ];
    const seconds = 64;
    const grid = steadyGrid(seconds);
    const chord = parseChordName("C");
    const harmony: ChordAtBeat[] = grid.beats.map((time, beat) => ({ beat, time, chord }));
    const result = runBandJob(
      request({ grid, harmony, settings, plans: planSections(sections, seconds, settings), lengthFrames: seconds * RATE, parts: { drums: false, bass: true } }),
      stubSamples(),
    );
    expect(result.notes.bass.some((note) => note.dead)).toBe(true);
    expect(result.notes.bass.some((note) => note.slideFrom !== undefined)).toBe(true);
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

describe("sectionPreviewBars", () => {
  const grid = fixedBeatGrid(120, 0, 4, 120);
  const section = (id: string, start: number, end: number): Section => ({ id, name: id, start, end, mode: "continue" });
  // A bar is 2 s at 120 BPM in 4/4.
  const sections = [section("intro", 0, 8), section("verse", 8, 24), section("chorus", 24, 100)];

  it("gives a whole section the bars to the next section's start", () => {
    expect(sectionPreviewBars(grid, sections, 0, "whole")).toBe(4);
    expect(sectionPreviewBars(grid, sections, 1, "whole")).toBe(8);
  });

  it("ends the last section at the song's end, and caps a whole section at 32 bars", () => {
    expect(sectionPreviewBars(grid, sections, 2, "whole", 40)).toBe(8);
    expect(sectionPreviewBars(grid, sections, 2, "whole")).toBe(32);
  });

  it("uses 4 and 8 bars as asked", () => {
    expect(sectionPreviewBars(grid, sections, 0, 4)).toBe(4);
    expect(sectionPreviewBars(grid, sections, 0, 8)).toBe(8);
  });
});

describe("runBandJob following the drummer", () => {
  const flat: BandSettings = { ...DEFAULT_BAND_SETTINGS, humanise: { amount: 0, feel: "style" } };
  const EARLY = 0.02;

  /** A drums stem with a kick burst EARLY seconds before each kick the settings generate. */
  function stemEarlyKicks(): PcmAudio {
    const kicks = runBandJob(request({ settings: { ...flat, followDrummer: false } }), stubSamples()).notes.drums.filter((note) => note.pitch === KICK);
    const out = new Float32Array(SONG_SECONDS * RATE);
    for (const kick of kicks) {
      const start = Math.round((kick.time - EARLY) * RATE);
      for (let i = 0; i < 0.2 * RATE && start + i < out.length; i++)
        out[start + i] += 0.8 * Math.cos((2 * Math.PI * 60 * i) / RATE) * Math.exp(-i / (0.05 * RATE));
    }
    return { sampleRate: RATE, channels: [out] };
  }

  const plain = (settings: BandSettings) => runBandJob(request({ settings }), stubSamples()).notes;

  it("moves the kicks and the bass locked to them onto the original drummer's hits", () => {
    const original = plain({ ...flat, followDrummer: false });
    const followed = runBandJob(request({ settings: flat, originals: { drums: stemEarlyKicks() } }), stubSamples()).notes;
    // The kick at 0 s has no early hit to move to (it would be before the start), so the checks begin after it.
    const kicks = (notes: typeof original) => notes.drums.filter((note) => note.pitch === KICK && note.time > 0.1);
    expect(kicks(followed)).toHaveLength(kicks(original).length);
    kicks(followed).forEach((kick, index) => expect(Math.abs(kick.time - (kicks(original)[index].time - EARLY))).toBeLessThan(0.0015));
    const locked = original.bass.findIndex((note) => note.time > 0.1 && kicks(original).some((kick) => Math.abs(kick.time - note.time) < 0.001));
    expect(locked).toBeGreaterThanOrEqual(0);
    expect(Math.abs(followed.bass[locked].time - (original.bass[locked].time - EARLY))).toBeLessThan(0.0015);
  });

  it("changes nothing without original drums, with a silent drums stem, or with the setting off", () => {
    const original = plain(flat);
    const silent: PcmAudio = { sampleRate: RATE, channels: [new Float32Array(SONG_SECONDS * RATE)] };
    expect(runBandJob(request({ settings: flat, originals: {} }), stubSamples()).notes).toEqual(original);
    expect(runBandJob(request({ settings: flat, originals: { drums: silent } }), stubSamples()).notes).toEqual(original);
    expect(runBandJob(request({ settings: { ...flat, followDrummer: false }, originals: { drums: stemEarlyKicks() } }), stubSamples()).notes).toEqual(original);
  });
});

describe("runBandJob with an ending that rings on", () => {
  const withEnding = (ending: BandSettings["ending"]) => request({ settings: { ...DEFAULT_BAND_SETTINGS, ending } });
  const length = (result: ReturnType<typeof runBandJob>) => result.drums?.channels[0].length ?? 0;
  // Four beats at 0.5 s make a bar of two seconds.
  const BAR = 2 * RATE;

  it("keeps the song's length for a hit", () => {
    const result = runBandJob(withEnding({ kind: "hit" }), stubSamples());
    expect(length(result)).toBe(SONG_SECONDS * RATE);
    expect(result.bass?.channels[0].length).toBe(SONG_SECONDS * RATE);
  });

  it("makes the parts longer than the song by at most two bars for a hold", () => {
    const result = runBandJob(withEnding({ kind: "hold" }), stubSamples());
    expect(length(result)).toBeGreaterThan(SONG_SECONDS * RATE);
    expect(length(result)).toBeLessThanOrEqual(SONG_SECONDS * RATE + 2 * BAR);
    expect(result.bass?.channels[0].length).toBe(length(result));
  });

  it("makes the parts longer by at most two bars for three hits", () => {
    const result = runBandJob(withEnding({ kind: "hits" }), stubSamples());
    expect(length(result)).toBeGreaterThan(SONG_SECONDS * RATE);
    expect(length(result)).toBeLessThanOrEqual(SONG_SECONDS * RATE + 2 * BAR);
  });
});
