import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { dismissResume, useResumeOffer } from "@/song/performance/resume-offer";
import { holdResumePoint } from "@/song/performance/resume-point";
import type { PerformanceSession } from "@/song/performance/session";
import { clock } from "./format";

/** What the banner needs from the session: the player to wait for, and the three things it can do. */
type ResumeSession = Pick<PerformanceSession, "store" | "seek" | "startPlayback" | "playFromBeginning">;

/**
 * After a window crash the app reloads the set paused (see resume-offer.ts). This banner moves the song to where it stopped, then waits: nothing
 * plays until Resume is pressed, which uses the normal play path, so the pedal chase and the remembered Send cues work as on any start.
 * Stage mode comes back only with Resume.
 */
export function ResumeBanner({ session, setStage }: { session: ResumeSession; setStage: (value: boolean) => void }) {
  const point = useResumeOffer((s) => s.point);
  const player = useStore(session.store, (s) => s.player);
  const loadedId = useSongLibrary((s) => s.queue[s.position]);
  const busy = useSongLibrary((s) => s.busy);
  const [positioned, setPositioned] = useState(false);
  const sought = useRef(false);
  const ready = !!point && !!player && !busy && loadedId === point.songId;

  useEffect(() => {
    if (!ready || !point || sought.current) return;
    sought.current = true;
    void session.seek(point.songTime).finally(() => setPositioned(true));
  }, [ready, point, session]);

  if (!point) return null;
  const finish = (play: () => void) => {
    holdResumePoint(false);
    useResumeOffer.setState({ point: null });
    if (point.stageMode) setStage(true);
    play();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-seam p-4" role="region" aria-label="Resume the set">
      <p className="min-w-0 flex-1 text-sm">The window restarted. The set is paused where the music stopped.</p>
      <Button size="lg" className="h-14 px-8 text-lg" disabled={!positioned} onClick={() => finish(() => session.startPlayback())}>
        Resume at {clock(point.songTime)}
      </Button>
      <Button variant="outline" disabled={!positioned} onClick={() => finish(() => void session.playFromBeginning())}>
        Start song again
      </Button>
      <Button variant="ghost" onClick={dismissResume}>
        Dismiss
      </Button>
    </div>
  );
}
