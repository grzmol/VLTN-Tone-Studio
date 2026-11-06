// The Library's batch analysis as a job (spec 77). The run lives here, outside any component, so it keeps going when the Analyse dialog is
// closed or the user leaves the Song screen. The status bar, the Library line and the dialog all read the same state.

import { useEffect, useState } from "react";
import { create } from "zustand";
import { useSongLibrary } from "../library";
import { isSongPlaying } from "../performance/playing-state";
import { describeBatch, selectSongs, type BatchOptions, type BatchOutcome, type BatchSong } from "./batch";
import { runLibraryAnalysis } from "./library-batch";
import { songRunnerAnalysing } from "./song-runner-app";

/** Where the job is. `preparing` is set as soon as a run starts, so the first feedback shows before the first song loads. */
export type JobPhase = "idle" | "preparing" | "loading" | "analysing" | "waiting" | "finished" | "stopped" | "failed";

/** The song being analysed, and the step it is on. `steps` is 0 until the song's steps are known. */
export interface JobCurrent {
  title: string;
  step: string | null;
  stepIndex: number;
  steps: number;
}

export const PLAYING_REFUSAL = "Stop playback before analysing songs. The analysis would run while the music plays.";

export interface AnalysisJobState {
  phase: JobPhase;
  /** How many songs the run analyses. Songs left out by the choice, or skipped as open, are not counted. */
  total: number;
  /** How many songs have finished. */
  done: number;
  current: JobCurrent | null;
  startedAt: number | null;
  endedAt: number | null;
  /** The outcomes so far; the whole list once the run ends. */
  outcomes: BatchOutcome[];
  /** What the run changed, once it ends. */
  summary: string | null;
  error: string | null;
  /** What the run waits for while it is in the `waiting` phase: a playing song, or a playlist. */
  waitingFor: "song" | "playlist" | null;
  /** Set when the Library should open the dialog on this job. The Library clears it with `consumeOpenRequest`. */
  openRequested: boolean;
  /** Starts a run. Returns why it did not start, or null when it did. Only one run at a time, and never over playing music. */
  start(songs: readonly BatchSong[], options: BatchOptions): string | null;
  /** Stops the run after the current step. The songs already written stay written. */
  stop(): void;
  /** Clears an ended run's summary, so the dialog can start from a clean state. Does nothing while a run is going. */
  dismiss(): void;
  /**
   * Stops waiting for a playlist that is marked as playing when no song is. The flag can be left set by a playlist that stopped without
   * clearing it. Only the user calls this ("Run anyway"): a playlist also pauses between songs, when no song is playing for a moment.
   */
  releaseWait(): void;
  requestOpen(): void;
  consumeOpenRequest(): void;
}

/** The phases in which a run is going. */
export function isRunning(phase: JobPhase): boolean {
  return phase === "preparing" || phase === "loading" || phase === "analysing" || phase === "waiting";
}

/** How far through the run the job is, from 0 to 1: the songs finished, plus the share of the current song's steps done. */
export function jobFraction(state: Pick<AnalysisJobState, "total" | "done" | "current">): number {
  if (state.total === 0) return 0;
  const current = state.current && state.current.steps > 0 ? state.current.stepIndex / state.current.steps : 0;
  return Math.min(1, (state.done + current) / state.total);
}

/**
 * Seconds left, estimated from the average time per finished song. Null until the first song has finished, since there is nothing to
 * average yet.
 */
export function secondsLeft(now: number, startedAt: number, done: number, total: number): number | null {
  if (done === 0) return null;
  const perSong = (now - startedAt) / 1000 / done;
  return Math.max(0, Math.round(perSong * (total - done)));
}

/** The time left as the status bar and the dialog say it: "under a minute", or "about 4 min". */
export function describeTimeLeft(seconds: number): string {
  if (seconds < 60) return "under a minute";
  return `about ${Math.round(seconds / 60)} min`;
}

let controller: AbortController | null = null;

const playing = () => isSongPlaying() || useSongLibrary.getState().playlistPlaying;

const IDLE = {
  phase: "idle" as JobPhase,
  total: 0,
  done: 0,
  current: null,
  startedAt: null,
  endedAt: null,
  outcomes: [] as BatchOutcome[],
  summary: null,
  error: null,
  waitingFor: null,
};

export const useAnalysisJob = create<AnalysisJobState>((set, get) => ({
  ...IDLE,
  openRequested: false,
  start: (songs, options) => {
    if (isRunning(get().phase)) return "An analysis is already running.";
    if (songRunnerAnalysing()) return "A song is being analysed. Wait for it to finish, then analyse the Library.";
    if (playing()) return PLAYING_REFUSAL;
    const { run } = selectSongs(songs, options);
    const current = new AbortController();
    controller = current;
    set({ ...IDLE, phase: "preparing", total: run.length, startedAt: Date.now() });
    void runLibraryAnalysis(songs, options, current.signal, {
      onProgress: (progress) =>
        set({
          phase: "analysing",
          waitingFor: null,
          current: { title: progress.title, step: progress.step, stepIndex: progress.stepIndex, steps: progress.steps },
        }),
      onWaiting: (waiting) => set(waiting ? { phase: "waiting", waitingFor: isSongPlaying() ? "song" : "playlist" } : { phase: "analysing", waitingFor: null }),
      onLoading: (title) => set({ phase: "loading", current: { title, step: null, stepIndex: 0, steps: 0 } }),
      onSongDone: (outcome) => set((state) => ({ outcomes: [...state.outcomes, outcome], done: state.done + 1, current: null })),
    })
      .then((outcomes) => {
        const stopped = current.signal.aborted;
        const summary = describeBatch(outcomes) + (stopped ? " Stopped: the songs not reached were left as they were." : "");
        set({ phase: stopped ? "stopped" : "finished", outcomes, summary, current: null, waitingFor: null, endedAt: Date.now() });
      })
      .catch((e: unknown) => {
        set({
          phase: "failed",
          error: e instanceof Error ? e.message : "The analysis could not finish.",
          current: null,
          waitingFor: null,
          endedAt: Date.now(),
        });
      })
      .finally(() => {
        if (controller === current) controller = null;
      });
    return null;
  },
  stop: () => controller?.abort("cancel"),
  dismiss: () => {
    if (!isRunning(get().phase)) set({ ...IDLE });
  },
  releaseWait: () => {
    if (get().waitingFor !== "playlist" || isSongPlaying()) return;
    console.warn("The playlist is marked as playing, but no song is. Clearing the mark so the analysis can go on.");
    useSongLibrary.setState({ playlistPlaying: false });
  },
  requestOpen: () => set({ openRequested: true }),
  consumeOpenRequest: () => set({ openRequested: false }),
}));

/** The line that says what a run is doing now, for the status bar and the Library. */
export function jobLine(job: AnalysisJobState, now: number): string {
  const position = `${Math.min(job.done + 1, job.total)}/${job.total}`;
  if (job.phase === "waiting") return `Analysing songs: waiting for ${job.waitingFor === "song" ? "playback to stop" : "the playlist to stop"}`;
  if (job.phase === "loading" && job.current) return `Analysing songs: loading ${job.current.title}…`;
  if (job.phase === "preparing" || !job.current) return "Analysing songs…";
  const step = job.current.step ? ` (${job.current.step})` : "";
  const left = job.startedAt === null ? null : secondsLeft(now, job.startedAt, job.done, job.total);
  return `Analysing songs ${position} · ${job.current.title}${step}${left === null ? "" : ` · ${describeTimeLeft(left)} left`}`;
}

/** The time now, ticking once a second while `active`, so the time left and the elapsed time stay current on screen. */
export function useJobClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
