// Analyses saved songs from the Library, without opening them (spec 72). This file decides which songs to analyse, which steps each one runs,
// how a finished analysis is written back to a saved song, and what the summary says. The loop takes its audio loader, playback state,
// saved settings and steps as arguments, so it is tested without the library, the workers or the screen. Only one song's audio is held at
// a time: each song's audio is local to its turn, so it can be dropped before the next song loads.

import type { BeatGrid } from "../band/beat-grid";
import type { PcmAudio, StemName, Stems } from "../types";
import { chartChordTimes } from "../band/request";
import { parseChart } from "../performance/chart";
import { defaultChordSource } from "../performance/sources";
import { parseBeatGrid } from "../band/beat-grid";
import { needsTempoDetection, readTempoSource } from "../performance/tempo-source";
import {
  chartSourceOf,
  lrcTexts,
  lyricsMadeOf,
  lyricsMadeRecord,
} from "../performance/lyrics-chart";
import { LYRIC_LANGUAGES, type LyricsLanguage, type LyricsOptions, type LyricsQualityId } from "../performance/lyrics-options";
import type { LyricsModelId } from "../performance/lyrics-models";
import { buildAnalysisAudio, sectionBoundsOf } from "./analysis-audio";
import type { LyricsStepInput } from "./steps";
import { planWriteBack, parseOptions, tempoMayChange, type BatchSong, type LyricsWrite, type WriteBack } from "./apply";

export type { BatchSong } from "./apply";
import {
  ANALYSIS_VERSION,
  PLAYBACK_INTERRUPT,
  parseAnalysis,
  generatedTrackKeysIn,
  runSongAnalysis,
  songAudioId,
  type AnalysisOutcome,
  type AnalysisStep,
  type SongAnalysis,
} from "./song-analysis";

/**
 * The steps the Library dialog offers, in the order the dialog lists them and the analysis runs them (the key comes after the chords).
 * Lyrics come last: transcription is the slowest step, and it runs after the others for each song. It is off by default, since it can
 * take a long time and downloads a model the first time.
 */
export const BATCH_STEPS = [
  { id: "tempo", label: "Tempo and meter", defaultOn: true },
  { id: "chords", label: "Chords", defaultOn: true },
  { id: "key", label: "Key", defaultOn: true },
  { id: "loudness", label: "Loudness", defaultOn: true },
  { id: "parts", label: "Drums and bass", defaultOn: true },
  { id: "silence", label: "Silence", defaultOn: true },
  { id: "sections", label: "Sections", defaultOn: true },
  { id: "lyrics", label: "Lyrics", defaultOn: false },
] as const;
export type BatchStepId = (typeof BATCH_STEPS)[number]["id"];
export type BatchChoice = Record<BatchStepId, boolean>;

/** The steps every new batch starts with: all of them, as the dialog ticks them by default. */
export function defaultChoice(): BatchChoice {
  return Object.fromEntries(BATCH_STEPS.map((step) => [step.id, step.defaultOn])) as BatchChoice;
}

/** Which lyrics charts the lyrics step may replace. A performer's own chart (`user`) is never replaced in bulk. */
export type LyricsWhich = "empty" | "transcribed" | "older";

/** The lyrics step's settings for a batch: the model and quality, which songs, and whether aligned charts are timed again. */
export interface LyricsBatchOptions {
  model: LyricsModelId;
  quality: LyricsQualityId;
  which: LyricsWhich;
  /** Re-times the `aligned` charts (the performer's own words) with the model chosen. Their text is kept. */
  retime: boolean;
  /** Treats charts from before 0.9.2 (source `unknown`) as transcribed, so the `transcribed` and `older` choices may replace them. */
  unknown: boolean;
}

export const DEFAULT_LYRICS_BATCH: LyricsBatchOptions = { model: "small", quality: "fast", which: "empty", retime: true, unknown: false };

/**
 * Why the lyrics step leaves a song's chart alone: no lyrics yet (under a choice that replaces only existing lyrics), the performer's own
 * words (`user`), pasted words not re-timed (`pasted`), a chart from before 0.9.2 (`unknown`), a chart Tone Studio made (`made`), or one
 * made with the model chosen (`model`). `open` is for the song open on the Performance screen.
 */
export type LyricsSkip = "open" | "none" | "user" | "pasted" | "unknown" | "made" | "model";

/**
 * The order the reasons are listed in. `label` reads after a count in the summary ("2 from before 0.9.2"); `has` completes "Lyrics
 * skipped: " for one song.
 */
const LYRICS_SKIPS: { reason: LyricsSkip; label: string; has: string }[] = [
  { reason: "open", label: "open on the Performance screen", has: "is open on the Performance screen" },
  { reason: "none", label: "with no lyrics", has: "has no lyrics" },
  { reason: "user", label: "written by you", has: "has lyrics you wrote" },
  { reason: "pasted", label: "your pasted lyrics, not re-timed", has: "has your pasted lyrics, not re-timed" },
  { reason: "unknown", label: "from before 0.9.2", has: "has lyrics from before 0.9.2" },
  { reason: "made", label: "made by Tone Studio", has: "has lyrics Tone Studio made" },
  { reason: "model", label: "made with this model", has: "has lyrics made with this model" },
];

/** The words for a skip reason, as the summary and a song's line in the list read them. */
export function lyricsSkipLabel(reason: LyricsSkip): string {
  return LYRICS_SKIPS.find((skip) => skip.reason === reason)?.label ?? reason;
}

export interface BatchOptions {
  /** Analyse only the songs whose saved analysis is missing, older, or has no tempo of its own. */
  onlyNeeded: boolean;
  /** Tempo and meter the performer set by hand are replaced too. Off, a manual, tap or chart tempo is kept. */
  replaceManual: boolean;
  choice: BatchChoice;
  /** The song open on the Performance screen, skipped so its panel state is never changed behind its back. */
  openSongId: string | null;
  /** The lyrics step's settings. Defaults apply when absent. */
  lyrics?: LyricsBatchOptions;
}

/** What the lyrics step does to one song. `transcribe` makes a chart from the vocals; `retime` times the performer's own lines again. */
export type LyricsAction = { kind: "transcribe" } | { kind: "retime"; lines: string[] };

/**
 * Why the lyrics step leaves a song's chart alone, or null when it runs for the song. An empty chart is filled only for `empty`. A
 * `user` chart is never replaced. An aligned chart is timed again when `retime` is on. A transcribed chart is replaced for `transcribed`,
 * or for `older` when it was made with another model. A chart from before 0.9.2 is replaced only with `unknown` on, and then as a
 * transcribed chart.
 */
export function lyricsSkip(song: BatchSong, lyrics: LyricsBatchOptions): LyricsSkip | null {
  const options = parseOptions(song.settings[":options"]);
  const text = song.settings[":lyrics"] ?? "";
  if (!text.trim()) return lyrics.which === "empty" ? null : "none";
  const source = chartSourceOf(options);
  if (source === "user") return "user";
  if (source === "aligned") return lyrics.retime && lrcTexts(text).some(Boolean) ? null : "pasted";
  if (source === "unknown" && !lyrics.unknown) return "unknown";
  if (lyrics.which === "empty") return source === "unknown" ? "unknown" : "made";
  if (lyrics.which === "transcribed") return null;
  return (lyricsMadeOf(options)?.model ?? "") !== lyrics.model ? null : "model";
}

/**
 * The lyrics step's action for a song, or null when it leaves the song's chart alone (see lyricsSkip). An aligned chart is timed again
 * with its own lines; any other chart is transcribed.
 */
export function lyricsAction(song: BatchSong, lyrics: LyricsBatchOptions): LyricsAction | null {
  if (lyricsSkip(song, lyrics)) return null;
  const text = song.settings[":lyrics"] ?? "";
  if (text.trim() && chartSourceOf(parseOptions(song.settings[":options"])) === "aligned") return { kind: "retime", lines: lrcTexts(text) };
  return { kind: "transcribe" };
}

/** What the lyrics step will do across a selection: how many songs get new lyrics, and how many are skipped, by reason. */
export interface LyricsPlan {
  run: number;
  skipped: { reason: LyricsSkip; count: number }[];
}

/** The lyrics plan for the songs given, before a run starts. The open song is skipped, as the batch skips it. */
export function lyricsPlan(songs: readonly BatchSong[], lyrics: LyricsBatchOptions, openSongId: string | null): LyricsPlan {
  const counts = new Map<LyricsSkip, number>();
  let run = 0;
  for (const song of songs) {
    const reason = song.id === openSongId ? "open" : lyricsSkip(song, lyrics);
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    else run++;
  }
  return { run, skipped: LYRICS_SKIPS.flatMap(({ reason }) => (counts.has(reason) ? [{ reason, count: counts.get(reason) ?? 0 }] : [])) };
}

/**
 * One paragraph for the dialog, read before a run starts: how many songs get new lyrics and why the others are skipped. The hint for the
 * charts from before 0.9.2 is given only where the option can include them: not under the choice of songs with no lyrics.
 */
export function describeLyricsPlan(plan: LyricsPlan, lyrics: Pick<LyricsBatchOptions, "which" | "unknown">): string {
  const total = plan.run + plan.skipped.reduce((sum, skip) => sum + skip.count, 0);
  const head = `Lyrics: ${plan.run} of ${total} song${total === 1 ? "" : "s"} will get new lyrics.`;
  if (!plan.skipped.length) return head;
  const skipped = plan.skipped.map(({ reason, count }) => `${count} ${lyricsSkipLabel(reason)}`).join(", ");
  const hint = !lyrics.unknown && lyrics.which !== "empty" && plan.skipped.some((skip) => skip.reason === "unknown") ? " Tick the box above to include them." : "";
  return `${head} Skipped: ${skipped}.${hint}`;
}

/** Whether any analysis step (not lyrics) is chosen. */
function analysisChosen(choice: BatchChoice): boolean {
  return BATCH_STEPS.some((step) => step.id !== "lyrics" && choice[step.id]);
}

/** True when the saved analysis is missing, of an older version, or the song has no tempo chosen by the performer. */
export function needsAnalysis(song: BatchSong): boolean {
  const options = parseOptions(song.settings[":options"]);
  const saved = parseAnalysis(options.analysis);
  if (!saved || saved.version < ANALYSIS_VERSION) return true;
  return needsTempoDetection(song.settings[":bpm"] ?? "", readTempoSource(options));
}

/**
 * The songs to analyse, in the order given. The open song is skipped, and with `onlyNeeded` a song whose analysis is current is left out.
 * The skipped open song is returned too, so the summary can name it.
 */
export function selectSongs(songs: readonly BatchSong[], options: BatchOptions): { run: BatchSong[]; openSkipped: BatchSong[] } {
  const openSkipped = songs.filter((song) => song.id === options.openSongId);
  const run = songs.filter((song) => song.id !== options.openSongId && wantsRun(song, options));
  return { run, openSkipped };
}

/**
 * A song runs when the analysis is wanted for it (with `onlyNeeded`, only if it needs one), or when the lyrics step has something to do for
 * it. With no lyrics step, the songs are chosen as before.
 */
function wantsRun(song: BatchSong, options: BatchOptions): boolean {
  if (!options.choice.lyrics) return !options.onlyNeeded || needsAnalysis(song);
  const analysis = analysisChosen(options.choice) && (!options.onlyNeeded || needsAnalysis(song));
  return analysis || lyricsAction(song, options.lyrics ?? DEFAULT_LYRICS_BATCH) !== null;
}

/** The steps one song runs: the chosen ones, with tempo and meter dropped where the performer's tempo must be kept. */
export function stepsFor(song: BatchSong, options: Pick<BatchOptions, "choice" | "replaceManual">): BatchStepId[] {
  const allowed = tempoMayChange(song, options.replaceManual);
  return BATCH_STEPS.filter((step) => options.choice[step.id] && (step.id !== "tempo" || allowed)).map((step) => step.id);
}

/**
 * What the lyrics step did for a song: a chart made from the vocals (`made`), the performer's words timed (`timed`), no words heard
 * (`none`), a failure with its message (`failed`), or a skip with its reason (`skipped`).
 */
export type LyricsOutcome =
  | { kind: "made" }
  | { kind: "timed" }
  | { kind: "none" }
  | { kind: "failed"; reason: string }
  | { kind: "skipped"; reason: LyricsSkip };

/** One line for a song's lyrics in the list: what was made, timed or skipped, and why. */
export function describeLyricsOutcome(outcome: LyricsOutcome): string {
  switch (outcome.kind) {
    case "made":
      return "lyrics transcribed";
    case "timed":
      return "lyrics timed";
    case "none":
      return "lyrics: no words heard";
    case "failed":
      return `lyrics failed: ${outcome.reason}`;
    case "skipped":
      return `Lyrics skipped: ${LYRICS_SKIPS.find((skip) => skip.reason === outcome.reason)?.has ?? outcome.reason}`;
  }
}

/** How one song came out of the batch. A cancelled song is not listed: it is left as it was. */
export type BatchOutcome =
  | { id: string; title: string; status: "analysed"; tempoChange: WriteBack["tempoChange"]; noBeat: boolean; lyrics: LyricsOutcome | null }
  | { id: string; title: string; status: "lyrics"; lyrics: LyricsOutcome }
  | { id: string; title: string; status: "current" }
  | { id: string; title: string; status: "skipped"; reason: "open" }
  | { id: string; title: string; status: "failed"; reason: string };

/**
 * The progress of a batch. `step` is null until the first step of the song starts. `stepIndex` counts the steps the song has finished
 * and `steps` is how many it runs, so the caller can show how far through the song the batch is.
 */
export interface BatchProgress {
  index: number;
  total: number;
  title: string;
  step: string | null;
  stepIndex: number;
  steps: number;
}

/** What the batch tells its caller as it runs. Every callback is optional. */
export interface BatchCallbacks {
  /** Called before each song's first step, and as each step starts. */
  onProgress?(progress: BatchProgress): void;
  /** Called with true when the batch starts waiting for playback to stop, and with false when it goes on. */
  onWaiting?(waiting: boolean): void;
  /** Called before a song's audio is loaded. */
  onLoading?(title: string): void;
  /** Called after each song in the run, with how it came out. */
  onSongDone?(outcome: BatchOutcome): void;
}

/** What the batch needs from the app. The library, the playback and the steps all arrive through here, so the loop has no imports from them. */
export interface BatchDeps {
  /** Loads a saved song's mix and stems, without opening it. */
  load(id: string): Promise<{ source: PcmAudio; stems: Stems }>;
  /** Whether the song is open on the Performance screen right now. */
  isOpen(id: string): boolean;
  /** Whether audio is playing, or a playlist is. */
  playing(): boolean;
  /** Calls `listener` when playback starts or stops. Returns a function that stops the listening. */
  onPlayingChange(listener: (playing: boolean) => void): () => void;
  /**
   * The analysis steps for the given ids, in the order they run, then the lyrics step when `lyrics` is given. `onGrid` receives the beat grid
   * the tempo step tracks, and `gridOf` gives the grid the sections step should use: the one just tracked, or the one saved with the song.
   */
  steps(
    ids: readonly BatchStepId[],
    onGrid: (grid: BeatGrid) => void,
    gridOf: () => BeatGrid | null,
    lyrics: LyricsStepInput | null,
  ): AnalysisStep[];
  /** Writes the settings of a saved song through the library's settings writers. Not the song store. */
  write(id: string, values: Record<string, string>): void;
}

/**
 * Waits until nothing is playing, or the batch is cancelled. A playing song holds the batch, so no audio is decoded during playback.
 * `onWaiting` is told when the wait starts and when it ends, so the caller can say why nothing is happening.
 */
function whenIdle(deps: BatchDeps, signal: AbortSignal, onWaiting?: (waiting: boolean) => void): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || !deps.playing()) return resolve();
    onWaiting?.(true);
    const finish = () => {
      stopListening();
      signal.removeEventListener("abort", finish);
      onWaiting?.(false);
      resolve();
    };
    const stopListening = deps.onPlayingChange((playing) => {
      if (!playing) finish();
    });
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Analyses the songs one at a time and writes each result back to its saved song. Playback pauses the batch between steps, and the song
 * resumes from the step it stopped at once playback stops. Cancelling stops after the current step and leaves the songs not reached as
 * they were. The callbacks are told as the batch runs (see BatchCallbacks).
 */
export async function runAnalysisBatch(
  songs: readonly BatchSong[],
  options: BatchOptions,
  deps: BatchDeps,
  signal: AbortSignal,
  callbacks: BatchCallbacks = {},
): Promise<BatchOutcome[]> {
  const { run, openSkipped } = selectSongs(songs, options);
  const outcomes: BatchOutcome[] = openSkipped.map((song) => ({ id: song.id, title: song.title, status: "skipped", reason: "open" }));
  for (const [index, song] of run.entries()) {
    if (signal.aborted) break;
    if (deps.isOpen(song.id)) {
      const skipped: BatchOutcome = { id: song.id, title: song.title, status: "skipped", reason: "open" };
      outcomes.push(skipped);
      callbacks.onSongDone?.(skipped);
      continue;
    }
    await whenIdle(deps, signal, callbacks.onWaiting);
    if (signal.aborted) break;
    const progress = (step: string | null, stepIndex: number, steps: number) =>
      callbacks.onProgress?.({ index, total: run.length, title: song.title, step, stepIndex, steps });
    progress(null, 0, stepsFor(song, options).length);
    const outcome = await analyseOne(song, options, deps, signal, { progress, loading: callbacks.onLoading, waiting: callbacks.onWaiting });
    if (!outcome) break;
    outcomes.push(outcome);
    callbacks.onSongDone?.(outcome);
  }
  return outcomes;
}

/** What `analyseOne` tells the batch as a song runs: its step, the load, and the waits for playback. */
interface SongHooks {
  progress(step: string | null, stepIndex: number, steps: number): void;
  loading?(title: string): void;
  waiting?(waiting: boolean): void;
}

/** Analyses one song. Returns null when the batch was cancelled, so the song is left as it was. */
async function analyseOne(song: BatchSong, options: BatchOptions, deps: BatchDeps, signal: AbortSignal, hooks: SongHooks): Promise<BatchOutcome | null> {
  let loaded: { source: PcmAudio; stems: Stems };
  hooks.loading?.(song.title);
  try {
    loaded = await deps.load(song.id);
  } catch (e) {
    return { id: song.id, title: song.title, status: "failed", reason: e instanceof Error ? e.message : "Could not read the song's audio." };
  }
  const { source: mix, stems } = loaded;
  const saved = parseOptions(song.settings[":options"]);
  const audio = buildAnalysisAudio({
    mix,
    stems,
    beatsPerBar: typeof saved.beats === "number" ? saved.beats : 4,
    chordChanges: chartChordTimes(parseChart(song.settings[""] ?? "")),
    chordChoice: chosenChordStem(saved, stems),
    chordName: chordNameFor(saved, stems),
    sections: sectionBoundsOf(saved.sections),
  });
  // The lyrics step is decided from the chart before the run, so a chart that the batch may not replace is never transcribed.
  const ids = stepsFor(song, options);
  const lyricsOn = ids.includes("lyrics");
  const lyrics = options.lyrics ?? DEFAULT_LYRICS_BATCH;
  const action = lyricsOn ? lyricsAction(song, lyrics) : null;
  // With the analysis not needed (only songs that need it), the saved analysis is kept and only the lyrics step runs.
  const analysisIds = ids.filter((id) => id !== "lyrics");
  const runAnalysis = analysisIds.length > 0 && (!options.onlyNeeded || needsAnalysis(song));
  // A chart the lyrics step leaves alone says why, so the song is not reported as simply up to date.
  const skip: LyricsSkip | null = lyricsOn && !action ? lyricsSkip(song, lyrics) : null;
  const skipped: LyricsOutcome | null = skip ? { kind: "skipped", reason: skip } : null;
  if (!runAnalysis && !action) {
    if (skipped) return { id: song.id, title: song.title, status: "lyrics", lyrics: skipped };
    return { id: song.id, title: song.title, status: "current" };
  }
  const lyricsOptions: LyricsOptions = { model: lyrics.model, quality: lyrics.quality, language: languageOf(saved) };
  // The captures are held in objects: the steps and the store fill them in from callbacks, which TypeScript cannot follow.
  const captured: { grid: BeatGrid | null; analysis: SongAnalysis | null; lyrics: string | null; lyricsError: string | null; step: { index: number; name: string } } = {
    grid: null,
    analysis: null,
    lyrics: null,
    lyricsError: null,
    step: { index: 0, name: "" },
  };
  const steps = deps.steps(
    runAnalysis ? analysisIds : [],
    (found) => (captured.grid = found),
    () => captured.grid ?? parseBeatGrid(saved.beatGrid),
    action
      ? {
          options: lyricsOptions,
          pasted: action.kind === "retime" ? action.lines : undefined,
          onText: (text) => (captured.lyrics = text),
          // The transcriber's status (a model download, the CPU fallback) replaces the step's name while it lasts.
          onStatus: (status) => hooks.progress(lyricsStepText(status), captured.step.index, steps.length),
          onError: (reason) => (captured.lyricsError = reason),
        }
      : null,
  );
  const base = {
    audioId: songAudioId(mix, stems, generatedTrackKeysIn(saved)),
    audio,
    steps,
    settings: {
      read: () => parseAnalysis(saved.analysis),
      write: (analysis: SongAnalysis) => (captured.analysis = analysis),
    },
    // Lyrics-only songs keep their saved analysis, so the run starts from it and nothing is recomputed.
    force: !options.onlyNeeded || !runAnalysis,
    partial: runAnalysis ? undefined : (parseAnalysis(saved.analysis) ?? undefined),
    onStep: (index: number, name: string) => {
      captured.step = { index, name };
      hooks.progress(name, index, steps.length);
    },
  };
  // Playback interrupts the run between steps; the run resumes from the step it stopped at once playback stops. Cancelling stops the
  // run with its reason, and nothing is written.
  let run: AbortController = new AbortController();
  const unsubscribe = deps.onPlayingChange((playing) => {
    if (playing) run.abort(PLAYBACK_INTERRUPT);
  });
  const cancel = () => run.abort("cancel");
  signal.addEventListener("abort", cancel, { once: true });
  let outcome: AnalysisOutcome | null = null;
  let resume: { from: number; partial: SongAnalysis } | null = null;
  try {
    for (;;) {
      run = new AbortController();
      if (signal.aborted) run.abort("cancel");
      outcome = await runSongAnalysis({ ...base, ...(resume ? { from: resume.from, partial: resume.partial } : {}), signal: run.signal });
      if (outcome.status !== "interrupted" || signal.aborted) break;
      await whenIdle(deps, signal, hooks.waiting);
      if (signal.aborted) break;
      resume = { from: outcome.next, partial: outcome.analysis };
    }
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", cancel);
  }
  if (signal.aborted || !outcome || outcome.status !== "complete") return null;
  if (deps.isOpen(song.id)) return { id: song.id, title: song.title, status: "skipped", reason: "open" };
  const lyricsOutcome: LyricsOutcome | null = !lyricsOn
    ? null
    : !action
      ? skipped
      : captured.lyricsError !== null
        ? { kind: "failed", reason: captured.lyricsError }
        : captured.lyrics === null
          ? { kind: "none" }
          : { kind: action.kind === "retime" ? "timed" : "made" };
  // Only a run that really analysed the song writes its analysis. A current analysis is not run again, so it is not written again.
  const analysis = runAnalysis ? captured.analysis : null;
  const lyricsWrite: LyricsWrite | null =
    action && captured.lyrics !== null
      ? { text: captured.lyrics, source: action.kind === "retime" ? "aligned" : "transcribed", made: lyricsMadeRecord(lyricsOptions, new Date().toISOString()) }
      : null;
  if (!analysis && !lyricsWrite) {
    if (!runAnalysis) return { id: song.id, title: song.title, status: "lyrics", lyrics: lyricsOutcome ?? { kind: "none" } };
    return { id: song.id, title: song.title, status: "current" };
  }
  const plan = planWriteBack(song, analysis, captured.grid, options.replaceManual, lyricsWrite);
  deps.write(song.id, plan.values);
  if (!runAnalysis) return { id: song.id, title: song.title, status: "lyrics", lyrics: lyricsOutcome ?? { kind: "none" } };
  return { id: song.id, title: song.title, status: "analysed", tempoChange: plan.tempoChange, noBeat: !!analysis && !analysis.tempo, lyrics: lyricsOutcome };
}

/** The language a song's lyrics are transcribed in, from its options. Unknown values read as automatic. */
function languageOf(saved: Record<string, unknown>): LyricsLanguage {
  return LYRIC_LANGUAGES.find((value) => value === saved.lyricsLanguage) ?? "auto";
}

/** The chord stem the performer chose for a song, when the stem is in the song. Empty otherwise. */
function chosenChordStem(options: Record<string, unknown>, stems: Stems): StemName | "" {
  const chosen = options.chordChoice;
  return typeof chosen === "string" && chosen && stems[chosen as StemName] ? (chosen as StemName) : "";
}

/** The chord stem a song uses: its own choice when the stem is in the song, else the first stem with a signal. */
function chordNameFor(options: Record<string, unknown>, stems: Stems): StemName | "" {
  return chosenChordStem(options, stems) || defaultChordSource(stems);
}

/** One line for the summary: what the batch changed, and what it could not do. */
export function describeBatch(outcomes: readonly BatchOutcome[]): string {
  const analysed = outcomes.filter((o): o is Extract<BatchOutcome, { status: "analysed" }> => o.status === "analysed");
  const changed = analysed.flatMap((o) => (o.tempoChange ? [`${o.title}: ${o.tempoChange.from} → ${o.tempoChange.to}`] : []));
  const parts = [`Analysed ${analysed.length} song${analysed.length === 1 ? "" : "s"}.`];
  if (changed.length) parts.push(`Tempo changed on ${changed.length} (${changed.join(", ")}).`);
  const noBeat = analysed.filter((o) => o.noBeat).length;
  if (noBeat) parts.push(`${noBeat} had no clear beat.`);
  const current = outcomes.filter((o) => o.status === "current").length;
  if (current) parts.push(`${current} already up to date.`);
  const open = outcomes.filter((o) => o.status === "skipped").length;
  if (open) parts.push(`${open} skipped (open).`);
  const lyrics = outcomes.flatMap((o) => (o.status === "analysed" || o.status === "lyrics" ? (o.lyrics ? [o.lyrics] : []) : []));
  if (lyrics.length) parts.push(describeLyricsSummary(lyrics));
  for (const f of outcomes) if (f.status === "failed") parts.push(`${f.title}: ${f.reason}`);
  for (const o of outcomes) {
    if ((o.status === "analysed" || o.status === "lyrics") && o.lyrics?.kind === "failed") parts.push(`${o.title}: ${describeLyricsOutcome(o.lyrics)}.`);
  }
  return parts.join(" ");
}

/**
 * The lyrics line of the summary: how many charts were made, timed, found empty, failed or skipped, and why the skipped ones were skipped.
 * "Lyrics: 0 transcribed, 6 skipped (from before 0.9.2)."
 */
function describeLyricsSummary(lyrics: readonly LyricsOutcome[]): string {
  const count = (kind: LyricsOutcome["kind"]) => lyrics.filter((l) => l.kind === kind).length;
  const parts = [`${count("made")} transcribed`];
  if (count("timed")) parts.push(`${count("timed")} timed`);
  if (count("none")) parts.push(`${count("none")} with no words heard`);
  if (count("failed")) parts.push(`${count("failed")} failed`);
  for (const { reason, label } of LYRICS_SKIPS) {
    const skipped = lyrics.filter((l) => l.kind === "skipped" && l.reason === reason).length;
    if (skipped) parts.push(`${skipped} skipped (${label})`);
  }
  return `Lyrics: ${parts.join(", ")}.`;
}

/**
 * The line the batch's status shows for the lyrics step while the transcriber runs. A model download reads as "downloading model 34%";
 * any other status is shown as the transcriber gives it.
 */
export function lyricsStepText(status: string): string {
  const download = /^Downloading lyrics model: (\d+)%/.exec(status);
  return download ? `lyrics: downloading model ${download[1]}%` : `lyrics: ${status}`;
}
