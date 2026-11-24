import { ArrangementAdvice } from "./ArrangementAdvice";
import { PlaylistPreflightIssues } from "./PlaylistPreflightIssues";
import { PreparationSequenceDetails, preparationSeconds } from "./PreparationSequenceDetails";
import { usePreparationDefaults } from "@/song/performance/start-preparation";
import { readLeadInDefaults } from "@/song/performance/lead-in";
import { useEffect, useRef, useState } from "react";
import { isRenderedAhead } from "@/song/library";
import { host } from "@/host";
import { Button } from "@/components/ui/button";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { configuredPedals, usePedalLibrary } from "@/song/performance/pedal-library";
import { playlistPreflight, type PlaylistCheck } from "@/song/performance/playlist-preflight";
import { songEntries } from "@/song/performance/song-triggers";
import type { LibrarySong } from "@shared/song-library";
import { rhythmControlOverrides } from "@/song/performance/rhythm-automation";
import { flushSettings, onSettingsChange, LIBRARY_PREFIX } from "@/song/performance/settings";
export function PlaylistPreflight({ ids, disabled, revision, songs }: { ids: string[]; disabled: boolean; revision: unknown; songs: readonly LibrarySong[] }) {
  const preparationDefaults = usePreparationDefaults((state) => state.settings);
  const config = useMidiConfiguration(),
    pedals = usePedalLibrary();
  const [report, setReport] = useState<PlaylistCheck[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const checked = useRef(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const order = JSON.stringify(ids);
  useEffect(
    () =>
      onSettingsChange((key) => {
        if (key === "vltn.performance.leadin.v1" || ids.some((id) => key === LIBRARY_PREFIX + id)) setSettingsVersion((version) => version + 1);
      }),
    [order],
  );
  useEffect(() => {
    generation.current++;
    setReport(null);
    setError("");
    setBusy(false);
    if (checked.current) void check();
    return () => {
      generation.current++;
    };
  }, [
    order,
    revision,
    settingsVersion,
    preparationDefaults,
    config.tempoOnStart,
    config.tempoChannel,
    config.output,
    config.macros,
    config.bindings,
    pedals.channels,
    pedals.assignments,
    pedals.profiles,
  ]);
  const check = async () => {
    checked.current = true;
    const request = ++generation.current;
    setBusy(true);
    setReport(null);
    setError("");
    try {
      await flushSettings();
      const snapshot = await host.song.library!.preflight(ids);
      if (request !== generation.current) return;
      setReport(
        playlistPreflight(ids, snapshot, {
          preparationDefaults,
          leadInDefaults: readLeadInDefaults(),
          tempoOnStart: config.tempoOnStart,
          tempoChannel: config.tempoChannel,
          outputName: config.output?.name,
          renderReady: isRenderedAhead,
          macros: config.macros,
          songs: songEntries(songs),
          bindings: config.bindings,
          pedals: configuredPedals(pedals),
          rhythmControls: rhythmControlOverrides(pedals),
        }),
      );
    } catch (e) {
      if (request === generation.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  return (
    <section aria-label="Playlist preflight" className="my-3 space-y-2 rounded border border-seam p-3">
      <Button variant="outline" disabled={disabled || busy || !ids.length} onClick={() => void check()}>
        {busy ? "Checking playlist…" : "Check playlist"}
      </Button>
      <p className="text-xs text-silkscreen-3">
        Checks saved audio files, charts, MIDI channels, tempo and Before song preparation for every entry. Save song changes first. No playback or MIDI is
        sent. Output preferences do not confirm a connected pedal.
      </p>
      {busy && <p role="status">Checking saved files without loading audio into memory…</p>}
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p role="status">
            {report.length} entries checked · {report.reduce((n, r) => n + r.errors.length, 0)} errors · {report.reduce((n, r) => n + r.warnings.length, 0)}{" "}
            performance warnings · {report.reduce((n, r) => n + r.advice.length, 0)} arrangement notes
          </p>
          <p className="text-xs">
            Snapshot of saved files and current MIDI preferences. Recheck after external file changes. File presence and size are checked, not audio contents or
            physical pedal response. Warnings are advisory.
          </p>
          <PlaylistPreflightIssues report={report} />
          <p aria-label="Playlist preparation total">
            Configured preparation waits: {preparationSeconds(report.reduce((total, result) => total + (result.preparation?.totalWaitMs ?? 0), 0))} s across{" "}
            {report.filter((result) => result.preparation).length} entries. Fresh song loads with Send cues enabled are assumed. Audio loading, MIDI delivery,
            start delay and count-in can add time; entries with errors need fixing first.
          </p>
          <ol className="max-h-80 space-y-2 overflow-auto">
            {report.map((r) => (
              <li key={r.entry} className="rounded border border-seam p-2">
                <strong>
                  {r.entry}. {r.title}
                </strong>
                {r.preparation && (
                  <details className="my-2 rounded border border-seam p-2">
                    <summary className="cursor-pointer">
                      Before song: {preparationSeconds(r.preparation.totalWaitMs)} s · {r.preparation.steps.filter((step) => step.kind === "send").length}{" "}
                      command group{r.preparation.steps.filter((step) => step.kind === "send").length === 1 ? "" : "s"}
                    </summary>
                    <p className="my-2 text-xs">From the saved playable beginning, with fresh once-command history. Opening this preview sends nothing.</p>
                    <PreparationSequenceDetails plan={r.preparation} label={`Preparation steps for entry ${r.entry}`} />
                  </details>
                )}
                <p>
                  {r.errors.length} errors · {r.warnings.length} performance warnings
                </p>
                <ArrangementAdvice items={r.advice} />
                {r.notes.length > 0 && (
                  <ul>
                    {r.notes.map((text, index) => (
                      <li key={index} className="text-silkscreen-3">
                        Note: {text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
