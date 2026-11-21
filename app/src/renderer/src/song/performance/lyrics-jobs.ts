import { create } from "zustand";
import type { PcmAudio } from "../types";
import { pastedLines } from "./lyrics-align";
import { LyricsCancelled, transcribeLyrics } from "./lyrics-run";
import { noSingingMessage } from "./lyrics-passes";
import { lyricsMadeRecord, saveLyricsChart } from "./lyrics-chart";
import { flushSettings } from "./settings";
import { type LyricsOptions } from "./lyrics-options";
import { lyricsOptions } from "./lyrics-song-options";

export interface LyricsJob {
  busy: boolean;
  status: string;
  error: string;
  text?: string;
}
export const useLyricsJobs = create<{ jobs: Record<string, LyricsJob> }>(() => ({ jobs: {} }));
interface Running {
  keys: Set<string>;
  abort: AbortController;
}
const running = new Map<string, Running>();
function update(task: Running, patch: Partial<LyricsJob>) {
  useLyricsJobs.setState((state) => ({ jobs: { ...state.jobs, ...Object.fromEntries([...task.keys].map((key) => [key, { ...state.jobs[key], ...patch }])) } }));
}
export function migrateLyricsJob(from: string, to: string) {
  const task = running.get(from);
  if (!task) return;
  task.keys.add(to);
  running.set(to, task);
  update(task, useLyricsJobs.getState().jobs[from]);
}
export function cancelLyrics(key: string) {
  const task = running.get(key);
  if (!task) return;
  task.abort.abort();
  update(task, { busy: false, status: "Transcription cancelled. Generate lyrics to retry." });
  for (const alias of task.keys) running.delete(alias);
}
/**
 * Jobs belong to the song, not a mounted tab. No pedal or MIDI access.
 * With `pasted` lyrics, the transcriber only times them: the chart keeps the pasted words and gets the heard timings.
 */
export async function generateLyrics(key: string, audio: PcmAudio, options: LyricsOptions = lyricsOptions(key), pasted?: string): Promise<void> {
  if (running.has(key)) return;
  const lines = pasted === undefined ? undefined : pastedLines(pasted);
  if (lines && !lines.some(Boolean)) {
    useLyricsJobs.setState((state) => ({ jobs: { ...state.jobs, [key]: { busy: false, status: "", error: "Paste some lyrics to time first." } } }));
    return;
  }
  const task: Running = { keys: new Set([key]), abort: new AbortController() };
  running.set(key, task);
  update(task, { busy: true, status: "Preparing vocals…", error: "" });
  const finish = () => {
    for (const alias of task.keys) running.delete(alias);
    update(task, { busy: false });
  };
  try {
    const result = await transcribeLyrics({
      audio,
      options,
      pasted: lines,
      signal: task.abort.signal,
      onStatus: (status) => update(task, { status }),
    });
    if (!result.text) {
      update(task, {
        status: lines
          ? "No words to time in the vocals. Check the pasted lyrics."
          : result.diagnostic
            ? noSingingMessage(result.diagnostic)
            : "No singing found in the vocals. Import or type lyrics, or retry transcription.",
      });
      finish();
      return;
    }
    if (task.abort.signal.aborted) return;
    const status = lines
      ? result.placed
        ? `Lyrics timed to the vocals. ${result.placed} line${result.placed === 1 ? "" : "s"} with no heard words sit between their neighbours.`
        : "Lyrics timed to the vocals."
      : "Lyrics ready. Review the words and timing while listening.";
    update(task, { text: result.text, status });
    try {
      const made = lyricsMadeRecord(options, new Date().toISOString());
      for (const alias of task.keys) saveLyricsChart(alias, { text: result.text, source: lines ? "aligned" : "transcribed", made });
      await flushSettings();
    } catch (e) {
      update(task, { error: `${lines ? "Lyrics timed" : "Lyrics generated"}, but saving failed: ${String(e)}. Export a copy.` });
    }
    finish();
  } catch (e) {
    // A cancelled run was already reported by cancelLyrics.
    if (!(e instanceof LyricsCancelled)) {
      update(task, { error: String(e), status: "" });
      finish();
    }
  }
}
