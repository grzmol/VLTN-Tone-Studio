import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { sectionIndexAt, sortedSections } from "@/song/performance/sections";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { HoldButton } from "./HoldButton";
import { PreparePedalsButton } from "./PreparePedalsButton";

/** The actions that are live in stage mode, at touch size: play, loop, next section and, before the song starts, Prepare pedals. Stop and Panic are at the right. */
export function StageActions({ session }: { session: PerformanceSession }) {
  const library = useSongLibrary();
  const player = useSession(session, (s) => s.player);
  const playing = useSession(session, (s) => s.playing);
  const starting = useSession(session, (s) => s.starting);
  const queued = useSession(session, (s) => s.queued);
  const parseError = useSession(session, (s) => s.parseError);
  const sections = useSession(session, (s) => s.sections);
  const live = useSession(session, (s) => s.sectionLive);
  const ordered = useMemo(() => sortedSections(sections), [sections]);
  const index = usePlaybackClock((s) => sectionIndexAt(ordered, s.position));
  const atStart = usePlaybackClock((s) => s.position < 0.5);
  const current = ordered[index];
  const next = ordered[index + 1];
  const looping = !!current && (live.loop === current.id || (current.mode === "loop" && !live.released.includes(current.id)));
  return (
    <div aria-label="Stage actions" className="flex shrink-0 flex-wrap items-center gap-3 [&_button]:min-h-14 [&_button]:text-lg">
      <Button
        className="min-w-36"
        disabled={!starting && (!player || !!parseError || library.busy)}
        onClick={() => (starting ? session.cancelStart() : playing ? session.pause() : session.startPlayback())}
      >
        {starting ? "Cancel start" : playing ? "Pause" : queued && library.queue.length > 1 ? "Play playlist" : "Play song"}
      </Button>
      <Button
        variant="outline"
        aria-pressed={looping}
        disabled={!current}
        onClick={() => (looping ? session.releaseSectionLoop() : current && session.toggleSectionLoop(current.id))}
      >
        {looping ? "Release loop" : "Loop this section"}
      </Button>
      <Button variant="outline" disabled={!next} onClick={() => next && session.tapSection(next.id)}>
        Next section
      </Button>
      {!playing && !starting && atStart && <PreparePedalsButton session={session} />}
      <div className="ml-auto flex items-center gap-3">
        <HoldButton armedLabel="Press again to stop" onConfirm={session.pause}>
          Stop playback
        </HoldButton>
        <HoldButton armedLabel="Press again for panic" onConfirm={session.panicAndDisarm}>
          Panic / stop MIDI
        </HoldButton>
      </div>
    </div>
  );
}
