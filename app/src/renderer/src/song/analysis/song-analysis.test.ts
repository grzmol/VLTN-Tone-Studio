import { describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "../types";
import {
  ANALYSIS_VERSION,
  PLAYBACK_INTERRUPT,
  audioFingerprint,
  describeAnalysis,
  parseAnalysis,
  runSongAnalysis,
  songAudioId,
  type AnalysisStep,
  type SongAnalysis,
} from "./song-analysis";

const NO_HARMONY = { name: "mix", audio: { sampleRate: 44100, channels: [] } };

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

function memory(initial: SongAnalysis | null = null) {
  let saved = initial;
  return {
    read: vi.fn(() => saved),
    write: vi.fn((analysis: SongAnalysis) => {
      saved = analysis;
    }),
  };
}

const step = (name: string, result: Record<string, unknown> = {}) => ({ name, run: vi.fn(async () => result) }) as AnalysisStep;

describe("audioFingerprint", () => {
  const pcm = (length: number): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(length)] });

  it("is the same for the same stems in any order", () => {
    expect(audioFingerprint(44100, { drums: pcm(10), bass: pcm(20) })).toBe(audioFingerprint(44100, { bass: pcm(20), drums: pcm(10) }));
  });

  it("changes when the audio changes", () => {
    expect(audioFingerprint(44100, { drums: pcm(10) })).not.toBe(audioFingerprint(44100, { drums: pcm(11) }));
    expect(audioFingerprint(44100, { drums: pcm(10) })).not.toBe(audioFingerprint(48000, { drums: pcm(10) }));
  });
});

describe("songAudioId", () => {
  const pcm = (length: number): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(length)] });

  it("ignores the generated parts, so generating them keeps the saved analysis current", () => {
    const mix = pcm(100);
    const before = songAudioId(mix, { guitar: pcm(50) });
    const after = songAudioId(mix, { guitar: pcm(50), track1: pcm(100), track2: pcm(100) }, ["track1", "track2"]);
    expect(after).toBe(before);
  });

  it("still changes when an imported or split track is added", () => {
    const mix = pcm(100);
    expect(songAudioId(mix, { guitar: pcm(50), track1: pcm(100) })).not.toBe(songAudioId(mix, { guitar: pcm(50) }));
  });
});

describe("runSongAnalysis", () => {
  it("runs the steps in order and saves what they found", async () => {
    const order: string[] = [];
    const a = { name: "a", run: vi.fn(async () => (order.push("a"), { tempo: { bpm: 98, firstBeat: 0.2, steady: true } })) };
    const b = { name: "b", run: vi.fn(async () => (order.push("b"), {})) };
    const settings = memory();
    const outcome = await runSongAnalysis({ audioId: "x", audio, steps: [a, b], settings });
    expect(order).toEqual(["a", "b"]);
    expect(outcome).toEqual({ status: "complete", analysis: { audioId: "x", version: ANALYSIS_VERSION, tempo: { bpm: 98, firstBeat: 0.2, steady: true } } });
    expect(settings.write).toHaveBeenCalledWith(outcome.status === "complete" ? outcome.analysis : null);
  });

  it("passes each step what the earlier steps found", async () => {
    const seen: unknown[] = [];
    const first = { name: "first", run: async () => ({ tempo: { bpm: 98, firstBeat: 0, steady: true } }) };
    const second = { name: "second", run: async (_a: unknown, _s: unknown, soFar: SongAnalysis) => (seen.push(soFar.tempo), {}) };
    await runSongAnalysis({ audioId: "x", audio, steps: [first, second], settings: memory() });
    expect(seen).toEqual([{ bpm: 98, firstBeat: 0, steady: true }]);
  });

  it("records a failed step and still runs the rest", async () => {
    const failing = { name: "tempo", run: vi.fn(async () => { throw new Error("no"); }) };
    const after = step("chords", { chords: [] });
    const settings = memory();
    const outcome = await runSongAnalysis({ audioId: "x", audio, steps: [failing, after], settings });
    expect(after.run).toHaveBeenCalled();
    expect(outcome.status === "complete" && outcome.analysis.failed).toEqual(["tempo"]);
  });

  it("does not run again when the saved analysis matches the audio and version", async () => {
    const saved = { audioId: "x", version: ANALYSIS_VERSION, tempo: { bpm: 98, firstBeat: 0, steady: true } };
    const s = step("tempo");
    const outcome = await runSongAnalysis({ audioId: "x", audio, steps: [s], settings: memory(saved) });
    expect(s.run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "complete", analysis: saved });
  });

  it("runs again for a different audio, an older version, or when forced", async () => {
    const saved = { audioId: "x", version: ANALYSIS_VERSION };
    const s = step("tempo");
    await runSongAnalysis({ audioId: "y", audio, steps: [s], settings: memory(saved) });
    await runSongAnalysis({ audioId: "x", audio, steps: [s], settings: memory({ ...saved, version: ANALYSIS_VERSION - 1 }) });
    await runSongAnalysis({ audioId: "x", audio, steps: [s], settings: memory(saved), force: true });
    expect(s.run).toHaveBeenCalledTimes(3);
  });

  it("stops on playback and reports the step to resume from, with what was found so far", async () => {
    const controller = new AbortController();
    const first = step("tempo", { tempo: { bpm: 98, firstBeat: 0, steady: true } });
    const interrupted = {
      name: "chords",
      run: vi.fn(async () => {
        controller.abort(PLAYBACK_INTERRUPT);
        throw new Error("stopped");
      }),
    };
    const after = step("key");
    const settings = memory();
    const outcome = await runSongAnalysis({ audioId: "x", audio, steps: [first, interrupted, after], settings, signal: controller.signal });
    expect(outcome).toEqual({ status: "interrupted", next: 1, analysis: { audioId: "x", version: ANALYSIS_VERSION, tempo: { bpm: 98, firstBeat: 0, steady: true } } });
    expect(after.run).not.toHaveBeenCalled();
    expect(settings.write).not.toHaveBeenCalled();
  });

  it("does not save a run that playback interrupted during its last step", async () => {
    const controller = new AbortController();
    const last = {
      name: "sections",
      run: vi.fn(async () => {
        controller.abort(PLAYBACK_INTERRUPT);
        return { tempo: { bpm: 98, firstBeat: 0, steady: true } };
      }),
    };
    const settings = memory();
    const outcome = await runSongAnalysis({ audioId: "x", audio, steps: [last], settings, signal: controller.signal });
    expect(outcome.status).toBe("interrupted");
    expect(settings.write).not.toHaveBeenCalled();
  });

  it("resumes an interrupted run from its step with the partial result", async () => {
    const partial = { audioId: "x", version: ANALYSIS_VERSION, tempo: { bpm: 98, firstBeat: 0, steady: true } };
    const first = step("tempo");
    const rest = step("key", { key: "E minor" });
    const settings = memory();
    const outcome = await runSongAnalysis({ audioId: "x", audio, steps: [first, rest], settings, from: 1, partial });
    expect(first.run).not.toHaveBeenCalled();
    expect(outcome.status === "complete" && outcome.analysis).toEqual({ ...partial, key: "E minor" });
  });

  it("is cancelled without saving when aborted for any other reason", async () => {
    const controller = new AbortController();
    controller.abort("song changed");
    const s = step("tempo");
    const settings = memory();
    const outcome = await runSongAnalysis({ audioId: "x", audio, steps: [s], settings, signal: controller.signal });
    expect(outcome).toEqual({ status: "cancelled", analysis: null });
    expect(s.run).not.toHaveBeenCalled();
    expect(settings.write).not.toHaveBeenCalled();
  });

  it("reports each step before it starts", async () => {
    const onStep = vi.fn();
    await runSongAnalysis({ audioId: "x", audio, steps: [step("a"), step("b")], settings: memory(), onStep });
    expect(onStep.mock.calls).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });
});

describe("parseAnalysis", () => {
  it("keeps a valid analysis", () => {
    const value = { audioId: "x", version: 1, tempo: { bpm: 98, firstBeat: 0.2, steady: true }, failed: ["chords"] };
    expect(parseAnalysis(value)).toEqual(value);
  });

  it("keeps a meter with its confidence", () => {
    const value = { audioId: "x", version: 1, meter: { beatsPerBar: 3, confidence: 0.8 } };
    expect(parseAnalysis(value)).toEqual(value);
    expect(parseAnalysis({ audioId: "x", version: 1, meter: { beatsPerBar: 5, confidence: 0.8 } })).toEqual({ audioId: "x", version: 1 });
  });

  it("keeps the drums and bass check", () => {
    const value = { audioId: "x", version: 1, parts: { drums: "absent", bass: "present", absentSections: { drums: [], bass: [] } } };
    expect(parseAnalysis(value)).toEqual(value);
    expect(parseAnalysis({ audioId: "x", version: 1, parts: { drums: "absent" } })).toEqual({ audioId: "x", version: 1 });
  });

  it("keeps the bass line, and drops a bass line with a bad beat", () => {
    const value = { audioId: "x", version: 1, bassLine: { tuningCents: -12, beats: [{ beat: 0, pc: 9, confidence: 0.9 }, { beat: 1, pc: null, confidence: 0 }] } };
    expect(parseAnalysis(value)).toEqual(value);
    expect(parseAnalysis({ ...value, bassLine: { tuningCents: -12, beats: [{ beat: 0, pc: 12, confidence: 0.9 }] } })).toEqual({ audioId: "x", version: 1 });
    expect(parseAnalysis({ ...value, bassLine: [{ beat: 0, pc: 9, confidence: 0.9 }] })).toEqual({ audioId: "x", version: 1 });
  });

  it("keeps the silence at the ends", () => {
    const value = { audioId: "x", version: 1, silence: { start: 0.8, end: 6.8 } };
    expect(parseAnalysis(value)).toEqual(value);
  });

  it("keeps a loudness level", () => {
    const value = { audioId: "x", version: 1, loudness: { lufs: -9.8, peakDb: -0.4 } };
    expect(parseAnalysis(value)).toEqual(value);
  });

  it("drops a damaged tempo but keeps the record", () => {
    expect(parseAnalysis({ audioId: "x", version: 1, tempo: { bpm: "98" } })).toEqual({ audioId: "x", version: 1 });
  });

  it("rejects anything that is not an analysis", () => {
    expect(parseAnalysis(null)).toBeNull();
    expect(parseAnalysis([])).toBeNull();
    expect(parseAnalysis({ audioId: 3, version: 1 })).toBeNull();
  });
});

describe("describeAnalysis", () => {
  it("says what was found and what failed", () => {
    expect(describeAnalysis({ audioId: "x", version: 1, tempo: { bpm: 98, firstBeat: 0, steady: true } })).toBe("Tempo 98 BPM");
    expect(describeAnalysis({ audioId: "x", version: 1, failed: ["tempo"] })).toBe("No steady tempo found. Could not work out: tempo");
    expect(describeAnalysis({ audioId: "x", version: 1, tempo: { bpm: 101, firstBeat: 0, steady: false } })).toBe("Tempo 101 BPM (the tempo varies)");
    expect(describeAnalysis({ audioId: "x", version: 1, tempo: { bpm: 98, firstBeat: 0, steady: true }, meter: { beatsPerBar: 3, confidence: 0.9 } })).toBe(
      "Tempo 98 BPM. Meter 3/4",
    );
    expect(describeAnalysis({ audioId: "x", version: 1, meter: { beatsPerBar: 4, confidence: 0.2 } })).toBe("No steady tempo found. Meter 4/4 (not certain)");
    expect(describeAnalysis({ audioId: "x", version: 1, parts: { drums: "absent", bass: "present", absentSections: { drums: [], bass: [] } } })).toBe(
      "No steady tempo found. Missing drums",
    );
    expect(describeAnalysis({ audioId: "x", version: 1, loudness: { lufs: -9.84, peakDb: -1 }, failed: ["key"] })).toBe(
      "No steady tempo found. Loudness -9.8 LUFS. Could not work out: key",
    );
  });
});

describe("sections in the saved analysis", () => {
  const base = { audioId: "a", version: ANALYSIS_VERSION };
  it("keeps valid sections and drops a list with a damaged entry", () => {
    const sections = [{ name: "Verse 1", start: 0, end: 16 }];
    expect(parseAnalysis({ ...base, sections })?.sections).toEqual(sections);
    expect(parseAnalysis({ ...base, sections: [{ name: "Verse 1", start: 0 }] })?.sections).toBeUndefined();
  });

  it("says how many sections were found", () => {
    expect(describeAnalysis({ ...base, sections: [{ name: "Intro", start: 0, end: 8 }, { name: "Verse 1", start: 8, end: 24 }] })).toContain(". 2 sections");
  });
});

describe("section keys in the saved analysis", () => {
  const base = { audioId: "a", version: ANALYSIS_VERSION };
  const estimate = { name: "A major", tonic: 9, mode: "major" as const, correlation: 0.8, margin: 0.2, confidence: "strong" as const, alternatives: [] };

  it("keeps valid section keys and drops a list with a damaged entry", () => {
    const keySections = [{ sectionId: "1", key: estimate }];
    expect(parseAnalysis({ ...base, keySections })?.keySections).toEqual(keySections);
    expect(parseAnalysis({ ...base, keySections: [{ sectionId: 1, key: estimate }] })?.keySections).toBeUndefined();
  });

  it("says how many section keys there are, and only when there are some", () => {
    expect(describeAnalysis({ ...base, keySections: [{ sectionId: "1", key: estimate }] })).toContain(". 1 section key");
    expect(describeAnalysis({ ...base, keySections: [] })).not.toContain("section key");
  });
});
