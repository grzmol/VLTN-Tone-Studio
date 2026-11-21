// Analyses saved songs from the Library without opening them (spec 72). The dialog picks the steps and the songs, and starts the run as a
// job (spec 77). The job keeps going when the dialog is closed, so the dialog shows the live run, or its summary, whenever it is opened.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { isRunning, useAnalysisJob } from "@/song/analysis/analysis-job";
import {
  BATCH_STEPS,
  defaultChoice,
  describeLyricsPlan,
  lyricsPlan,
  selectSongs,
  type BatchChoice,
  type BatchOutcome,
  type BatchSong,
  type LyricsWhich,
} from "@/song/analysis/batch";
import { loadLyricsChoice, type LyricsChoice } from "@/song/performance/lyrics-options";
import { LyricsBatchSettings } from "./LyricsBatchSettings";
import { AnalysisJobProgress } from "./AnalysisJobProgress";

export interface AnalyseSongsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The saved songs the dialog analyses: the selection, or the whole library. */
  songs: readonly BatchSong[];
}

export function AnalyseSongsDialog({ open, onOpenChange, songs }: AnalyseSongsDialogProps) {
  const openId = useSong((s) => s.source?.libraryId ?? null);
  const job = useAnalysisJob();
  const running = isRunning(job.phase);
  const ended = !running && job.phase !== "idle";
  const [choice, setChoice] = useState<BatchChoice>(defaultChoice);
  const [onlyNeeded, setOnlyNeeded] = useState(true);
  const [replaceManual, setReplaceManual] = useState(false);
  const [lyricsChoice, setLyricsChoice] = useState<LyricsChoice>(loadLyricsChoice);
  const [which, setWhich] = useState<LyricsWhich>("empty");
  const [retime, setRetime] = useState(true);
  const [unknown, setUnknown] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The elapsed time and the time left are shown while a run goes on, so the clock ticks once a second only while it is open and running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, open]);

  const lyrics = { ...lyricsChoice, which, retime, unknown };
  const options = { onlyNeeded, replaceManual, choice, openSongId: openId, lyrics };
  const { run } = selectSongs(songs, options);
  const plan = lyricsPlan(songs, lyrics, openId);
  const selectionText =
    `${songs.length} song${songs.length === 1 ? "" : "s"} in the selection. ${run.length} will be analysed. ` +
    "The open song is skipped. Each song is analysed without opening it.";
  const changed = job.outcomes.filter((o): o is Extract<BatchOutcome, { status: "analysed" }> => o.status === "analysed" && !!o.tempoChange);

  const start = () => {
    setProblem(useAnalysisJob.getState().start(songs, options));
  };

  const openSong = (id: string) => {
    void useSongLibrary.getState().load(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Analyse saved songs</DialogTitle>
          <DialogDescription>
            {running ? "The analysis keeps going if you close this. Its progress shows in the status bar." : selectionText}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {BATCH_STEPS.map((step) => (
            <label key={step.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={choice[step.id]} disabled={running} onCheckedChange={(value) => setChoice({ ...choice, [step.id]: value === true })} />
              <span>{step.label}</span>
            </label>
          ))}
          {choice.lyrics && (
            <LyricsBatchSettings
              choice={lyricsChoice}
              onChoice={setLyricsChoice}
              which={which}
              onWhich={setWhich}
              retime={retime}
              onRetime={setRetime}
              unknown={unknown}
              onUnknown={setUnknown}
              plan={describeLyricsPlan(plan, lyrics)}
              disabled={running}
              songs={plan.run}
            />
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyNeeded} disabled={running} onCheckedChange={(value) => setOnlyNeeded(value === true)} />
            <span>Only songs that need it</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={replaceManual} disabled={running} onCheckedChange={(value) => setReplaceManual(value === true)} />
            <span>Replace tempos I set by hand</span>
          </label>
        </div>
        {running && <AnalysisJobProgress job={job} now={now} />}
        {problem && (
          <p role="status" className="text-sm text-red-400">
            {problem}
          </p>
        )}
        {ended && (
          <div className="space-y-2 text-sm">
            {job.error ? (
              <p role="alert" className="text-red-400">
                {job.error}
              </p>
            ) : (
              <p role="status">{job.summary}</p>
            )}
            {changed.map((o) => (
              <p key={o.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {o.title}: {o.tempoChange?.from} → {o.tempoChange?.to}
                </span>
                <Button variant="outline" size="sm" onClick={() => openSong(o.id)}>
                  Open
                </Button>
              </p>
            ))}
          </div>
        )}
        <DialogFooter>
          {running ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Run in background
              </Button>
              {job.phase === "waiting" && job.waitingFor === "playlist" && (
                <Button variant="outline" onClick={() => job.releaseWait()}>
                  Run anyway
                </Button>
              )}
              <Button variant="outline" onClick={() => job.stop()}>
                Stop
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  if (ended) useAnalysisJob.getState().dismiss();
                  onOpenChange(false);
                }}
              >
                {ended ? "Done" : "Close"}
              </Button>
              <Button disabled={run.length === 0} onClick={start}>
                Analyse {run.length} song{run.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
