// The app's song runner (spec 80): the open song from the song store and its saved settings, playback from the playing state, the playlist
// and the Library's batch, and the steps the open song's run takes. The runner itself (song-runner.ts) imports none of these.

import { useSong } from "../store";
import { useSongLibrary } from "../library";
import { isRunning, useAnalysisJob } from "./analysis-job";
import { chartChordTimes } from "../band/request";
import { parseChart } from "../performance/chart";
import { defaultChordSource } from "../performance/sources";
import { getSetting, performanceKey, readOptions, setSetting } from "../performance/settings";
import { isSongPlaying, onSongPlayingChange } from "../performance/playing-state";
import { LYRIC_LANGUAGES, loadLyricsChoice } from "../performance/lyrics-options";
import { readStoredBand } from "../band/stored";
import type { StemName } from "../types";
import { buildAnalysisAudio, sectionBoundsOf } from "./analysis-audio";
import { generatedTrackKeysIn, parseAnalysis, songAudioId, type AnalysisStep } from "./song-analysis";
import { lyricsSkipLabel, lyricsStepText } from "./batch";
import { lyricsRunSkip } from "./lyrics-run";
import { stemsWithVocals, vocalsOf } from "./vocals";
import { createSongRunner, isSplitting, watchSongStore, type CapturedRun, type RunOptions, type RunTarget, type SavedSong } from "./song-runner";
import { loadAfterSplit, type AfterSplitStep } from "./after-split";
import { bassLineStep, chordsStep, keyStep, loudnessStep, lyricsStep, partsStep, sectionKeysStep, sectionsStep, silenceStep, tempoStep } from "./steps";

/** A song is playing, or a playlist is. Nothing the runner does starts over the music. */
const playingNow = () => isSongPlaying() || useSongLibrary.getState().playlistPlaying;

/** The Library's batch is going. The open song's run waits for it, so two analyses never run at once. */
const batchRunning = () => isRunning(useAnalysisJob.getState().phase);

/** The store is loading or splitting a song. The analysis waits for the split, which is heavy work of its own. */
const splittingNow = () => isSplitting(useSong.getState().status.kind);

/** Whether a run must wait now: music plays, the batch runs, or the store is splitting. */
const busyNow = () => playingNow() || batchRunning() || splittingNow();

/** True while a run is analysing now, not waiting. The Library's batch will not start over it. */
export function songRunnerAnalysing(): boolean {
  const state = songRunner.state.getState();
  return state.running && !state.waiting;
}

/** The open song as a run sees it: its key, its audio at the meter given (or its own), and the chord stem chosen for it. */
function openTarget(beatsPerBar?: number): RunTarget | null {
  const { source, stems, tracks } = useSong.getState();
  if (!source) return null;
  const key = performanceKey(source);
  const options = readOptions<Record<string, unknown>>(key, {});
  const meter = beatsPerBar ?? (typeof options.beats === "number" ? options.beats : 4);
  const chordChoice = typeof options.chordChoice === "string" ? (options.chordChoice as StemName) : "";
  const chordName: StemName | "" = chordChoice && stems?.[chordChoice] ? chordChoice : defaultChordSource(stems);
  const built = buildAnalysisAudio({
    mix: source.audio,
    stems,
    beatsPerBar: meter,
    chordChanges: chartChordTimes(parseChart(getSetting(key, ""))),
    chordChoice,
    chordName,
    sections: sectionBoundsOf(options.sections),
  });
  // Lyrics read the vocals stem; an imported vocals track stands in for it when the song was not split.
  const audio = { ...built, stems: stemsWithVocals(built.stems, vocalsOf(stems, tracks)) };
  return { key, title: source.name, audioId: songAudioId(source.audio, stems, generatedTrackKeysIn(options)), audio };
}

/**
 * The lyrics step, when the run may transcribe the song's chart. A song with no vocals gets a line saying so, and a chart the run must
 * leave alone gets a line saying why. The language is the song's own, or the one chosen under After the split. The step's status
 * replaces the step name while the model downloads.
 */
function lyricsFor(key: string, captured: CapturedRun): AnalysisStep | null {
  const { source, stems, tracks } = useSong.getState();
  if (!source) return null;
  if (!vocalsOf(stems, tracks)) {
    captured.note = "Split the song to get lyrics.";
    return null;
  }
  const options = readOptions<Record<string, unknown>>(key, {});
  const saved = parseAnalysis(options.analysis);
  // A chart the run made for different audio belongs to the audio before a re-split; with no saved analysis it is kept.
  const audioChanged = !!saved && saved.audioId !== songAudioId(source.audio, stems, generatedTrackKeysIn(options));
  const skip = lyricsRunSkip(getSetting(key, ":lyrics"), options, audioChanged);
  if (skip) {
    captured.note = `Lyrics left as they are (${lyricsSkipLabel(skip)}).`;
    return null;
  }
  const own = LYRIC_LANGUAGES.find((language) => language === options.lyricsLanguage);
  captured.lyricsOptions = { ...loadLyricsChoice(), language: own ?? loadAfterSplit().language };
  return lyricsStep({
    options: captured.lyricsOptions,
    onText: (text) => (captured.lyrics = text),
    onStatus: (status) => songRunner.state.setState({ step: lyricsStepText(status) }),
    onError: (reason) => (captured.note = `Lyrics failed: ${reason}`),
  });
}

/**
 * The steps the open song's run takes, in the order the analysis runs them: only the ones ticked under "After the split", with lyrics
 * last. A detect takes the tempo (and the sections, for a find-the-beat) whatever is ticked, since its buttons are about the tempo.
 */
function appSteps(key: string, options: RunOptions, captured: CapturedRun): AnalysisStep[] {
  const tempo = tempoStep((grid) => (captured.grid = grid), options.hint ?? {});
  // The chords and the sections take the beat grid the tempo step tracked in this run, or else the one saved with the song.
  const gridOf = () => captured.grid ?? readStoredBand(key).grid ?? null;
  const chords = chordsStep(gridOf, (grid) => (captured.grid = grid));
  const bassLine = bassLineStep(gridOf);
  const sections = sectionsStep(gridOf);
  if (options.tempoOnly) return options.sections ? [tempo, sections] : [tempo];
  const wanted = loadAfterSplit().steps;
  const ordered: [AfterSplitStep, AnalysisStep[]][] = [
    ["loudness", [loudnessStep(), silenceStep()]],
    ["parts", [partsStep()]],
    ["tempo", [tempo]],
    ["chords", [chords, bassLine]],
    ["key", [keyStep()]],
    ["sections", [sections, ...(wanted.key ? [sectionKeysStep()] : [])]],
  ];
  const steps = ordered.filter(([id]) => wanted[id]).flatMap(([, made]) => made);
  const lyrics = wanted.lyrics ? lyricsFor(key, captured) : null;
  return lyrics ? [...steps, lyrics] : steps;
}

/** The app's runner. */
export const songRunner = createSongRunner({
  target: (beatsPerBar) => openTarget(beatsPerBar),
  audioId: () => {
    const { source, stems } = useSong.getState();
    return source ? songAudioId(source.audio, stems, generatedTrackKeysIn(readOptions<Record<string, unknown>>(performanceKey(source), {}))) : null;
  },
  read: (key): SavedSong => ({
    bpm: getSetting(key, ":bpm"),
    options: readOptions<Record<string, unknown>>(key, {}),
    chart: getSetting(key, ""),
    lyrics: getSetting(key, ":lyrics"),
  }),
  write: (key, values) => {
    if (values[":bpm"] !== undefined) setSetting(key, ":bpm", values[":bpm"]);
    if (values[":options"] !== undefined) setSetting(key, ":options", values[":options"]);
    if (values[":lyrics"] !== undefined) setSetting(key, ":lyrics", values[":lyrics"]);
  },
  steps: appSteps,
  busy: busyNow,
  onBusyChange: (listener) => {
    const notify = () => listener(busyNow());
    const stopSong = onSongPlayingChange(notify);
    const stopPlaylist = useSongLibrary.subscribe((state, previous) => {
      if (state.playlistPlaying !== previous.playlistPlaying) notify();
    });
    const stopBatch = useAnalysisJob.subscribe((state, previous) => {
      if (isRunning(state.phase) !== isRunning(previous.phase)) notify();
    });
    // Splitting is a store status: the run parks when a split starts and resumes only when no split is going.
    const stopSplit = useSong.subscribe((state, previous) => {
      if (isSplitting(state.status.kind) !== isSplitting(previous.status.kind)) notify();
    });
    return () => {
      stopSong();
      stopPlaylist();
      stopBatch();
      stopSplit();
    };
  },
  finished: (key, analysis) => {
    // A drums and bass check is kept on the store when the song has none yet, as the Performance screen did.
    const { source, missingParts } = useSong.getState();
    if (analysis.parts && !missingParts && source && performanceKey(source) === key) useSong.setState({ missingParts: analysis.parts });
  },
});

/**
 * Starts the automatic run when a file opens (its mix) or a split finishes (its stems). Returns the function that stops the watch. No
 * screen asks for the run: opening a song or finishing a split is what starts it.
 */
export function watchSongs(): () => void {
  return watchSongStore(useSong, () => songRunner.analyse());
}
