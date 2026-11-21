// The open song's analysis in the status bar (spec 80). While a run goes on it shows the song, the step and its place in the run, or
// that it waits for playback to stop. For a while after the run ends it shows the summary. A click opens the song's Performance tab.
// The Library's batch has the status bar to itself: its chip (AnalysisChip) shows while it runs.

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { isRunning, useAnalysisJob } from "@/song/analysis/analysis-job";
import { runStatusLine, runSummaryLine } from "@/song/analysis/run-status";
import { songRunner } from "@/song/analysis/song-runner-app";
import { useNav } from "@/state/nav";

/** How long the summary stays in the status bar after a run ends. */
export const RUN_SUMMARY_MS = 15_000;

export function SongRunChip() {
  const run = songRunner.state();
  const batch = isRunning(useAnalysisJob((s) => s.phase));
  const [, tick] = useState(0);
  const recent = run.endedAt !== null && Date.now() - run.endedAt < RUN_SUMMARY_MS;

  // The summary leaves the bar on its own, so the bar is drawn again when its time is up.
  useEffect(() => {
    if (run.endedAt === null) return;
    const left = RUN_SUMMARY_MS - (Date.now() - run.endedAt);
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [run.endedAt]);

  if (batch || (!run.running && !recent)) return null;

  const open = () => useNav.getState().go("song", "performance");
  const text = run.running ? runStatusLine(run) : runSummaryLine(run.title, run.message);
  const percent = run.running && run.steps ? Math.round(((run.stepIndex + 1) / run.steps) * 100) : 100;

  return (
    <button type="button" onClick={open} className="flex min-w-0 max-w-[45%] shrink items-center gap-2 text-left hover:text-silkscreen-1">
      <span className={cn("size-[7px] shrink-0 rounded-full", run.running ? "bg-led-warn" : "bg-led-on")} aria-hidden />
      <span className="truncate">{text}</span>
      {run.running && <Progress className="w-16 shrink-0" value={percent} aria-label="Song analysis progress" />}
    </button>
  );
}
