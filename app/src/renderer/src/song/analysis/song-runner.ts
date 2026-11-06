// Runs the song analysis for the open song without React (spec 80). A run starts when a split or an import lands, when the Song screen opens
// a song whose analysis is missing or old, and when the performer asks to detect the tempo again or find the beat. It keeps going while
// other screens are open, pauses while a song or a playlist plays, and resumes from the step it stopped at. Its results are written
// through apply.ts, the same fill-in rules the Library batch uses. The panel reloads its values when `revision` changes.
//
// The runner takes its song, settings, steps and playback as dependencies, so its logic is tested without the store, the workers or the
// screen. The app's instance is wired in song-runner-app.ts.

import { create } from "zustand";
import type { BeatGrid, TempoHintOptions } from "../band/beat-grid";
import { gridAtOctave, tempoOctaves } from "../performance/tempo-source";
import { parseSections } from "../performance/sections";
import { lyricsMadeRecord } from "../performance/lyrics-chart";
import type { LyricsOptions } from "../performance/lyrics-options";
import { sectionsFollowDetection, sectionsFromDetected } from "./sections";
import { planWriteBack, parseOptions, type BatchSong, type LyricsWrite } from "./apply";
import {
  METER_CERTAIN,
  PLAYBACK_INTERRUPT,
  describeAnalysis,
  isCurrent,
  parseAnalysis,
  runSongAnalysis,
  type AnalysisAudio,
  type AnalysisOutcome,
  type AnalysisStep,
  type SongAnalysis,
} from "./song-analysis";

/** A setting the notice's button writes: the tempo, and options merged into the song's options at press time. */
export interface NoticePatch {
  bpm?: string;
  options?: Record<string, unknown>;
}

export interface NoticeAction {
  label: string;
  patch: NoticePatch;
}

/** A line shown after a run. Its actions write their patch when pressed, such as Undo for a tempo the run replaced. */
export interface RunNotice {
  text: string;
  actions: NoticeAction[];
}

/** What a run is for. The Detect, Find the beat and Analyse again buttons set `force` and `replaceManual`; an automatic run sets neither. */
export interface RunOptions {
  /** Runs even when the saved analysis matches the audio. */
  force?: boolean;
  /** The tempo and meter found replace the saved ones, even where the performer chose them. */
  replaceManual?: boolean;
  /** Runs the tempo step only, and keeps the rest of the saved analysis. */
  tempoOnly?: boolean;
  /** A typed tempo the beat is found again from. The tempo found is then kept as the performer's own. */
  hint?: TempoHintOptions;
  /** Re-lays the sections on the new grid, when the performer has not changed them since the last detection. */
  sections?: boolean;
  /** The meter to analyse with, when the performer has just changed it. */
  beatsPerBar?: number;
}

/** The song a run analyses. The app builds it from the open song; a test builds it by hand. */
export interface RunTarget {
  key: string;
  /** The song's name, as the status bar shows it. */
  title: string;
  audioId: string;
  audio: AnalysisAudio;
}

/** A song's saved settings: its tempo, its options, its beat chart and its lyrics. */
export interface SavedSong {
  bpm: string;
  options: Record<string, unknown>;
  chart: string;
  lyrics: string;
}

export interface RunnerDeps {
  /** The open song, or null when none is open. `beatsPerBar` replaces the song's meter when the performer has just changed it. */
  target(beatsPerBar?: number): RunTarget | null;
  /** The saved settings of a song, read when a run starts and before it writes. */
  read(key: string): SavedSong;
  /** Writes saved settings of the song: ":bpm", ":options" and ":lyrics". */
  write(key: string, values: Record<string, string>): void;
  /** The steps a run takes, in order. The tempo step fills `captured.grid` with the beat grid it tracked. */
  steps(key: string, options: RunOptions, captured: CapturedRun): AnalysisStep[];
  /** The audio id of the open song right now, or null when none is open. A run parked for an older audio is dropped, not resumed. */
  audioId(): string | null;
  /**
   * Whether a run must wait: a song or a playlist is playing, or the Library's batch is going, or the store is splitting. Nothing runs
   * then, and a run waiting for this resumes when it is false again.
   */
  busy(): boolean;
  /** Calls `listener` when the busy state may have changed (playback starts or stops, the batch starts or ends). Returns how to stop. */
  onBusyChange(listener: (busy: boolean) => void): () => void;
  /** Called once a finished run has been written, so the app can keep what the run learned beyond the settings. */
  finished?(key: string, analysis: SongAnalysis): void;
}

/**
 * What the steps capture while they run. The steps fill it in from callbacks, so it is held in an object. `lyrics` is the chart the
 * lyrics step transcribed, with the options it used; `note` is a line about the lyrics step to show after the run (no vocals, a failure).
 */
export interface CapturedRun {
  grid: BeatGrid | null;
  lyrics: string | null;
  lyricsOptions: LyricsOptions | null;
  note: string | null;
}

export interface SongRunState {
  /** The song the current or last run belongs to. */
  songKey: string | null;
  title: string | null;
  /** True while a run is in progress, including one waiting for playback to stop. */
  running: boolean;
  /** True while a run waits for playback, or for the Library's batch, to stop. */
  waiting: boolean;
  /** The step being run, or null when idle. */
  step: string | null;
  /** The index of the step being run, and how many steps the run has. */
  stepIndex: number;
  steps: number;
  /** True while the tempo is detected again, from the Detect button. */
  detecting: boolean;
  /** What the last finished run found, as one line. */
  message: string | null;
  /** Notices from the last finished run. */
  notices: RunNotice[];
  /** Counts every write, so the panel reloads its values from the settings. */
  revision: number;
  /** When the last run ended, or null while none has. The status bar shows its summary for a while after that. */
  endedAt: number | null;
}

/** A run in progress, or one parked until playback stops. */
interface Run {
  key: string;
  target: RunTarget;
  options: RunOptions;
  captured: CapturedRun;
  controller: AbortController;
  from: number;
  partial?: SongAnalysis;
}

/** The tempo octaves a detect notice offers, as the Performance screen did: the detected tempo halved and doubled. */
export function tempoOctaveChoices(bpm: number): number[] {
  return tempoOctaves(bpm);
}

/** The settings an Undo puts back: the tempo, first beat, meter, grid and sections, as they were before a run. */
const UNDO_OPTIONS = ["tempoSource", "firstBeat", "beats", "beatsSource", "beatGrid", "beatGridSource", "sections"] as const;

/** Creates a runner over the given dependencies, with its own state. */
export function createSongRunner(deps: RunnerDeps) {
  const state = create<SongRunState>(() => ({
    songKey: null,
    title: null,
    running: false,
    waiting: false,
    step: null,
    stepIndex: 0,
    steps: 0,
    detecting: false,
    message: null,
    notices: [],
    revision: 0,
    endedAt: null,
  }));
  // The run in progress, and the run waiting for playback to stop. Only one of them exists at a time.
  let active: Run | null = null;
  let parked: Run | null = null;

  /** Runs the steps from `run.from`. A run that was superseded, cancelled or parked leaves the state to whoever stopped it. */
  async function execute(run: Run): Promise<void> {
    active = run;
    const saved = parseAnalysis(deps.read(run.key).options.analysis);
    const steps = deps.steps(run.key, run.options, run.captured);
    state.setState({
      songKey: run.key,
      title: run.target.title,
      running: true,
      waiting: false,
      step: null,
      stepIndex: 0,
      steps: steps.length,
      detecting: !!run.options.tempoOnly,
      notices: [],
    });
    const outcome: AnalysisOutcome = await runSongAnalysis({
      audioId: run.target.audioId,
      audio: run.target.audio,
      steps,
      // The run writes nothing itself: the write below goes through the fill-in rules.
      settings: { read: () => saved, write: () => undefined },
      force: run.options.force,
      from: run.from,
      partial: run.partial,
      signal: run.controller.signal,
      onStep: (index, name) => state.setState({ step: name, stepIndex: index }),
    });
    if (active !== run) return;
    active = null;
    state.setState({ step: null, detecting: false, running: false });
    if (outcome.status === "interrupted") {
      parked = { ...run, from: outcome.next, partial: outcome.analysis, controller: new AbortController() };
      state.setState({ running: true, waiting: true });
      return;
    }
    if (outcome.status === "complete") finish(run, outcome.analysis, saved);
  }

  /** Writes a finished run through the fill-in rules, and sets the message and notices the panel shows. */
  function finish(run: Run, analysis: SongAnalysis, saved: SongAnalysis | null): void {
    const { key } = run;
    const before = deps.read(key);
    const song: BatchSong = {
      id: key,
      title: "",
      settings: { ":bpm": before.bpm, ":options": JSON.stringify(before.options), "": before.chart, ":lyrics": before.lyrics },
    };
    const { lyrics, lyricsOptions } = run.captured;
    const lyricsWrite: LyricsWrite | null =
      lyrics !== null && lyricsOptions ? { text: lyrics, source: "transcribed", made: lyricsMadeRecord(lyricsOptions, new Date().toISOString()) } : null;
    const plan = planWriteBack(song, analysis, run.captured.grid, !!run.options.replaceManual, lyricsWrite);
    const options = parseOptions(plan.values[":options"]);
    // A find-the-beat run keeps the typed tempo as the performer's own, so a later analysis does not replace it.
    if (run.options.hint) options.tempoSource = "manual";
    // Sections are laid out again on the new grid when the performer has not changed them since the last detection.
    if (run.options.sections && analysis.sections && sectionsFollowDetection(parseSections(before.options.sections), saved?.sections ?? [])) {
      options.sections = sectionsFromDetected(analysis.sections);
    }
    deps.write(key, { ...plan.values, ":options": JSON.stringify(options) });
    const notices = noticesFor(run, analysis, before, plan.tempoChange !== null);
    const lyricsLine = lyricsWrite ? "Lyrics made." : (run.captured.note ?? "");
    const message = [describeAnalysis(analysis), lyricsLine].filter(Boolean).join(" ");
    state.setState((current) => ({ message, notices, revision: current.revision + 1, running: false, waiting: false, endedAt: Date.now() }));
    deps.finished?.(key, analysis);
  }

  /** The notices after a finished run: a tempo it replaced (with Undo), the octave choices of a detect, and "Use it" for 3/4. */
  function noticesFor(run: Run, analysis: SongAnalysis, before: SavedSong, tempoChanged: boolean): RunNotice[] {
    const out: RunNotice[] = [];
    const undo: NoticeAction = { label: "Undo", patch: undoPatch(before) };
    if (analysis.tempo && run.options.hint) {
      const { hint } = run.options;
      const text = hint.lockTempo ? `Beat aligned at ${analysis.tempo.bpm} BPM.` : `Beat found at ${analysis.tempo.bpm} BPM (you set ${hint.tempoHint}).`;
      out.push({ text: `${text} First beat ${analysis.tempo.firstBeat.toFixed(2)} s.`, actions: [undo] });
    } else if (analysis.tempo && run.options.tempoOnly) {
      const octaves = tempoOctaveChoices(analysis.tempo.bpm).map((value) => ({ label: `Use ${value}`, patch: octavePatch(run, analysis, value) }));
      out.push({ text: `Tempo detected: ${analysis.tempo.bpm} BPM.`, actions: [...octaves, undo] });
    } else if (tempoChanged && before.bpm === "120") {
      // Only a 120 saved by an earlier build is a guess worth undoing. An empty tempo had no value to go back to.
      out.push({ text: `Tempo detected: ${analysis.tempo?.bpm} BPM (was 120).`, actions: [undo] });
    }
    if (analysis.meter && analysis.meter.beatsPerBar === 3 && analysis.meter.confidence >= METER_CERTAIN && before.options.beatsSource !== "manual") {
      out.push({ text: "Sounds like 3/4.", actions: [{ label: "Use it", patch: { options: { beats: 3, beatsSource: "detected" } } }] });
    }
    return out;
  }

  /** The patch an Undo writes: the tempo and the options it changed, as they were before the run. */
  function undoPatch(before: SavedSong): NoticePatch {
    const options: Record<string, unknown> = {};
    for (const name of UNDO_OPTIONS) options[name] = before.options[name];
    return { bpm: before.bpm, options };
  }

  /** The patch for a tempo octave: the detected tempo halved or doubled, with the grid laid out at that tempo. */
  function octavePatch(run: Run, analysis: SongAnalysis, value: number): NoticePatch {
    const grid = run.captured.grid && analysis.tempo ? gridAtOctave(run.captured.grid, analysis.tempo.bpm, value) : null;
    return { bpm: String(value), options: { tempoSource: "detected", ...(grid ? { beatGrid: grid, beatGridSource: "analysis" } : {}) } };
  }

  /** Starts a run now, or parks it while playback runs. A run in progress is cancelled first. */
  function begin(run: Run): void {
    listen();
    active?.controller.abort("cancel");
    parked = null;
    if (deps.busy()) {
      parked = run;
      state.setState({ songKey: run.key, title: run.target.title, running: true, waiting: true, step: null, detecting: false });
      return;
    }
    void execute(run);
  }

  /** Playback stopped: a parked run resumes from the step it stopped at. */
  function resumeParked(): void {
    if (!parked || deps.busy() || active) return;
    const run = parked;
    parked = null;
    // The song's audio changed while the run waited (a split landed, or another song opened): the run is out of date, and the new
    // audio's analysis starts from `analyse` instead.
    if (deps.audioId() !== run.target.audioId) {
      state.setState({ running: false, waiting: false, step: null });
      return;
    }
    void execute(run);
  }

  /** A run for the open song. `options` make it a user run (Detect, Find the beat, Analyse again); none makes it the automatic run. */
  function start(options: RunOptions, automatic: boolean): void {
    const target = deps.target(options.beatsPerBar);
    if (!target) return;
    const saved = deps.read(target.key);
    const savedAnalysis = parseAnalysis(saved.options.analysis);
    if (automatic && isCurrent(savedAnalysis, target.audioId)) {
      state.setState({ songKey: target.key, message: describeAnalysis(savedAnalysis!), notices: [] });
      return;
    }
    const run: Run = {
      key: target.key,
      target,
      options: automatic ? {} : { force: true, replaceManual: true, ...options },
      captured: { grid: null, lyrics: null, lyricsOptions: null, note: null },
      controller: new AbortController(),
      from: 0,
      // A detect runs the tempo only, so the rest of the saved analysis is kept (for the same audio).
      partial: options.tempoOnly && savedAnalysis && savedAnalysis.audioId === target.audioId ? savedAnalysis : undefined,
    };
    begin(run);
  }

  // A busy app (playback, the Library's batch) pauses a run in progress, and the run resumes once it is idle. Listening starts with the
  // first run, not on import.
  let stopListening: (() => void) | null = null;
  const listen = () => {
    stopListening ??= deps.onBusyChange((busy) => {
      if (busy) active?.controller.abort(PLAYBACK_INTERRUPT);
      else resumeParked();
    });
  };

  return {
    state,
    /** The automatic run for the open song, when a split or import lands, or a song is opened with no current analysis. */
    analyse(): void {
      start({}, true);
    },
    /** Detects the tempo and meter again, replacing the saved ones. The rest of the saved analysis is kept. Ignored during playback. */
    detect(): void {
      if (!deps.busy()) start({ tempoOnly: true }, false);
    },
    /** Finds the beat again from a tempo the performer typed. Ignored during playback. */
    findBeat(hint: TempoHintOptions): void {
      if (!deps.busy()) start({ tempoOnly: true, sections: true, hint }, false);
    },
    /** Runs every step again, replacing the saved tempo and meter. Ignored during playback. */
    analyseAgain(): void {
      if (!deps.busy()) start({}, false);
    },
    /** Runs the chosen steps again now, keeping what the performer chose (a manual tempo, a grid of their own). Ignored during playback. */
    analyseNow(): void {
      if (!deps.busy()) start({ force: true, replaceManual: false }, false);
    },
    /** Runs the analysis again with the meter the performer chose, so a grid laid out for the old meter is laid out again. */
    rerun(beatsPerBar?: number): void {
      if (!deps.busy()) start({ beatsPerBar }, false);
    },
    /** Presses a notice's button for the song the notice belongs to: merges its patch into the song's settings, and tells the panel to reload. */
    press(patch: NoticePatch): void {
      const key = state.getState().songKey;
      if (!key) return;
      const before = deps.read(key);
      const values: Record<string, string> = {};
      if (patch.bpm !== undefined) values[":bpm"] = patch.bpm;
      if (patch.options) values[":options"] = JSON.stringify({ ...before.options, ...patch.options });
      deps.write(key, values);
      state.setState((current) => ({ notices: [], revision: current.revision + 1 }));
    },
    /** Replaces the notices, for example to clear them. */
    show(notices: RunNotice[]): void {
      state.setState({ notices });
    },
    /** Stops the run and drops any parked run. The song is analysed again when it is next opened. */
    cancel(): void {
      parked = null;
      active?.controller.abort("cancel");
      active = null;
      state.setState({ step: null, detecting: false, running: false, waiting: false });
    },
  };
}

export type SongRunner = ReturnType<typeof createSongRunner>;

/** Whether the store is loading or splitting a song: the analysis waits, and a run in progress is parked, while it is. */
export function isSplitting(kind: string): boolean {
  return kind === "decoding" || kind === "model" || kind === "splitting";
}

/** The part of the song store's state the automatic run reads. */
export interface WatchedSong {
  source: unknown;
  stems: unknown;
  status: { kind: string };
}

/** The song store, as the automatic run sees it: its state, and a subscription to changes. */
export interface WatchableSongStore {
  subscribe(listener: (state: WatchedSong, previous: WatchedSong) => void): () => void;
}

/**
 * Calls `analyse` when a song's audio lands with the store idle or done: a file opened (its mix), or a split finished (its stems). A
 * split in progress does not start a run; the run for the split's stems starts once it is done.
 */
export function watchSongStore(store: WatchableSongStore, analyse: () => void): () => void {
  return store.subscribe((state, previous) => {
    if (state.status.kind !== "idle" && state.status.kind !== "done") return;
    if (!state.source) return;
    if (state.source === previous.source && state.stems === previous.stems) return;
    analyse();
  });
}
