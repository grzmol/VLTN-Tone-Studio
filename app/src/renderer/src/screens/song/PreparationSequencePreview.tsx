import { PreparationSequenceDetails, preparationSeconds } from "./PreparationSequenceDetails";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { configuredPedals, usePedalLibrary } from "@/song/performance/pedal-library";
import { preparationPreflight } from "@/song/performance/preparation-preflight";

/** The plan comes from the actual sender and reflects the current position, repeat history and automatic setup. */
export function PreparationSequencePreview({ session }: { session: PerformanceSession }) {
  const state = useSession(session, (value) => value);
  const pedals = usePedalLibrary();
  let plan,
    error = "";
  try {
    plan = session.preparationPreview();
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const issues = plan ? preparationPreflight(plan, configuredPedals(pedals)) : [];
  return (
    <section aria-label="Preparation sequence preview" className="space-y-2 rounded border border-seam p-3 text-sm">
      <h3 className="font-medium">{state.starting ? "Preparation in progress" : "Next preparation sequence"}</h3>
      {state.parseError || error ? (
        <p role="alert">{state.parseError || error}</p>
      ) : state.playing ? (
        <p>Pause playback to preview the next preparation.</p>
      ) : !plan ? (
        <p>Load a song and enable Before song preparation to see its sequence.</p>
      ) : (
        <>
          <p>
            Configured preparation time: <strong>{preparationSeconds(plan.totalWaitMs)} s</strong>. This includes per-command waits, gaps, loading and tempo
            settling. Audio preparation, MIDI delivery, start delay and count-in can add time.
          </p>
          {state.pedalsReady && <p>Play reuses the Ready setup. This preview shows what Prepare again will run.</p>}
          <PreparationSequenceDetails plan={plan} activeStep={state.preparing?.step} />
          {issues.length > 0 && (
            <ul aria-label="Preparation warnings" className="list-disc pl-5">
              {issues.map((issue, index) => (
                <li key={index}>Warning: {issue.text}</li>
              ))}
            </ul>
          )}
          <p>This is a read-only preview. Sending and wait completion do not confirm a pedal’s received settings.</p>
        </>
      )}
    </section>
  );
}
