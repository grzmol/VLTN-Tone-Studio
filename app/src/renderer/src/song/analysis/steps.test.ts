import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "../band/beat-grid";
import type { SongAnalysis } from "./song-analysis";

const loudness = vi.hoisted(() => ({ measure: vi.fn() }));
vi.mock("../audio/loudness-client", () => ({ measureLoudnessInWorker: loudness.measure }));

const job = vi.hoisted(() => ({
  done: null as Promise<BeatGrid> | null,
  meter: Promise.resolve(null) as Promise<{ beatsPerBar: 3 | 4; confidence: number } | null>,
  cancel: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../band/beat-grid-client", () => ({
  startBeatGrid: (request: unknown) => {
    job.start(request);
    return { done: job.done, meter: job.meter, cancel: job.cancel };
  },
}));

import { bassLineStep, chordsStep, keyStep, loudnessStep, partsStep, sectionKeysStep, sectionsStep, tempoStep } from "./steps";

const NO_HARMONY = { name: "mix", audio: { sampleRate: 44100, channels: [] } };

const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.6);
const grid: BeatGrid = { beatsPerBar: 4, beats, downbeat: 0, bpm: 100, steady: { bpm: 100, firstBeat: 0.5 } };
const nothingFound = { audioId: "", version: 0 };
const audio = {
  mix: { sampleRate: 44100, channels: [] },
  stems: null,
  sources: [],
  sampleRate: 44100,
  beatsPerBar: 4,
  chordChanges: [],
  sections: [],
  harmony: NO_HARMONY, bass: null, chordSource: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("tempoStep", () => {
  it("returns the tempo of the tracked grid and passes the grid on", async () => {
    job.done = Promise.resolve(grid);
    const onGrid = vi.fn();
    const result = await tempoStep(onGrid).run(audio, new AbortController().signal, nothingFound);
    expect(result).toEqual({ tempo: { bpm: 100, firstBeat: 0.5, steady: true } });
    expect(onGrid).toHaveBeenCalledWith(grid);
    expect(job.start).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100, beatsPerBar: 4 }));
  });

  it("passes a typed tempo and its lock on to the tracker", async () => {
    job.done = Promise.resolve(grid);
    await tempoStep(undefined, { tempoHint: 98, lockTempo: true }).run(audio, new AbortController().signal, nothingFound);
    expect(job.start).toHaveBeenCalledWith(expect.objectContaining({ tempoHint: 98, lockTempo: true }));
  });

  it("returns the meter the beats fall into with the tempo", async () => {
    job.done = Promise.resolve(grid);
    job.meter = Promise.resolve({ beatsPerBar: 3, confidence: 0.9 });
    const result = await tempoStep().run(audio, new AbortController().signal, nothingFound);
    expect(result).toMatchObject({ tempo: { bpm: 100 }, meter: { beatsPerBar: 3, confidence: 0.9 } });
    job.meter = Promise.resolve(null);
  });

  it("returns nothing, and passes no grid on, when the grid is too short", async () => {
    job.done = Promise.resolve({ ...grid, beats: beats.slice(0, 3) });
    const onGrid = vi.fn();
    expect(await tempoStep(onGrid).run(audio, new AbortController().signal, nothingFound)).toEqual({});
    expect(onGrid).not.toHaveBeenCalled();
  });

  it("cancels the beat tracker when the run is aborted", async () => {
    job.done = new Promise<BeatGrid>((_, reject) => {
      queueMicrotask(() => reject(new Error("cancelled")));
    });
    const controller = new AbortController();
    const pending = tempoStep().run(audio, controller.signal, nothingFound);
    controller.abort("playback");
    await expect(pending).rejects.toThrow();
    expect(job.cancel).toHaveBeenCalled();
  });
});

describe("keyStep and chordsStep", () => {
  const stem = { sampleRate: 44100, channels: [new Float32Array(4)] };
  const sounding = { sampleRate: 44100, channels: [new Float32Array(44100).fill(0.1)] };
  const estimate = { name: "E minor", tonic: 4, mode: "minor", correlation: 0.8, margin: 0.2, confidence: "strong", alternatives: [] };
  let reply: unknown = null;
  class ReplyingWorker {
    static posted: unknown = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: unknown) {
      ReplyingWorker.posted = message;
      queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent));
    }
    terminate() {}
  }
  beforeEach(() => vi.stubGlobal("Worker", ReplyingWorker));
  afterEach(() => vi.unstubAllGlobals());

  it("reads the key from the harmony and the bass, with the chords found before it", async () => {
    reply = { estimate };
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100).fill(0.1)] };
    const chords = [{ time: 0, name: "Em", confidence: 0.9 }];
    const found = { audioId: "", version: 0, chords: { source: "other", chords } } as unknown as SongAnalysis;
    const result = await keyStep().run({ ...audio, harmony: { name: "other", audio: sounding }, bass }, new AbortController().signal, found);
    expect(result).toEqual({ key: { source: "other", estimate } });
    expect(ReplyingWorker.posted).toEqual({ harmony: sounding, bass, chords, sections: [] });
  });

  it("reads nothing when the harmony has no signal", async () => {
    expect(await keyStep().run({ ...audio, harmony: NO_HARMONY }, new AbortController().signal, nothingFound)).toEqual({});
  });

  it("saves nothing when the worker finds no clear key", async () => {
    reply = { estimate: null };
    expect(await keyStep().run({ ...audio, harmony: { name: "other", audio: sounding } }, new AbortController().signal, nothingFound)).toEqual({});
  });

  it("reads the chords from the harmony and records its name", async () => {
    reply = { chords: [{ time: 0, name: "Em", confidence: 0.9 }] };
    const bass = { sampleRate: 44100, channels: [new Float32Array(4)] };
    const result = await chordsStep().run({ ...audio, harmony: { name: "other+piano", audio: stem }, bass }, new AbortController().signal, nothingFound);
    expect(result).toEqual({ chords: { source: "other+piano", chords: [{ time: 0, name: "Em", confidence: 0.9 }] } });
  });

  it("gives the chords the beats of the grid, so they change on the beats", async () => {
    reply = { chords: [] };
    await chordsStep(() => grid).run({ ...audio, harmony: { name: "other", audio: stem }, bass: null }, new AbortController().signal, nothingFound);
    expect(ReplyingWorker.posted).toEqual({ harmony: stem, bass: null, beats: grid.beats, key: null });
  });

  it("re-picks the downbeat from the chord changes and hands the grid on", async () => {
    // The grid's downbeat is beat 1; the chords change on beat 0 of each bar, so the downbeat moves to 0.
    const beats = [0.2, 1.2, 2.2, 3.2, 4.2, 5.2, 6.2, 7.2];
    const tracked = { beatsPerBar: 4, beats, downbeat: 1, bpm: 60, steady: null };
    reply = { chords: [{ time: 0, name: "F#m", confidence: 0.9 }, { time: 4.2, name: "E", confidence: 0.9 }, { time: 0.0 + 8.2, name: "C#m", confidence: 0.9 }] };
    const onGrid = vi.fn();
    await chordsStep(() => tracked, onGrid).run({ ...audio, harmony: { name: "other", audio: stem }, bass: null }, new AbortController().signal, nothingFound);
    expect(onGrid).toHaveBeenCalledWith({ ...tracked, downbeat: 0 });
  });

  it("does not hand the grid on when the chords leave the downbeat where it is", async () => {
    reply = { chords: [{ time: 0, name: "F#m", confidence: 0.9 }] };
    const onGrid = vi.fn();
    await chordsStep(() => grid, onGrid).run({ ...audio, harmony: { name: "other", audio: stem }, bass: null }, new AbortController().signal, nothingFound);
    expect(onGrid).not.toHaveBeenCalled();
  });

  it("gives the chords the key the analysis found, to set the key prior", async () => {
    reply = { chords: [] };
    const found = { audioId: "", version: 0, key: { source: "other", estimate } } as unknown as SongAnalysis;
    await chordsStep().run({ ...audio, harmony: { name: "other", audio: stem }, bass: null }, new AbortController().signal, found);
    expect(ReplyingWorker.posted).toEqual({ harmony: stem, bass: null, beats: null, key: "E minor" });
  });

  it("reads the section keys with the song's key and sections, and nothing without them", async () => {
    const keySections = [{ sectionId: "1", key: { ...estimate, name: "A major" } }];
    reply = { estimate: null, keySections };
    const sectioned = { ...audio, harmony: { name: "other", audio: sounding }, bass: null };
    const found = { audioId: "", version: 0, key: { source: "other", estimate }, sections: [{ name: "Last", start: 8, end: 16 }] } as unknown as SongAnalysis;
    expect(await sectionKeysStep().run(sectioned, new AbortController().signal, found)).toEqual({ keySections });
    expect(ReplyingWorker.posted).toMatchObject({ songKey: "E minor", sections: [{ start: 8, end: 16 }] });
    expect(await sectionKeysStep().run(sectioned, new AbortController().signal, nothingFound)).toEqual({});
  });

  it("fails when the worker reports an error", async () => {
    reply = { error: "boom" };
    const failing = { ...audio, harmony: { name: "other", audio: stem }, bass: null };
    await expect(chordsStep().run(failing, new AbortController().signal, nothingFound)).rejects.toThrow("boom");
  });
});

describe("loudnessStep", () => {
  it("measures the mix and records its level", async () => {
    loudness.measure.mockResolvedValueOnce({ lufs: -9.8, peakDb: -0.4 });
    expect(await loudnessStep().run(audio, new AbortController().signal, nothingFound)).toEqual({ loudness: { lufs: -9.8, peakDb: -0.4 } });
    expect(loudness.measure).toHaveBeenCalledWith(audio.mix);
  });

  it("records nothing for a silent song", async () => {
    loudness.measure.mockResolvedValueOnce({ lufs: -Infinity, peakDb: -Infinity });
    expect(await loudnessStep().run(audio, new AbortController().signal, nothingFound)).toEqual({});
  });
});

describe("partsStep", () => {
  it("records nothing for a song that was not split", async () => {
    expect(await partsStep().run(audio, new AbortController().signal, nothingFound)).toEqual({});
  });

  it("checks the drums and bass against the mix", async () => {
    const pcm = { sampleRate: 44100, channels: [new Float32Array(44100)] };
    const result = await partsStep().run({ ...audio, mix: pcm, stems: { drums: pcm, bass: pcm } }, new AbortController().signal, nothingFound);
    expect(result.parts).toMatchObject({ drums: expect.any(String), bass: expect.any(String), absentSections: { drums: [], bass: [] } });
  });
});

describe("tempoStep chord changes", () => {
  it("uses the chart's chord changes only, since the chords are read after the tempo", async () => {
    job.done = Promise.resolve(grid);
    job.start.mockClear();
    await tempoStep().run({ ...audio, chordChanges: [] }, new AbortController().signal, nothingFound);
    expect(job.start).toHaveBeenLastCalledWith(expect.objectContaining({ chordChanges: [] }));
  });

  it("keeps the chart's chord changes when it has them", async () => {
    job.done = Promise.resolve(grid);
    job.start.mockClear();
    await tempoStep().run({ ...audio, chordChanges: [5] }, new AbortController().signal, nothingFound);
    expect(job.start).toHaveBeenLastCalledWith(expect.objectContaining({ chordChanges: [5] }));
  });
});

describe("sectionsStep", () => {
  const stem = { sampleRate: 44100, channels: [new Float32Array(4)] };
  const found = [{ start: 0, end: 16, name: "Verse 1" }];
  let posted: unknown[] = [];
  class RecordingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(input: unknown) {
      posted.push(input);
      queueMicrotask(() => this.onmessage?.({ data: { sections: found } } as MessageEvent));
    }
    terminate() {}
  }
  beforeEach(() => {
    posted = [];
    vi.stubGlobal("Worker", RecordingWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the sections from the worker", async () => {
    const result = await sectionsStep(() => null).run({ ...audio, mix: stem }, new AbortController().signal, nothingFound);
    expect(result).toEqual({ sections: found });
  });

  it("lays the units on the bar lines of the grid, with the chord stem as the harmony", async () => {
    const chords = { sampleRate: 44100, channels: [new Float32Array(44100 * 8)] };
    const withChords = {
      ...audio,
      mix: { sampleRate: 44100, channels: [new Float32Array(44100 * 8)] },
      harmony: NO_HARMONY, bass: null, chordSource: { name: "other", audio: chords },
    };
    await sectionsStep(() => grid).run(withChords, new AbortController().signal, nothingFound);
    const input = posted[0] as { harmony: unknown; spans: { start: number }[]; options: { snap: number } };
    expect(input.harmony).toBe(chords);
    expect(input.spans[0].start).toBe(0);
    expect(input.options.snap).toBe(4);
  });

  it("falls back to two-second frames when there is no grid", async () => {
    await sectionsStep(() => null).run({ ...audio, mix: { sampleRate: 44100, channels: [new Float32Array(44100 * 8)] } }, new AbortController().signal, nothingFound);
    const input = posted[0] as { spans: { start: number }[]; options: { snap: number } };
    expect(input.spans.map((span) => span.start)).toEqual([0, 2, 4, 6]);
    expect(input.options.snap).toBe(1);
  });
});

describe("bassLineStep", () => {
  const bass = { sampleRate: 44100, channels: [new Float32Array(44100).fill(0.1)] };
  const line = { tuningCents: -12, beats: [{ beat: 0, pc: 9, confidence: 1 }] };
  class LineWorker {
    static posted: unknown = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: unknown) {
      LineWorker.posted = message;
      queueMicrotask(() => this.onmessage?.({ data: { bassLine: line } } as MessageEvent));
    }
    terminate() {}
  }
  beforeEach(() => vi.stubGlobal("Worker", LineWorker));
  afterEach(() => vi.unstubAllGlobals());

  it("reads the bass note of each beat of the grid from the bass stem", async () => {
    const result = await bassLineStep(() => grid).run({ ...audio, bass }, new AbortController().signal, nothingFound);
    expect(result).toEqual({ bassLine: line });
    expect(LineWorker.posted).toEqual({ bass, beats: grid.beats });
  });

  it("reads nothing without a bass stem or a grid", async () => {
    expect(await bassLineStep(() => grid).run({ ...audio, bass: null }, new AbortController().signal, nothingFound)).toEqual({});
    expect(await bassLineStep(() => null).run({ ...audio, bass }, new AbortController().signal, nothingFound)).toEqual({});
  });
});
