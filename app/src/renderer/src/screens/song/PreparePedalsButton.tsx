import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { selectArmed, useSession, type PerformanceSession } from "@/song/performance/session";

/** Preparation deliberately stops before count-in or audio; ordinary Play can still do both. */
export function PreparePedalsButton({ session }: { session: PerformanceSession }) {
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
      disabled={!player || playing || starting || !enabled || !armed || !!parseError || !!busy}
      title="Load pedal presets and tempo, wait for loading, then stop at Ready. Play starts the count-in and music."
      onClick={() => {
        session.invalidatePreparation();
        void session.preparePedals();
      }}
    >
      {ready ? "Prepare again" : "Prepare pedals"}
    </Button>
  );
}
