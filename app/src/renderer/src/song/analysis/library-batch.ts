// Connects the batch analysis (batch.ts) to the app: the saved songs' audio from the library, the open song and playback from the screen, the
// analysis steps, and the library's settings writers. The batch itself does not import any of these.

import { useSong } from "../store";
import { loadSongAudio, useSongLibrary } from "../library";
import { flushSettings, LIBRARY_PREFIX, setSetting } from "../performance/settings";
import { isSongPlaying, onSongPlayingChange } from "../performance/playing-state";
import { chordsStep, keyStep, loudnessStep, lyricsStep, partsStep, sectionKeysStep, sectionsStep, silenceStep, tempoStep, type LyricsStepInput } from "./steps";
import { runAnalysisBatch, type BatchCallbacks, type BatchDeps, type BatchOptions, type BatchOutcome, type BatchSong, type BatchStepId } from "./batch";
import type { AnalysisStep } from "./song-analysis";
import type { BeatGrid } from "../band/beat-grid";

/** The steps in the order the analysis runs them. The tempo step gives the beat grid to the batch, which saves it with the song. */
export function stepsFor(
  ids: readonly BatchStepId[],
  onGrid: (grid: BeatGrid) => void,
  gridOf: () => BeatGrid | null,
  lyrics: LyricsStepInput | null,
): AnalysisStep[] {
  const wanted = new Set<BatchStepId>(ids);
  // The sections of each key are read after the sections, so the key's section step follows the sections step.
  const ordered: [BatchStepId, () => AnalysisStep[]][] = [
    ["loudness", () => [loudnessStep()]],
    ["silence", () => [silenceStep()]],
    ["parts", () => [partsStep()]],
    ["tempo", () => [tempoStep(onGrid)]],
    ["chords", () => [chordsStep(gridOf, onGrid)]],
    ["key", () => [keyStep()]],
    ["sections", () => [sectionsStep(gridOf), ...(wanted.has("key") ? [sectionKeysStep()] : [])]],
  ];
  const steps = ordered.filter(([id]) => wanted.has(id)).flatMap(([, make]) => make());
  return lyrics ? [...steps, lyricsStep(lyrics)] : steps;
}

/** Whether a song or a playlist is playing. */
const playingNow = () => isSongPlaying() || useSongLibrary.getState().playlistPlaying;

/** The app's side of the batch: loads from the library, writes through the library's settings, and reads the open song and playback. */
export const libraryBatchDeps: BatchDeps = {
  load: (id) => loadSongAudio(id),
  isOpen: (id) => useSong.getState().source?.libraryId === id,
  playing: playingNow,
  // A playlist's flag counts as playing too, so a change to it reaches the listener as a song's start or stop does. That is what lets a
  // wait for a playlist end when the flag is cleared by hand ("Run anyway").
  onPlayingChange: (listener) => {
    const stopSong = onSongPlayingChange(listener);
    const stopPlaylist = useSongLibrary.subscribe((state, previous) => {
      if (state.playlistPlaying !== previous.playlistPlaying) listener(playingNow());
    });
    return () => {
      stopSong();
      stopPlaylist();
    };
  },
  steps: stepsFor,
  write: (id, values) => {
    const key = `${LIBRARY_PREFIX}${id}`;
    if (values[":bpm"] !== undefined) setSetting(key, ":bpm", values[":bpm"]);
    if (values[":lyrics"] !== undefined) setSetting(key, ":lyrics", values[":lyrics"]);
    setSetting(key, ":options", values[":options"]);
  },
};

/**
 * Analyses the given saved songs in turn, and then sends the settings they wrote to the library and refreshes the library's list. Refuse
 * to call this while a song plays: the caller checks first, so the batch never starts over the music.
 */
export async function runLibraryAnalysis(
  songs: readonly BatchSong[],
  options: BatchOptions,
  signal: AbortSignal,
  callbacks: BatchCallbacks = {},
): Promise<BatchOutcome[]> {
  try {
    return await runAnalysisBatch(songs, options, libraryBatchDeps, signal, callbacks);
  } finally {
    await flushSettings();
    await useSongLibrary.getState().refresh();
  }
}
