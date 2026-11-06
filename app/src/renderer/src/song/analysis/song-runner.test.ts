import { describe, expect, it } from "vitest";
import type { AnalysisAudio, AnalysisStep, SongAnalysis, StepResult } from "./song-analysis";
import { ANALYSIS_VERSION, PLAYBACK_INTERRUPT } from "./song-analysis";
import { createSongRunner, type CapturedRun, type RunnerDeps, type RunOptions, type SavedSong } from "./song-runner";

const audio = {} as AnalysisAudio;

/** A fake app: an in-memory song, a playback flag the test drives, and steps that return fixed results. */
function fakeApp(over: { steps?: (options: RunOptions, captured: CapturedRun) => AnalysisStep[]; saved?: Partial<SavedSong> } = {}) {
  const song: { bpm: string; options: Record<string, unknown>; chart: string; lyrics: string } = {
    bpm: "120",
    options: {},
    chart: "",
    lyrics: "",
    ...over.saved,
  };
  let playing = false;
  let currentAudio: string | null = "a1";
  const listeners = new Set<(playing: boolean) => void>();
  const writes: Record<string, string>[] = [];
  const finished: SongAnalysis[] = [];
  const deps: RunnerDeps = {
    target: () => ({ key: "song", title: "Song", audioId: "a1", audio }),
    audioId: () => currentAudio,
    read: (): SavedSong => ({ bpm: song.bpm, options: { ...song.options }, chart: song.chart, lyrics: song.lyrics }),
    write: (_key, values) => {
      writes.push(values);
      if (values[":bpm"] !== undefined) song.bpm = values[":bpm"];
      if (values[":options"] !== undefined) song.options = JSON.parse(values[":options"]);
      if (values[":lyrics"] !== undefined) song.lyrics = values[":lyrics"];
    },
    steps: (_key, options, captured) => (over.steps ? over.steps(options, captured) : []),
    busy: () => playing,
    onBusyChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    finished: (_key, analysis) => finished.push(analysis),
  };
  const runner = createSongRunner(deps);
  const setPlaying = (value: boolean) => {
    playing = value;
    for (const listener of listeners) listener(value);
  };
  return {
    runner,
    song,
    writes,
    finished,
    setPlaying,
    /** A new audio for the song (a split landed, or another song opened). */
    setAudio: (id: string | null) => (currentAudio = id),
  };
}

/** A step that returns a fixed result. */
const stepReturning = (result: StepResult, name = "step"): AnalysisStep => ({ name, run: async () => result });
const tempo = (bpm: number) => ({ tempo: { bpm, firstBeat: 0.5, steady: true } });

/** Lets queued promises settle, so a run that has started can finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the automatic run", () => {
  it("writes a finished run through the fill-in rules, and reports it", async () => {
    const app = fakeApp({ steps: () => [stepReturning({ ...tempo(98), loudness: { lufs: -14, peakDb: -1 } })] });
    app.runner.analyse();
    await settle();
    expect(app.song.bpm).toBe("98");
    expect(app.song.options).toMatchObject({ tempoSource: "detected", songLufs: -14 });
    expect(app.runner.state.getState().message).toContain("Tempo 98 BPM");
    expect(app.runner.state.getState().revision).toBe(1);
    expect(app.finished).toHaveLength(1);
  });

  it("does nothing when the saved analysis is current for the audio", async () => {
    const saved: SongAnalysis = { audioId: "a1", version: ANALYSIS_VERSION, tempo: { bpm: 98, firstBeat: 0.5, steady: true } };
    const app = fakeApp({ saved: { options: { analysis: saved } }, steps: () => [stepReturning(tempo(60))] });
    app.runner.analyse();
    await settle();
    expect(app.writes).toHaveLength(0);
    expect(app.runner.state.getState().message).toContain("Tempo 98 BPM");
  });

  it("notes a legacy 120 that the run replaced, with an Undo that puts it back", async () => {
    const app = fakeApp({ steps: () => [stepReturning(tempo(98))] });
    app.runner.analyse();
    await settle();
    const [notice] = app.runner.state.getState().notices;
    expect(notice.text).toBe("Tempo detected: 98 BPM (was 120).");
    app.runner.press(notice.actions[0].patch);
    expect(app.song.bpm).toBe("120");
  });

  it("pauses during playback, and resumes from the step it stopped at once playback stops", async () => {
    const release: { now?: () => void } = {};
    const second: AnalysisStep = {
      name: "second",
      run: () => new Promise<StepResult>((resolve) => (release.now = () => resolve(tempo(101)))),
    };
    const app = fakeApp({ steps: () => [stepReturning({}, "first"), second] });
    app.runner.analyse();
    await settle();
    app.setPlaying(true);
    release.now?.();
    await settle();
    expect(app.writes).toHaveLength(0);
    app.setPlaying(false);
    await settle();
    expect(app.song.bpm).toBe("101");
    expect(app.runner.state.getState().step).toBeNull();
    expect(PLAYBACK_INTERRUPT).toBe("playback");
  });

  it("waits for playback to stop when it starts during playback", async () => {
    const app = fakeApp({ steps: () => [stepReturning(tempo(88))] });
    app.setPlaying(true);
    app.runner.analyse();
    await settle();
    expect(app.writes).toHaveLength(0);
    app.setPlaying(false);
    await settle();
    expect(app.song.bpm).toBe("88");
  });
});

describe("a run parked for an older audio", () => {
  it("is dropped when the audio changes while it waits, and never resumed", async () => {
    const app = fakeApp({ steps: () => [stepReturning(tempo(88))] });
    app.setPlaying(true);
    app.runner.analyse();
    await settle();
    // A split landed while playback held the run: the new audio is what the run is for now.
    app.setAudio("a2");
    app.setPlaying(false);
    await settle();
    expect(app.writes).toHaveLength(0);
    expect(app.runner.state.getState().waiting).toBe(false);
    expect(app.runner.state.getState().running).toBe(false);
  });
});

describe("the lyrics step in the run", () => {
  const lyricsOptions = { model: "small" as const, quality: "fast" as const, language: "auto" as const };

  it("writes a chart the lyrics step made, as a transcribed chart, and says so", async () => {
    const app = fakeApp({
      steps: (_options, captured) => [
        {
          name: "lyrics",
          run: async () => {
            captured.lyrics = "[00:01.00] first line";
            captured.lyricsOptions = lyricsOptions;
            return {};
          },
        },
      ],
    });
    app.runner.analyse();
    await settle();
    expect(app.song.lyrics).toBe("[00:01.00] first line");
    expect(app.song.options).toMatchObject({ chartSource: "transcribed", lyricsMade: { model: "small", quality: "fast", language: "auto" } });
    expect(app.runner.state.getState().message).toContain("Lyrics made.");
  });

  it("leaves the chart alone and says why when the lyrics step made none", async () => {
    const app = fakeApp({ steps: (_options, captured) => ((captured.note = "Split the song to get lyrics."), []) });
    app.runner.analyse();
    await settle();
    expect(app.song.lyrics).toBe("");
    expect(app.runner.state.getState().message).toContain("Split the song to get lyrics.");
  });
});

describe("the user's runs", () => {
  it("detects the tempo again, and offers the octaves and an Undo", async () => {
    const app = fakeApp({ saved: { bpm: "95", options: { tempoSource: "manual" } }, steps: () => [stepReturning(tempo(120))] });
    app.runner.detect();
    await settle();
    const [notice] = app.runner.state.getState().notices;
    expect(notice.text).toBe("Tempo detected: 120 BPM.");
    expect(notice.actions.map((action) => action.label)).toEqual(["Use 60", "Use 240", "Undo"]);
    app.runner.press(notice.actions[0].patch);
    expect(app.song.bpm).toBe("60");
  });

  it("finds the beat from a typed tempo, and keeps the typed tempo as the performer's own", async () => {
    const app = fakeApp({ saved: { bpm: "95", options: { tempoSource: "manual" } }, steps: () => [stepReturning(tempo(96))] });
    app.runner.findBeat({ tempoHint: 95, lockTempo: false });
    await settle();
    expect(app.song.bpm).toBe("96");
    expect(app.song.options.tempoSource).toBe("manual");
    expect(app.runner.state.getState().notices[0].text).toContain("Beat found at 96 BPM (you set 95)");
  });

  it("ignores a user run during playback", async () => {
    const app = fakeApp({ steps: () => [stepReturning(tempo(90))] });
    app.setPlaying(true);
    app.runner.analyseAgain();
    await settle();
    expect(app.writes).toHaveLength(0);
  });

  it("replaces a manual tempo when the performer asks to analyse again", async () => {
    const app = fakeApp({ saved: { bpm: "95", options: { tempoSource: "manual" } }, steps: () => [stepReturning(tempo(90))] });
    app.runner.analyseAgain();
    await settle();
    expect(app.song.bpm).toBe("90");
  });

  it("offers Use it for a 3/4 reading the performer did not choose, and does not apply it", async () => {
    const app = fakeApp({ steps: () => [stepReturning({ ...tempo(90), meter: { beatsPerBar: 3, confidence: 0.9 } })] });
    app.runner.analyse();
    await settle();
    const notice = app.runner.state.getState().notices.find((item) => item.text === "Sounds like 3/4.");
    expect(notice).toBeDefined();
    expect(app.song.options.beats).toBeUndefined();
    app.runner.press(notice!.actions[0].patch);
    expect(app.song.options.beats).toBe(3);
  });

  it("cancels the run in progress when another run starts", async () => {
    const steps = [stepReturning(tempo(70), "slow")];
    const app = fakeApp({ steps: () => steps });
    app.runner.analyse();
    app.runner.cancel();
    await settle();
    expect(app.writes).toHaveLength(0);
  });
});
