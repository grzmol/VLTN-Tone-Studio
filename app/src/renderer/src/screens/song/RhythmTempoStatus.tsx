import { useSession, selectOutput, type PerformanceSession } from "@/song/performance/session";
import { usePedalDrums } from "@/song/performance/pedal-drums";
/** The target and queued command are distinct from a measurement at the pedal. */
export function RhythmTempoStatus({ session }: { session: PerformanceSession }) {
  const bpm = useSession(session, (s) => s.bpm);
  const rhythmTempo = useSession(session, (s) => s.rhythmTempo);
  const rate = useSession(session, (s) => s.speed.rate);
  const enabled = useSession(session, (s) => s.tempoOnStart);
  const channel = useSession(session, (s) => s.tempoChannel);
  const last = useSession(session, (s) => s.lastTempo);
  const output = useSession(session, selectOutput);
  const pedalDrums = usePedalDrums((s) => s.enabled);
  const target = Math.round((rhythmTempo ?? bpm) * rate);
  return (
    <section aria-label="Pedal rhythm status" className="space-y-2 rounded border border-seam p-3 text-sm">
      <p>
        Song pulse tempo: {bpm} BPM. Clock target: {target} quarter-note BPM via {output?.name ?? "no output"}, channel {channel}.
      </p>
      <p>{enabled ? "Tempo will be sent on playback start." : "Automatic GP tempo is off; match the external clock before playing."}</p>
      {enabled && (target < 40 || target > 300) && <p role="alert">GP tempo must be between 40 and 300 quarter-note BPM at this playback speed.</p>}
      <p>
        {last
          ? `Last tempo command queued: ${last.bpm} BPM to ${last.output}, channel ${last.channel}.`
          : "No tempo command has been queued in this song session."}{" "}
        Pedal BPM has not been measured.
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={pedalDrums} onChange={(e) => usePedalDrums.getState().set(e.target.checked)} />
        Use pedal drums in every song
      </label>
      <p>Silences the app’s drum tracks without changing saved mixes. A mixed recording needs separate drum stems for this to work.</p>
    </section>
  );
}
