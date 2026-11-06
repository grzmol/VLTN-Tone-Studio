// The progress of a saved-song analysis run (spec 77), as the Analyse dialog shows it: a bar, the song and step, what it waits for, the time
// left, and a line for each finished song. The clock is passed in, so this stays a plain view of the job.

import { Progress } from "@/components/ui/progress";
import { describeTimeLeft, jobFraction, secondsLeft, type AnalysisJobState } from "@/song/analysis/analysis-job";
import { describeLyricsOutcome, type BatchOutcome } from "@/song/analysis/batch";

/** One line for a finished song: its tempo change, its lyrics, or why it was left alone. */
export function describeOutcome(outcome: BatchOutcome): string {
  switch (outcome.status) {
    case "analysed": {
      const tempo = outcome.noBeat ? "no clear beat" : outcome.tempoChange ? `${outcome.tempoChange.from} → ${outcome.tempoChange.to}` : "tempo unchanged";
      return outcome.lyrics ? `${tempo}; ${describeLyricsOutcome(outcome.lyrics)}` : tempo;
    }
    case "lyrics":
      return describeLyricsOutcome(outcome.lyrics);
    case "current":
      return "up to date";
    case "skipped":
      return "open, skipped";
    case "failed":
      return `failed: ${outcome.reason}`;
  }
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AnalysisJobProgress({ job, now }: { job: AnalysisJobState; now: number }) {
  const left = job.startedAt === null ? null : secondsLeft(now, job.startedAt, job.done, job.total);
  const elapsed = job.startedAt === null ? 0 : Math.floor((now - job.startedAt) / 1000);
  const current = job.current;
  const position = `Song ${Math.min(job.done + 1, job.total)} of ${job.total}`;
  const step = current && current.steps > 0 ? ` · step ${current.stepIndex + 1} of ${current.steps}${current.step ? ` (${current.step})` : ""}` : "";
  const waiting = job.waitingFor === "song" ? "Waiting for playback to stop." : "Waiting for the playlist to stop.";
  return (
    <div className="space-y-2 text-sm">
      <Progress value={Math.round(jobFraction(job) * 100)} aria-label="Analysis progress" />
      <p role="status">
        {position}
        {step}
        {current?.title && job.phase !== "loading" ? `: ${current.title}` : ""}
      </p>
      {job.phase === "waiting" && <p className="text-silkscreen-3">{waiting}</p>}
      {job.phase === "loading" && <p className="text-silkscreen-3">Loading {current?.title}…</p>}
      <p className="text-xs text-silkscreen-3">
        Elapsed {clock(elapsed)}
        {left !== null ? ` · ${describeTimeLeft(left)} left` : ""}
      </p>
      {job.outcomes.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-auto">
          {job.outcomes.map((outcome) => (
            <li key={outcome.id}>
              {outcome.title}: {describeOutcome(outcome)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
