import { describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "../band/beat-grid";
import type { PcmAudio, Stems } from "../types";
import { ANALYSIS_VERSION, songAudioId, type AnalysisStep, type SongAnalysis } from "./song-analysis";
import {
  BATCH_STEPS,
  DEFAULT_LYRICS_BATCH,
  defaultChoice,
  describeBatch,
  describeLyricsOutcome,
  describeLyricsPlan,
  lyricsAction,
  lyricsPlan,
  lyricsStepText,
  lyricsSkip,
  needsAnalysis,
  runAnalysisBatch,
  selectSongs,
  stepsFor,
  type LyricsBatchOptions,
  type BatchDeps,
  type BatchOptions,
  type BatchSong,
} from "./batch";
import { planWriteBack } from "./apply";

const tone = (level = 0.5): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4410).fill(level)] });
const grid: BeatGrid = { beatsPerBar: 4, beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], downbeat: 0, bpm: 120, steady: null };
const song = (id: string, over: Record<string, string> = {}, options: Record<string, unknown> = {}): BatchSong => ({
  id,
  title: `Song ${id}`,
  settings: { ":bpm": "120", ":options": JSON.stringify(options), ...over },
});
const analysed = (over: Partial<SongAnalysis> = {}): Record<string, unknown> => ({ analysis: { audioId: "x", version: ANALYSIS_VERSION, ...over } });
const batchOptions = (over: Partial<BatchOptions> = {}): BatchOptions => ({
  onlyNeeded: false,
  replaceManual: false,
  choice: defaultChoice(),
  openSongId: null,
  ...over,
});

describe("needsAnalysis", () => {
  it("needs a song with no saved analysis, or an older one", () => {
    expect(needsAnalysis(song("a", { ":bpm": "95" }))).toBe(true);
    expect(needsAnalysis(song("b", { ":bpm": "95" }, { analysis: { audioId: "x", version: ANALYSIS_VERSION - 1 } }))).toBe(true);
  });

  it("needs a song whose tempo was never chosen, even with a current analysis", () => {
    expect(needsAnalysis(song("c", { ":bpm": "120" }, analysed()))).toBe(true);
  });

  it("leaves a current analysis of a song with a chosen tempo alone", () => {
    expect(needsAnalysis(song("d", { ":bpm": "95" }, { ...analysed(), tempoSource: "manual" }))).toBe(false);
  });
});

describe("selectSongs", () => {
  it("skips the open song and keeps the order", () => {
    const songs = [song("a"), song("b"), song("c")];
    const { run, openSkipped } = selectSongs(songs, batchOptions({ openSongId: "b" }));
    expect(run.map((s) => s.id)).toEqual(["a", "c"]);
    expect(openSkipped.map((s) => s.id)).toEqual(["b"]);
  });

  it("leaves out songs whose analysis is current when only the ones that need it are wanted", () => {
    const current = song("a", { ":bpm": "95" }, { ...analysed(), tempoSource: "manual" });
    const { run } = selectSongs([current, song("b")], batchOptions({ onlyNeeded: true }));
    expect(run.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("stepsFor", () => {
  it("drops tempo and meter for a manual tempo unless the performer asked to replace it", () => {
    const manual = song("g", { ":bpm": "95" }, { tempoSource: "manual" });
    expect(stepsFor(manual, batchOptions())).not.toContain("tempo");
    expect(stepsFor(manual, batchOptions({ replaceManual: true }))).toContain("tempo");
  });

  it("runs only the steps that are ticked", () => {
    const choice = { ...defaultChoice(), key: false, silence: false };
    expect(stepsFor(song("h"), batchOptions({ choice }))).toEqual(BATCH_STEPS.map((s) => s.id).filter((id) => id !== "key" && id !== "silence" && id !== "lyrics"));
  });
});

describe("describeBatch", () => {
  it("names the songs analysed, the tempos changed, the songs with no beat and the open song", () => {
    const text = describeBatch([
      { id: "a", title: "Alpha", status: "analysed", tempoChange: { from: 120, to: 98 }, noBeat: false, lyrics: null },
      { id: "b", title: "Bravo", status: "analysed", tempoChange: null, noBeat: true, lyrics: null },
      { id: "c", title: "Charlie", status: "skipped", reason: "open" },
    ]);
    expect(text).toBe("Analysed 2 songs. Tempo changed on 1 (Alpha: 120 → 98). 1 had no clear beat. 1 skipped (open).");
  });
});

// The runner: the library, playback and the steps are fakes, so the loop is tested as it runs in the app.
function fakeDeps(over: Partial<BatchDeps> = {}) {
  let playing = false;
  const listeners = new Set<(playing: boolean) => void>();
  const writes: { id: string; values: Record<string, string> }[] = [];
  const loads: string[] = [];
  const deps: BatchDeps = {
    load: vi.fn(async (id: string) => {
      loads.push(id);
      return { source: tone(), stems: {} as Stems };
    }),
    isOpen: () => false,
    playing: () => playing,
    onPlayingChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    steps: (_ids, onGrid): AnalysisStep[] => [
      {
        name: "tempo",
        run: async () => {
          onGrid(grid);
          return { tempo: { bpm: 98, firstBeat: 0.4, steady: true }, meter: { beatsPerBar: 4, confidence: 0.9 } };
        },
      },
    ],
    write: (id, values) => writes.push({ id, values }),
    ...over,
  };
  const setPlaying = (value: boolean) => {
    playing = value;
    for (const listener of listeners) listener(value);
  };
  return { deps, writes, loads, setPlaying };
}

describe("runAnalysisBatch", () => {
  it("analyses each song in turn and writes its result to the saved song", async () => {
    const { deps, writes, loads } = fakeDeps();
    const outcomes = await runAnalysisBatch([song("a"), song("b")], batchOptions(), deps, new AbortController().signal);
    expect(loads).toEqual(["a", "b"]);
    expect(writes.map((w) => w.id)).toEqual(["a", "b"]);
    expect(writes[0].values[":bpm"]).toBe("98");
    expect(outcomes.map((o) => o.status)).toEqual(["analysed", "analysed"]);
  });

  it("skips the open song without loading it, and never writes it", async () => {
    const { deps, writes, loads } = fakeDeps({ isOpen: (id) => id === "a" });
    const outcomes = await runAnalysisBatch([song("a"), song("b")], batchOptions(), deps, new AbortController().signal);
    expect(loads).toEqual(["b"]);
    expect(writes.map((w) => w.id)).toEqual(["b"]);
    expect(outcomes[0]).toEqual({ id: "a", title: "Song a", status: "skipped", reason: "open" });
  });

  it("waits while playing and resumes once playback stops, without loading the next song early", async () => {
    const { deps, writes, setPlaying } = fakeDeps();
    setPlaying(true);
    const done = runAnalysisBatch([song("a")], batchOptions(), deps, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deps.load).not.toHaveBeenCalled();
    setPlaying(false);
    await done;
    expect(writes.map((w) => w.id)).toEqual(["a"]);
  });

  it("stops on cancel: the current song is left as it was, and the songs not reached are not loaded", async () => {
    const controller = new AbortController();
    const { deps, writes, loads } = fakeDeps({
      steps: (): AnalysisStep[] => [
        {
          name: "tempo",
          run: async () => {
            controller.abort("cancel");
            return { tempo: { bpm: 98, firstBeat: 0.4, steady: true } };
          },
        },
      ],
    });
    const outcomes = await runAnalysisBatch([song("a"), song("b")], batchOptions(), deps, controller.signal);
    expect(loads).toEqual(["a"]);
    expect(writes).toEqual([]);
    expect(outcomes).toEqual([]);
  });

  it("pauses between steps when playback starts, then resumes from the step it stopped at", async () => {
    const ran: string[] = [];
    const { deps, writes, setPlaying } = fakeDeps({
      steps: (): AnalysisStep[] => [
        {
          name: "loudness",
          run: async () => {
            ran.push("loudness");
            setPlaying(true);
            return { loudness: { lufs: -14, peakDb: -1 } };
          },
        },
        {
          name: "silence",
          run: async () => {
            ran.push("silence");
            return {};
          },
        },
      ],
    });
    const done = runAnalysisBatch([song("a")], batchOptions(), deps, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ran).toEqual(["loudness"]);
    setPlaying(false);
    await done;
    expect(ran).toEqual(["loudness", "silence"]);
    expect(writes.map((w) => w.id)).toEqual(["a"]);
  });

  it("reports progress with the song and the step it is on", async () => {
    const { deps } = fakeDeps();
    const progress = vi.fn();
    await runAnalysisBatch([song("a")], batchOptions(), deps, new AbortController().signal, { onProgress: progress });
    expect(progress).toHaveBeenNthCalledWith(1, expect.objectContaining({ index: 0, total: 1, title: "Song a", step: null, stepIndex: 0 }));
    expect(progress).toHaveBeenNthCalledWith(2, { index: 0, total: 1, title: "Song a", step: "tempo", stepIndex: 0, steps: 1 });
  });

  it("tells the caller when it waits for playback and when it goes on", async () => {
    const { deps, setPlaying } = fakeDeps();
    const waiting = vi.fn();
    setPlaying(true);
    const done = runAnalysisBatch([song("a")], batchOptions(), deps, new AbortController().signal, { onWaiting: waiting });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(waiting.mock.calls).toEqual([[true]]);
    setPlaying(false);
    await done;
    expect(waiting.mock.calls).toEqual([[true], [false]]);
  });

  it("tells the caller each song as it starts loading and as it finishes, in order", async () => {
    const { deps } = fakeDeps();
    const events: string[] = [];
    await runAnalysisBatch([song("a"), song("b")], batchOptions(), deps, new AbortController().signal, {
      onLoading: (title) => events.push(`loading ${title}`),
      onSongDone: (outcome) => events.push(`done ${outcome.id}`),
    });
    expect(events).toEqual(["loading Song a", "done a", "loading Song b", "done b"]);
  });
});

describe("sections in the batch", () => {
  const detected = [{ start: 0, end: 16, name: "Verse 1" }];
  const analysisWith = (over: Partial<SongAnalysis> = {}): SongAnalysis => ({ audioId: "x", version: ANALYSIS_VERSION, ...over });

  it("is one of the steps the dialog offers, ticked by default", () => {
    expect(BATCH_STEPS.find((step) => step.id === "sections")).toMatchObject({ defaultOn: true });
  });

  it("writes detected sections to a song with none, marked as detected", () => {
    const plan = planWriteBack(song("s"), analysisWith({ sections: detected }), null, false);
    const options = JSON.parse(plan.values[":options"]);
    expect(options.sections).toEqual([expect.objectContaining({ name: "Verse 1", start: 0, end: 16, source: "detected" })]);
  });

  it("leaves a song's own sections alone, and keeps the suggestion in the analysis", () => {
    const made = [{ id: "a", name: "Intro", start: 0, end: 8, mode: "continue" }];
    const plan = planWriteBack(song("m", {}, { sections: made }), analysisWith({ sections: detected }), null, true);
    const options = JSON.parse(plan.values[":options"]);
    expect(options.sections).toEqual(made);
    expect(options.analysis.sections).toEqual(detected);
  });
});


describe("the lyrics step", () => {
  const lyricsOn = { ...defaultChoice(), lyrics: true };
  const lyricsWith = (over: Partial<LyricsBatchOptions> = {}): LyricsBatchOptions => ({ ...DEFAULT_LYRICS_BATCH, ...over });
  const text = "[00:01.00] Hold on";

  it("is off by default and runs last when ticked", () => {
    expect(BATCH_STEPS.find((step) => step.id === "lyrics")).toMatchObject({ defaultOn: false });
    expect(stepsFor(song("p"), batchOptions({ choice: lyricsOn })).at(-1)).toBe("lyrics");
  });

  it("fills only an empty chart with the default selection", () => {
    expect(lyricsAction(song("q", { ":lyrics": "" }), lyricsWith())).toEqual({ kind: "transcribe" });
    expect(lyricsAction(song("r", { ":lyrics": text }, { chartSource: "transcribed" }), lyricsWith())).toBeNull();
  });

  it("never replaces a chart the performer wrote, whatever is selected", () => {
    const user = song("s", { ":lyrics": text }, { chartSource: "user" });
    for (const which of ["transcribed", "older"] as const) expect(lyricsAction(user, lyricsWith({ which }))).toBeNull();
    expect(lyricsAction(song("t", { ":lyrics": text }), lyricsWith({ which: "transcribed" }))).toBeNull();
  });

  it("replaces a transcribed chart for the transcribed selection, or for an older model", () => {
    const transcribed = song("u", { ":lyrics": text }, { chartSource: "transcribed", lyricsMade: { model: "base", quality: "fast", language: "auto", at: "x" } });
    expect(lyricsAction(transcribed, lyricsWith({ which: "transcribed" }))).toEqual({ kind: "transcribe" });
    expect(lyricsAction(transcribed, lyricsWith({ which: "older", model: "small" }))).toEqual({ kind: "transcribe" });
    expect(lyricsAction(transcribed, lyricsWith({ which: "older", model: "base" }))).toBeNull();
  });

  it("times an aligned chart again only when re-timing is on, and keeps its lines", () => {
    const aligned = song("v", { ":lyrics": "[00:01.00] Hold on\n[00:03.00] \n[00:04.00] I'm coming" }, { chartSource: "aligned" });
    expect(lyricsAction(aligned, lyricsWith({ retime: true }))).toEqual({ kind: "retime", lines: ["Hold on", "", "I'm coming"] });
    expect(lyricsAction(aligned, lyricsWith({ retime: false }))).toBeNull();
  });

  it("selects songs for the lyrics step even when no analysis is ticked", () => {
    const choice = { ...defaultChoice(), ...Object.fromEntries(BATCH_STEPS.map((s) => [s.id, false])), lyrics: true };
    const { run } = selectSongs([song("w", { ":lyrics": "" }), song("x", { ":lyrics": text }, { chartSource: "user" })], batchOptions({ choice, onlyNeeded: true }));
    expect(run.map((s) => s.id)).toEqual(["w"]);
  });

  it("writes a new chart with its source, the model that made it, and the chart it replaced", () => {
    const old = song("y", { ":lyrics": "[00:00.00] Typed" }, { chartSource: "user" });
    const plan = planWriteBack(old, null, null, false, { text, source: "transcribed", made: { model: "small", quality: "fast", language: "auto", at: "t" } });
    expect(plan.values[":lyrics"]).toBe(text);
    expect(plan.tempoChange).toBeNull();
    expect(JSON.parse(plan.values[":options"])).toMatchObject({
      chartSource: "transcribed",
      lyricsMade: { model: "small" },
      previousChart: { text: "[00:00.00] Typed", source: "user" },
    });
  });

  it("leaves a chart from before 0.9.2 alone unless the option is on, and then treats it as transcribed", () => {
    const old = song("o", { ":lyrics": text });
    expect(lyricsAction(old, lyricsWith({ which: "transcribed" }))).toBeNull();
    expect(lyricsSkip(old, lyricsWith({ which: "transcribed" }))).toBe("unknown");
    expect(lyricsAction(old, lyricsWith({ which: "transcribed", unknown: true }))).toEqual({ kind: "transcribe" });
    expect(lyricsAction(old, lyricsWith({ which: "older", model: "small", unknown: true }))).toEqual({ kind: "transcribe" });
    expect(lyricsAction(old, lyricsWith({ which: "empty", unknown: true }))).toBeNull();
  });

  it("never replaces the performer's chart, even with the option on", () => {
    const user = song("p", { ":lyrics": text }, { chartSource: "user" });
    expect(lyricsAction(user, lyricsWith({ which: "older", unknown: true }))).toBeNull();
    expect(lyricsSkip(user, lyricsWith({ which: "transcribed", unknown: true }))).toBe("user");
  });

  it("gives each song that is left out a reason, and counts the songs that run", () => {
    const songs = [
      song("a", { ":lyrics": "" }),
      song("b", { ":lyrics": text }, { chartSource: "transcribed" }),
      song("c", { ":lyrics": text }, { chartSource: "user" }),
      song("d", { ":lyrics": text }),
      song("e", { ":lyrics": "[00:01.00] Mine" }, { chartSource: "aligned" }),
    ];
    expect(lyricsPlan(songs, lyricsWith(), null)).toEqual({
      run: 2,
      skipped: [
        { reason: "user", count: 1 },
        { reason: "unknown", count: 1 },
        { reason: "made", count: 1 },
      ],
    });
    expect(lyricsPlan(songs, lyricsWith(), "a")).toMatchObject({ run: 1, skipped: expect.arrayContaining([{ reason: "open", count: 1 }]) });
  });

  it("says what the run will do before it starts, and how to include the charts from before 0.9.2", () => {
    const plan = { run: 4, skipped: [{ reason: "unknown" as const, count: 2 }] };
    expect(describeLyricsPlan(plan, { which: "transcribed", unknown: false })).toBe(
      "Lyrics: 4 of 6 songs will get new lyrics. Skipped: 2 from before 0.9.2. Tick the box above to include them.",
    );
    expect(describeLyricsPlan(plan, { which: "transcribed", unknown: true })).toBe("Lyrics: 4 of 6 songs will get new lyrics. Skipped: 2 from before 0.9.2.");
    expect(describeLyricsPlan(plan, { which: "empty", unknown: false })).toBe("Lyrics: 4 of 6 songs will get new lyrics. Skipped: 2 from before 0.9.2.");
    expect(describeLyricsPlan({ run: 0, skipped: [{ reason: "none", count: 6 }] }, { which: "empty", unknown: false })).toBe(
      "Lyrics: 0 of 6 songs will get new lyrics. Skipped: 6 with no lyrics.",
    );
  });

  it("describes the lyrics made, timed and empty in one line", () => {
    expect(
      describeBatch([
        { id: "a", title: "A", status: "lyrics", lyrics: { kind: "made" } },
        { id: "b", title: "B", status: "analysed", tempoChange: null, noBeat: false, lyrics: { kind: "timed" } },
        { id: "c", title: "C", status: "lyrics", lyrics: { kind: "none" } },
      ]),
    ).toBe("Analysed 1 song. Lyrics: 1 transcribed, 1 timed, 1 with no words heard.");
  });

  it("says how many songs' lyrics were skipped and why, and names each failure with its message", () => {
    const skipped = (id: string) => ({ id, title: id.toUpperCase(), status: "lyrics" as const, lyrics: { kind: "skipped" as const, reason: "unknown" as const } });
    expect(describeBatch([skipped("a"), skipped("b")])).toBe("Analysed 0 songs. Lyrics: 0 transcribed, 2 skipped (from before 0.9.2).");
    expect(describeBatch([skipped("a"), { id: "c", title: "C", status: "lyrics", lyrics: { kind: "failed", reason: "WebGPU failed" } }])).toBe(
      "Analysed 0 songs. Lyrics: 0 transcribed, 1 failed, 1 skipped (from before 0.9.2). C: lyrics failed: WebGPU failed.",
    );
  });

  it("gives each song's lyrics a line of its own, with the skip reason", () => {
    expect(describeLyricsOutcome({ kind: "skipped", reason: "unknown" })).toBe("Lyrics skipped: has lyrics from before 0.9.2");
    expect(describeLyricsOutcome({ kind: "timed" })).toBe("lyrics timed");
    expect(describeLyricsOutcome({ kind: "failed", reason: "Model download failed" })).toBe("lyrics failed: Model download failed");
  });

  it("shows the model download as a percentage on the lyrics step", () => {
    expect(lyricsStepText("Downloading lyrics model: 34% (onnx/model.onnx)")).toBe("lyrics: downloading model 34%");
    expect(lyricsStepText("Transcribing vocals locally… This may take several minutes.")).toBe("lyrics: Transcribing vocals locally… This may take several minutes.");
  });

  it("reports a song whose lyrics were skipped as analysed, with the skip reason", async () => {
    const old = song("k", { ":bpm": "120", ":lyrics": text });
    const { deps, writes } = fakeDeps();
    const outcomes = await runAnalysisBatch([old], batchOptions({ onlyNeeded: false, choice: lyricsOn }), deps, new AbortController().signal);
    expect(outcomes).toEqual([expect.objectContaining({ id: "k", status: "analysed", lyrics: { kind: "skipped", reason: "unknown" } })]);
    expect(writes[0].values[":lyrics"]).toBeUndefined();
  });

  it("shows the model download on the lyrics step while the batch runs", async () => {
    const empty = song("g", { ":lyrics": "" });
    const { deps } = fakeDeps({
      steps: (_ids, _grid, _gridOf, lyrics): AnalysisStep[] => [
        { name: "lyrics", run: async () => (lyrics?.onStatus?.("Downloading lyrics model: 34% (model.onnx)"), {}) },
      ],
    });
    const onProgress = vi.fn();
    const lyricsOnly = { ...defaultChoice(), ...Object.fromEntries(BATCH_STEPS.map((s) => [s.id, false])), lyrics: true };
    await runAnalysisBatch([empty], batchOptions({ onlyNeeded: true, choice: lyricsOnly }), deps, new AbortController().signal, { onProgress });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ step: "lyrics: downloading model 34%" }));
  });

  it("reports a lyrics step that fails with its message, and writes no chart", async () => {
    const empty = song("f", { ":lyrics": "" });
    const { deps, writes } = fakeDeps({
      steps: (_ids, _grid, _gridOf, lyrics): AnalysisStep[] => [
        {
          name: "lyrics",
          run: async () => {
            lyrics?.onError?.("Model download failed");
            throw new Error("Model download failed");
          },
        },
      ],
    });
    const lyricsOnly = { ...defaultChoice(), ...Object.fromEntries(BATCH_STEPS.map((s) => [s.id, false])), lyrics: true };
    const outcomes = await runAnalysisBatch([empty], batchOptions({ onlyNeeded: true, choice: lyricsOnly }), deps, new AbortController().signal);
    expect(outcomes).toEqual([{ id: "f", title: "Song f", status: "lyrics", lyrics: { kind: "failed", reason: "Model download failed" } }]);
    expect(writes).toEqual([]);
  });

  it("saves the analysis under the audio without the generated parts, so generating them keeps it", async () => {
    const mix = tone();
    const { deps, writes } = fakeDeps({
      load: vi.fn(async () => ({ source: mix, stems: { track1: tone(0.2) } as Stems })),
    });
    const song1 = song("g", { ":bpm": "120" }, { generatedParts: { drums: "track1" } });
    await runAnalysisBatch([song1], batchOptions(), deps, new AbortController().signal);
    const saved = JSON.parse(writes[0].values[":options"]).analysis as SongAnalysis;
    expect(saved.audioId).toBe(songAudioId(mix, {}));
  });

  it("runs only the lyrics for a song whose analysis is current, and writes the chart without touching the analysis", async () => {
    const current = song("z", { ":bpm": "98", ":lyrics": "" }, { analysis: { audioId: "x", version: ANALYSIS_VERSION }, tempoSource: "detected" });
    const onText = vi.fn();
    const { deps, writes } = fakeDeps({
      steps: (ids, _grid, _gridOf, lyrics): AnalysisStep[] => {
        expect(ids).toEqual([]);
        return lyrics ? [{ name: "lyrics", run: async () => (lyrics.onText(text), {}) }] : [];
      },
    });
    const outcomes = await runAnalysisBatch([current], batchOptions({ onlyNeeded: true, choice: lyricsOn }), deps, new AbortController().signal);
    expect(outcomes).toEqual([{ id: "z", title: "Song z", status: "lyrics", lyrics: { kind: "made" } }]);
    expect(writes[0].values[":lyrics"]).toBe(text);
    expect(writes[0].values[":bpm"]).toBeUndefined();
    expect(onText).not.toHaveBeenCalled();
  });

  it("cancelling in the middle of the lyrics writes nothing for that song", async () => {
    const outer = new AbortController();
    const current = song("q", { ":bpm": "98", ":lyrics": "" }, { analysis: { audioId: "x", version: ANALYSIS_VERSION }, tempoSource: "detected" });
    const { deps, writes } = fakeDeps({
      steps: (_ids, _grid, _gridOf, lyrics): AnalysisStep[] =>
        lyrics
          ? [
              {
                name: "lyrics",
                run: (_audio, signal) =>
                  new Promise<never>((_, reject) => {
                    signal.addEventListener("abort", () => reject(new Error("stopped")));
                    outer.abort();
                  }),
              },
            ]
          : [],
    });
    const outcomes = await runAnalysisBatch([current], batchOptions({ onlyNeeded: true, choice: lyricsOn }), deps, outer.signal);
    expect(outcomes).toEqual([]);
    expect(writes).toEqual([]);
  });
});
