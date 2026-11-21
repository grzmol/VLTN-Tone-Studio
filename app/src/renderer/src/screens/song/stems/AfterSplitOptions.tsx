import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { AFTER_SPLIT_STEPS, loadAfterSplit, saveAfterSplit, type AfterSplit } from "@/song/analysis/after-split";
import { songRunner } from "@/song/analysis/song-runner-app";
import { runStatusLine } from "@/song/analysis/run-status";
import { LYRIC_LANGUAGES, loadLyricsChoice, saveLyricsChoice, type LyricsChoice } from "@/song/performance/lyrics-options";
import { downloadMegabytes, findLyricsModel } from "@/song/performance/lyrics-models";
import { LyricsModelPicker } from "../LyricsModelPicker";

/** What the lyrics step costs, in words: the model's download once, and a few minutes a song. */
export function lyricsCost(choice: LyricsChoice): string {
  const model = findLyricsModel(choice.model);
  if (!model) return "";
  return `Lyrics with ${model.label}: about ${downloadMegabytes(model, false)} MB to download once, then a few minutes per song.`;
}

/**
 * The steps a new song is analysed with, under "After the split" on the Stems tab (spec 80). They run once the stems or the imported
 * audio are ready, without anything else being asked. Lyrics takes the model and quality chosen here, which is the same choice the
 * lyrics panel shows.
 */
export function AfterSplitOptions({ className }: { className?: string }) {
  const [after, setAfter] = useState<AfterSplit>(loadAfterSplit);
  const choice = after.steps;
  const [lyricsChoice, setLyricsChoice] = useState<LyricsChoice>(loadLyricsChoice);
  const busy = useSong((s) => s.status.kind === "decoding" || s.status.kind === "model" || s.status.kind === "splitting");

  const update = (next: AfterSplit) => {
    setAfter(next);
    saveAfterSplit(next);
  };
  const updateLyrics = (next: LyricsChoice) => {
    setLyricsChoice(next);
    saveLyricsChoice(next);
  };

  return (
    <div className={cn("flex flex-col gap-3 text-left", className)}>
      <div className="flex flex-col gap-1.5 rounded-lg border border-seam p-3">
        <p className="text-[13px] font-semibold text-silkscreen">After the split</p>
        <p className="text-[12px] text-silkscreen-3">Tone Studio works these out for the song as soon as its audio is ready.</p>
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
          {AFTER_SPLIT_STEPS.map((step) => {
            const id = `after-split-${step.id}`;
            return (
              <div key={step.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={choice[step.id]}
                  disabled={busy}
                  onCheckedChange={(on) => update({ ...after, steps: { ...choice, [step.id]: on === true } })}
                />
                <Label htmlFor={id} className="text-[13px]">
                  {step.label}
                </Label>
              </div>
            );
          })}
        </div>
        {choice.lyrics && (
          <div className="flex flex-col gap-2 pt-2">
            <LyricsModelPicker choice={lyricsChoice} disabled={busy} onChange={updateLyrics} />
            <label className="flex items-center gap-2 text-[13px]">
              <span>Language for a song that does not set its own</span>
              <select
                aria-label="Lyrics language"
                className="rounded border border-seam bg-transparent px-2 py-1 text-[13px]"
                value={after.language}
                disabled={busy}
                onChange={(e) => update({ ...after, language: LYRIC_LANGUAGES.find((value) => value === e.target.value) ?? "auto" })}
              >
                {LYRIC_LANGUAGES.map((value) => (
                  <option key={value} value={value}>
                    {value === "auto" ? "Detect automatically" : value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[12px] text-silkscreen-3">{lyricsCost(lyricsChoice)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Runs the chosen steps for a song that is already split or imported, keeping what the performer set. Disabled while a split or a playlist runs. */
export function AnalyseSongButton({ className }: { className?: string }) {
  const hasSong = useSong((s) => !!s.source);
  const busy = useSong((s) => s.status.kind === "decoding" || s.status.kind === "model" || s.status.kind === "splitting");
  const playing = useSongLibrary((s) => s.playlistPlaying);
  const analysing = songRunner.state((s) => s.step !== null);
  return (
    <Button className={className} variant="outline" size="sm" disabled={!hasSong || busy || playing || analysing} onClick={() => songRunner.analyseNow()}>
      Analyse this song now
    </Button>
  );
}

/** The open song's analysis as a line under the Stems tab, while it runs: the same words the status bar shows. */
export function RunStatus({ className }: { className?: string }) {
  const run = songRunner.state();
  if (!run.running) return null;
  return (
    <p className={cn("text-[12px] text-silkscreen-3", className)} role="status">
      {runStatusLine(run)}
    </p>
  );
}
