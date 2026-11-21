import { Button } from "@/components/ui/button";
import type { SongAnalysisControl } from "./use-song-analysis";

/** Whether a finished run's summary line reports a problem, so the Play view can show it without showing every success line. */
export function isFailure(message: string | null): boolean {
  return !!message && /fail|couldn.t|could not|error/i.test(message);
}

/**
 * The summary line with the song's own section count. The analysis counts the sections it detected, which is not the number on the
 * timeline. `count` is the song's; with none given the line stays as it is.
 */
export function withSongSections(message: string, count: number | undefined): string {
  if (count === undefined || count <= 0) return message;
  return message.replace(/\. \d+ sections?(?! key)/, `. ${count} section${count === 1 ? "" : "s"}`);
}

/**
 * What the song analysis found, or what it is doing, with Cancel while it runs and "Analyse again" after. In "This song" it is the first
 * card; in Play (`quiet`) it shows only while the analysis runs or after it failed.
 */
export function AnalysisCard({
  analysis,
  hasSong,
  analyseDisabled,
  onAnalyseAgain,
  quiet = false,
  sectionCount,
}: {
  analysis: Pick<SongAnalysisControl, "step" | "detecting" | "message" | "cancel">;
  hasSong: boolean;
  analyseDisabled: boolean;
  onAnalyseAgain: () => void;
  quiet?: boolean;
  /** How many sections the song has. The line shows this, and what the analysis detected is in the details. */
  sectionCount?: number;
}) {
  const running = !!analysis.step || analysis.detecting;
  if (!running && !analysis.message && !hasSong) return null;
  if (quiet && !running && !isFailure(analysis.message)) return null;
  const shown = analysis.message ? withSongSections(analysis.message, sectionCount) : analysis.message;
  const text = analysis.detecting ? "Detecting…" : analysis.step ? `Analysing the song: ${analysis.step}…` : shown;
  return (
    <section
      aria-label="Analysis"
      className={quiet ? "flex flex-wrap items-center gap-2 text-xs" : "flex flex-wrap items-center gap-2 rounded border border-seam p-3 text-sm"}
    >
      {!quiet && <h3 className="w-full text-sm font-semibold">Analysis</h3>}
      <p role="status" className="flex flex-wrap items-center gap-2">
        <span>{text ?? "Not analysed yet."}</span>
        {running ? (
          <Button variant="outline" size="sm" onClick={analysis.cancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={analyseDisabled} onClick={onAnalyseAgain}>
            Analyse again
          </Button>
        )}
      </p>
      {!running && !quiet && analysis.message && shown !== analysis.message && (
        <details className="w-full text-xs text-silkscreen-3">
          <summary className="cursor-pointer">Details</summary>
          <p>What the analysis detected: {analysis.message}</p>
        </details>
      )}
    </section>
  );
}
