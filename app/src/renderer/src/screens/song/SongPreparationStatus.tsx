import { useEffect, useState } from "react";
import { useSession, type PerformanceSession } from "@/song/performance/session";
/** The countdown updates only this small status, not the song's mixer or scheduler. */
export function SongPreparationStatus({ session }: { session: PerformanceSession }) {
  const ready = useSession(session, (state) => state.pedalsReady);
  const preparing = useSession(session, (state) => state.preparing);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (!preparing) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [preparing]);
  if (!preparing)
    return ready ? (
      <p role="status" title="The commands were sent and the loading wait finished. This does not confirm the pedal’s received settings.">
        Ready to play · pedal setup sent.
      </p>
    ) : null;
  const seconds = Math.max(0, preparing.until - now) / 1000;
  return (
    <p role="status">
      Preparing pedals: {preparing.label}
      {seconds > 0 ? ` — ${seconds.toFixed(1)} s` : ""}.
    </p>
  );
}
