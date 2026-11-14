import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections, type BandSettings } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { runBandJob, transferables, type BandRequest } from "./band-job";
import { parseChordName, type ChordAtBeat } from "./harmony";
import { CRASH, DRUM_PITCHES, SNARE, type NoteEvent } from "./note";
import type { BassSample, DrumLayer, SampleSet } from "./samples";
import { EXIT_TAIL, vampBars, withoutVamps } from "./vamp";
import type { Section, SectionMode } from "../performance/sections";
import type { PcmAudio } from "../types";

const RATE = 44100;
const SONG_SECONDS = 32;
/** Bars are two seconds long on this grid: four beats of half a second. */
const BAR = 2;

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

function steadyGrid(): BeatGrid {
  const beats: number[] = [];
  for (let time = 0; time < SONG_SECONDS; time += 0.5) beats.push(time);
  return { beatsPerBar: 4, beats, downbeat: 0, bpm: 120, steady: { bpm: 120, firstBeat: 0 } };
}

/** Verse (0 to 8 s), Solo (8 to 16 s, with `mode`), Chorus (16 to 32 s): four bars of solo, between a verse and a chorus. */
function sections(mode: SectionMode): Section[] {
  return [
    { id: "verse", name: "Verse", start: 0, end: 8, mode: "continue" },
    { id: "solo", name: "Solo", start: 8, end: 16, mode },
    { id: "chorus", name: "Chorus", start: 16, end: SONG_SECONDS, mode: "continue" },
  ];
}

function request(mode: SectionMode, overrides: Partial<BandSettings> = {}): BandRequest {
  const grid = steadyGrid();
  const chord = parseChordName("C");
  const harmony: ChordAtBeat[] = grid.beats.map((time, beat) => ({ beat, time, chord }));
  const settings: BandSettings = { ...DEFAULT_BAND_SETTINGS, ending: { kind: "none" }, complexity: 1, ...overrides };
  return {
    grid,
    harmony,
    keys: [],
    plans: planSections(sections(mode), SONG_SECONDS, settings),
    settings,
    seed: 3,
    lengthFrames: SONG_SECONDS * RATE,
    parts: { drums: true, bass: true },
    sampleUrls: {},
  };
}

const inBar = (notes: readonly NoteEvent[], bar: number): NoteEvent[] =>
  notes.filter((note) => note.time >= bar * BAR - 1e-9 && note.time < (bar + 1) * BAR - 1e-9);
const SOLO_FIRST_BAR = 4;
const SOLO_LAST_BAR = 7;
/** The pitches played, in order of pitch: humanising moves notes in time, so the order of the hits is not part of what a bar plays. */
const pitches = (notes: readonly NoteEvent[]): number[] => notes.map((note) => note.pitch).sort((a, b) => a - b);
/** Snare hits in the second half of a bar: a fill into the next section is a run of them, a groove has two at most. */
const snareRun = (notes: readonly NoteEvent[], bar: number): number =>
  inBar(notes, bar).filter((note) => note.pitch === SNARE && note.time >= bar * BAR + BAR / 2).length;

describe("planSections marks a vamp", () => {
  it("marks a section that loops or repeats once, on drum engine 3", () => {
    for (const mode of ["loop", "repeat-once"] as const) {
      const plans = planSections(sections(mode), SONG_SECONDS, DEFAULT_BAND_SETTINGS);
      expect(plans.map((plan) => plan.vamp === true)).toEqual([false, true, false]);
    }
  });

  it("marks nothing for other modes, and nothing for a song on an earlier engine, so its notes stay as they were", () => {
    expect(planSections(sections("continue"), SONG_SECONDS, DEFAULT_BAND_SETTINGS).some((plan) => "vamp" in plan)).toBe(false);
    expect(planSections(sections("loop"), SONG_SECONDS, { ...DEFAULT_BAND_SETTINGS, engine: 2 }).some((plan) => "vamp" in plan)).toBe(false);
  });
});

describe("a vamp's drums", () => {
  const vamped = runBandJob(request("loop"), stubSamples());
  const plain = runBandJob(request("continue"), stubSamples());

  it("play no fill on the last bar, which an ordinary section has", () => {
    expect(snareRun(plain.notes.drums, SOLO_LAST_BAR)).toBeGreaterThan(3);
    expect(snareRun(vamped.notes.drums, SOLO_LAST_BAR)).toBeLessThanOrEqual(2);
  });

  it("play no crash on the first bar, which an ordinary section has, and the bars before and after are as they were", () => {
    expect(pitches(inBar(plain.notes.drums, SOLO_FIRST_BAR)).includes(CRASH)).toBe(true);
    expect(pitches(inBar(vamped.notes.drums, SOLO_FIRST_BAR)).includes(CRASH)).toBe(false);
    // The bars around the vamp are as they were; bar 3 is compared up to the solo's downbeat, which is the vamp's first bar.
    for (const bar of [0, 1, 2]) expect(inBar(vamped.notes.drums, bar), `bar ${bar}`).toEqual(inBar(plain.notes.drums, bar));
    // Humanising draws its offsets in turn, so the bars after the vamp keep their hits but not their exact timing.
    for (const bar of [9, 10]) expect(pitches(inBar(vamped.notes.drums, bar)), `bar ${bar}`).toEqual(pitches(inBar(plain.notes.drums, bar)));
    const beforeSolo = (notes: readonly NoteEvent[]) => inBar(notes, 3).filter((note) => note.time < 7.9);
    expect(beforeSolo(vamped.notes.drums)).toEqual(beforeSolo(plain.notes.drums));
  });

  it("are the ordinary drums when the song is on an earlier engine", () => {
    const early = (mode: SectionMode) => runBandJob(request(mode, { engine: 2 }), stubSamples()).notes.drums;
    expect(early("loop")).toEqual(early("continue"));
  });
});

describe("a vamp's bass", () => {
  it("plays no lead-in into the next section on the last bar", () => {
    const vamped = runBandJob(request("loop"), stubSamples());
    const plain = runBandJob(request("continue"), stubSamples());
    // A vamp's last bar plays as a section with no bass fills would: no lead-in, no variation. The ordinary section's last bar walks to the chorus.
    const unfilled = runBandJob(request("continue", { sections: { solo: { fills: 0 } } }), stubSamples());
    expect(pitches(inBar(vamped.notes.bass, SOLO_LAST_BAR))).toEqual(pitches(inBar(unfilled.notes.bass, SOLO_LAST_BAR)));
    expect(pitches(inBar(plain.notes.bass, SOLO_LAST_BAR))).not.toEqual(pitches(inBar(unfilled.notes.bass, SOLO_LAST_BAR)));
    expect(inBar(vamped.notes.bass, 2)).toEqual(inBar(plain.notes.bass, 2));
  });
});

describe("a vamp's exit bar", () => {
  const result = runBandJob(request("loop"), stubSamples());
  const exit = result.exits?.solo;

  it("is rendered for each vamp, as long as the last bar and a short tail", () => {
    expect(Object.keys(result.exits ?? {})).toEqual(["solo"]);
    expect(exit?.from).toBe(SOLO_LAST_BAR * BAR);
    expect(exit?.to).toBe((SOLO_LAST_BAR + 1) * BAR);
    const frames = Math.round((BAR + EXIT_TAIL) * RATE);
    expect(exit?.drums?.channels[0]).toHaveLength(frames);
    expect(exit?.bass?.channels[1]).toHaveLength(frames);
    expect(Math.max(...exit!.drums!.channels[0])).toBeGreaterThan(0);
  });

  it("has the fill and lead-in that the vamp's own last bar lacks", () => {
    const plain = runBandJob(request("continue"), stubSamples());
    // The exit is cut from the song as if the vamp were an ordinary section, so it holds that section's last bar.
    expect(snareRun(plain.notes.drums, SOLO_LAST_BAR)).toBeGreaterThan(3);
    expect(snareRun(result.notes.drums, SOLO_LAST_BAR)).toBeLessThanOrEqual(2);
    // Over the same span the exit is not what the loop plays: it holds the fill.
    const loopBar = result.drums!.channels[0].slice(SOLO_LAST_BAR * BAR * RATE, (SOLO_LAST_BAR + 1) * BAR * RATE);
    const exitBar = exit!.drums!.channels[0].slice(0, loopBar.length);
    expect(exitBar.some((value, i) => value !== loopBar[i])).toBe(true);
  });

  it("is made only for the parts the request asks for, and not for songs without vamps", () => {
    expect(runBandJob({ ...request("loop"), parts: { drums: true, bass: false } }, stubSamples()).exits?.solo.bass).toBeUndefined();
    expect(runBandJob(request("continue"), stubSamples()).exits).toBeUndefined();
    expect(runBandJob(request("loop", { engine: 2 }), stubSamples()).exits).toBeUndefined();
  });

  it("is carried to the window with the other buffers", () => {
    const without = runBandJob(request("continue"), stubSamples());
    expect(transferables(result).length).toBe(transferables(without).length + 4);
  });
});

describe("a vamp's loop point", () => {
  it("carries the ring of the last bar into the start, so the loop has no cut", () => {
    const grid = steadyGrid();
    const plans = planSections(sections("loop"), SONG_SECONDS, DEFAULT_BAND_SETTINGS);
    const [bar] = vampBars(grid, plans);
    expect(bar).toMatchObject({ sectionId: "solo", start: 8, from: 14, to: 16 });
    const first = runBandJob(request("loop"), stubSamples());
    // The same song with the wrap tail's source silenced would start the solo quiet: the start holds the last bar's ring, so it is not silent
    // before the solo's own first hit lands (the render places hits on the grid, so frame 0 of the solo is the crash-free downbeat).
    const start = Math.round(8 * RATE);
    const early = first.drums!.channels[0].slice(start, start + Math.round(0.02 * RATE));
    expect(Math.max(...early.map(Math.abs))).toBeGreaterThan(0);
  });

  it("is not made for a vamp that is not on the grid, and withoutVamps removes the mark", () => {
    const plans = planSections(sections("loop"), SONG_SECONDS, DEFAULT_BAND_SETTINGS);
    expect(vampBars({ ...steadyGrid(), beats: [] }, plans)).toEqual([]);
    expect(withoutVamps(plans).some((plan) => "vamp" in plan)).toBe(false);
  });
});
