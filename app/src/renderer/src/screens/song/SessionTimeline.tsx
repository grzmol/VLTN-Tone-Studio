import { useMemo } from "react";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { sortedSections } from "@/song/performance/sections";
import { cachedPeaks } from "@/song/audio/peaks";
import { SongTimeline } from "./SongTimeline";

/** Peak count for the Play view's timeline: the width of a wide window, so one list serves every size. */
const PEAK_WIDTH = 1200;

/**
 * The song timeline wired to a performance session: its sections, loop and queued jump, the trim, the timed cues, and seeking and section
 * jumps through the session. `songId` names the song's audio for the peak cache.
 */
export function SessionTimeline({
  session,
  songId,
  channels,
  sampleRate,
  barSeconds,
  stage = false,
}: {
  session: PerformanceSession;
  songId: string | null;
  channels: Float32Array[] | null;
  sampleRate: number;
  barSeconds?: number;
  stage?: boolean;
}) {
  const player = useSession(session, (s) => s.player);
  const sections = useSession(session, (s) => s.sections);
  const live = useSession(session, (s) => s.sectionLive);
  const next = useSession(session, (s) => s.sectionNext);
  const cues = useSession(session, (s) => s.cues);
  const peaks = useMemo(() => (songId && channels?.length ? cachedPeaks(songId, channels, PEAK_WIDTH) : null), [songId, channels]);
  const timed = useMemo(() => cues.filter((cue) => !cue.trigger && !cue.managed).map((cue) => ({ time: cue.time, label: cue.label || cue.text })), [cues]);
  if (!player) return null;
  const length = channels?.[0] ? channels[0].length / (sampleRate || 1) : player.duration;
  const playing = sortedSections(sections).find((section) => live.loop === section.id || (section.mode === "loop" && !live.released.includes(section.id)));
  return (
    <SongTimeline
      duration={Math.max(length, player.duration)}
      sections={sections}
      peaks={peaks}
      trim={{ start: player.start, end: player.duration }}
      cues={timed}
      loopingId={live.loop ?? playing?.id ?? null}
      jumpTargetId={live.jump ?? (next?.kind === "jump" ? next.target : null)}
      barSeconds={barSeconds}
      locked={stage || session.locked}
      jumpable={stage}
      large={stage}
      showNext={stage}
      className={stage ? "h-[72px] [@media(max-height:719px)]:h-12" : undefined}
      onSeek={(seconds) => void session.seek(seconds)}
      onSection={session.tapSection}
    />
  );
}
