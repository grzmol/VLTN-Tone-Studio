import { useMemo, useState } from "react";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { rigCheck } from "@/song/performance/rig-check";
import { rigFacts } from "@/song/performance/rig-facts";
import { useDevice } from "@/state/device";
import { useStageActivity } from "@/state/stage-activity";

const LEVEL_CLASS = { error: "text-red-400", warning: "text-amber-400", advice: "" } as const;

/** The connected GP-150 / GP-180's own MIDI settings against how the app drives it, with a button for each fix. */
export function PedalSettings({ clock }: { clock: boolean }) {
  const device = useDevice((s) => s.device);
  const status = useDevice((s) => s.status);
  const globals = useDevice((s) => s.globals);
  const library = usePedalLibrary();
  const output = useMidiConfiguration((s) => s.output);
  const tempoOnStart = useMidiConfiguration((s) => s.tempoOnStart);
  const playing = useStageActivity((s) => s.busy);
  const [error, setError] = useState("");
  const facts = useMemo(
    () => rigFacts({ device, status, globals }, library, { output, tempoOnStart }, clock),
    [device, status, globals, library.channels, library.profiles, output, tempoOnStart, clock],
  );
  const issues = useMemo(() => (facts ? rigCheck(facts) : null), [facts]);
  // Only a GP-150 or GP-180 has these settings. With no pedal connected there is nothing to read, so the check says how to get one.
  if (!issues) {
    if (device !== null && device !== "gp150" && device !== "gp180") return null;
    return (
      <section aria-label="Pedal settings" className="space-y-1">
        <h3 className="font-medium">Pedal settings</h3>
        <p>Connect the pedal in the editor to check its MIDI settings.</p>
      </section>
    );
  }
  return (
    <section aria-label="Pedal settings" className="space-y-1">
      <h3 className="font-medium">Pedal settings</h3>
      {issues.length === 0 ? (
        <p>The pedal's MIDI settings agree with the app.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5">
          {issues.map((issue) => (
            <li key={issue.code} className={LEVEL_CLASS[issue.level]}>
              {issue.text}
              {issue.fix && (
                <>
                  {" "}
                  <button
                    className="rounded border border-seam px-2 py-0.5 disabled:opacity-50"
                    disabled={playing}
                    onClick={() => {
                      try {
                        setError("");
                        useDevice.getState().setGlobal(issue.fix!.name, issue.fix!.value);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    {issue.fix.label}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {playing && issues.some((issue) => issue.fix) && <p className="text-xs">Stop the song to change pedal settings</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
