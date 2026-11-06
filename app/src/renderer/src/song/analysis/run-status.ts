// The words the status bar and the Stems tab show for the open song's analysis (spec 80). Pure, so the wording is tested on its own.

/** What the status line needs from a run: the song, the step it is on, and whether it waits. */
export interface RunProgress {
  title: string | null;
  step: string | null;
  stepIndex: number;
  steps: number;
  waiting: boolean;
}

/** "Analysing Song title: chords (3 of 8)", or what the run waits for. */
export function runStatusLine(run: RunProgress): string {
  const title = run.title ?? "the song";
  if (run.waiting) return `Analysing ${title}: waiting for playback to stop`;
  if (!run.step) return `Analysing ${title}`;
  const count = run.steps ? ` (${run.stepIndex + 1} of ${run.steps})` : "";
  return `Analysing ${title}: ${run.step}${count}`;
}

/** "Song title analysed: 98 BPM, E minor …", shown for a while once a run ends. */
export function runSummaryLine(title: string | null, message: string | null): string {
  return `${title ?? "The song"} analysed${message ? `: ${message}` : ""}`;
}
