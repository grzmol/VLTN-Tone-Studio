// The Performance screen's view of the song runner (spec 80). The runs themselves are in song/analysis/song-runner-app.ts and do not need
// this screen: a run keeps going when the screen is closed. This hook reads the runner's state, and starts its user runs (Detect, Find the
// beat, Analyse again, a new meter). `revision` changes after every write, so the panel reloads its values from the settings.

import type { TempoHintOptions } from "@/song/band/beat-grid";
import { readOptions } from "@/song/performance/settings";
import { parseAnalysis, type SongAnalysis } from "@/song/analysis/song-analysis";
import { songRunner } from "@/song/analysis/song-runner-app";
import type { NoticeAction, RunNotice } from "@/song/analysis/song-runner";

export type { RunNotice as Notice };

/** The analysis saved in a song's options. Read only: the runner writes it. */
export function storedAnalysis(songKey: string): { read(): SongAnalysis | null } {
  return { read: () => parseAnalysis(readOptions<Record<string, unknown>>(songKey, {}).analysis) };
}

/** Whether the saved grid came from the analysis, so the analysis may replace it when the meter changes. */
export function gridFromAnalysis(songKey: string): boolean {
  return readOptions<Record<string, unknown>>(songKey, {}).beatGridSource === "analysis";
}

export interface SongAnalysisControl {
  /** The step being run, or null when idle. */
  step: string | null;
  /** True while the tempo is detected again, from the Detect button. */
  detecting: boolean;
  /** What the last finished run found, as one line. */
  message: string | null;
  /** Notices from the last finished run, with the buttons that change the song. */
  notices: RunNotice[];
  /** Changes after every write, so the panel reloads the values the run may have changed. */
  revision: number;
  /** Runs the analysis again with the meter given, so a grid laid out for the old meter is laid out again. Ignored during playback. */
  rerun(beatsPerBar?: number): void;
  /** Detects the tempo and meter again, replacing the saved ones. Ignored during playback. */
  detect(): void;
  /** Finds the beat again from a tempo the performer typed. Ignored during playback. */
  findBeat(hint: TempoHintOptions): void;
  /** Runs every step again, replacing the saved tempo and meter. Ignored during playback. */
  analyseAgain(): void;
  /** Presses one of a notice's buttons, such as Undo or Use it. */
  press(action: NoticeAction): void;
  /** Stops the run and drops it. The song is analysed again when it is next opened. */
  cancel(): void;
}

/** The song runner's state for the Performance screen. Holds no run of its own. */
export function useSongAnalysis(): SongAnalysisControl {
  const run = songRunner.state();
  return {
    step: run.step,
    detecting: run.detecting,
    message: run.message,
    notices: run.notices,
    revision: run.revision,
    rerun: (beatsPerBar) => songRunner.rerun(beatsPerBar),
    detect: () => songRunner.detect(),
    findBeat: (hint) => songRunner.findBeat(hint),
    analyseAgain: () => songRunner.analyseAgain(),
    press: (action) => songRunner.press(action.patch),
    cancel: () => songRunner.cancel(),
  };
}
