import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { selectArmed, useSession, type PerformanceSession } from "@/song/performance/session";

/** Preparation deliberately stops before count-in or audio; ordinary Play can still do both. */
export function PreparePedalsButton({ session, compact = false }: { session: PerformanceSession; compact?: boolean }) {
  const player = useSession(session, (s) => s.player);
  const ready = useSession(session, (s) => s.pedalsReady);
  const playing = useSession(session, (s) => s.playing);
  const starting = useSession(session, (s) => s.starting);
  const enabled = useSession(session, (s) => s.preparationSettings?.enabled);
  const armed = useSession(session, selectArmed);
  const parseError = useSession(session, (s) => s.parseError);
  const busy = useSongLibrary((s) => s.busy);
  return (
    <Button
      variant="outline"
      size={compact ? "sm" : undefined}
      aria-label={compact ? (ready ? "Prepare pedals again" : "Prepare pedals now") : undefined}
      disabled={!player || playing || starting || !enabled || !armed || !!parseError || !!busy}
      title="Load pedal presets and tempo, wait for loading, then stop at Ready. Play starts the count-in and music."
      onClick={() => {
        session.invalidatePreparation();
        void session.preparePedals();
      }}
    >
      {compact ? (ready ? "Ready" : "Prepare") : ready ? "Prepare again" : "Prepare pedals"}
    </Button>
  );
}
