import { SkipBack, SkipForward, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { useSession, selectArmed, type PerformanceSession } from "@/song/performance/session";
import { sectionIndexAt, sortedSections } from "@/song/performance/sections";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { BeatIndicator } from "./BeatIndicator";
import { PreparePedalsButton } from "./PreparePedalsButton";
import { clock, tempo } from "./format";

/** The time as `0:00 / 5:30`. It reads the playback clock itself, so the rest of the bar does not re-render while playing. */
function TimeReadout({ duration }: { duration: number }) {
  const position = usePlaybackClock((s) => Math.floor(s.position));
  return (
    <span className="tabular-nums" aria-label="Song time">
      {clock(position)} / {clock(duration)}
    </span>
  );
}

/** The name of the section under the playhead. Re-renders only when the section changes. */
function CurrentSection({ session }: { session: PerformanceSession }) {
  const sections = useSession(session, (s) => s.sections);
  const name = usePlaybackClock((s) => {
    const ordered = sortedSections(sections);
    return ordered[sectionIndexAt(ordered, s.position)]?.name ?? "";
  });
  return name ? <span className="max-w-40 truncate text-silkscreen-2">{name}</span> : null;
}

/**
 * The compact transport that stays at the bottom of the Performance tab in every view: play, rewind, time, section, beat, tempo, pedal
 * preparation and the MIDI state, plus the playlist controls while a playlist plays. It reads the session the full transport reads and
 * adds no session calls of its own.
 */
export function TransportBar({ session, bpm, beats, firstBeat }: { session: PerformanceSession; bpm: number; beats: number; firstBeat: number }) {
  const library = useSongLibrary();
  const player = useSession(session, (s) => s.player);
  const playing = useSession(session, (s) => s.playing);
  const starting = useSession(session, (s) => s.starting);
  const parseError = useSession(session, (s) => s.parseError);
  const queued = useSession(session, (s) => s.queued);
  const armed = useSession(session, selectArmed);
  const midiStatus = useSession(session, (s) => s.midiStatus);
  const duration = player?.duration ?? 0;
  const inPlaylist = queued && library.queue.length > 1;
  const next = library.index.songs.find((song) => song.id === library.queue[library.position + 1])?.title;
  const label = playing ? "Pause" : starting ? "Cancel start" : "Play";
  return (
    <div aria-label="Transport" role="group" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-seam px-5 py-2 min-h-14">
      <Button
        size="icon-sm"
        aria-label={label}
        disabled={!player || !!parseError || library.busy}
        onClick={() => (playing ? session.pause() : starting ? session.cancelStart() : session.startPlayback())}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button size="icon-sm" variant="outline" aria-label="Rewind" disabled={!player} onClick={() => void session.seek(0)}>
        <RotateCcw />
      </Button>
      <TimeReadout duration={duration} />
      <CurrentSection session={session} />
      <BeatIndicator bpm={bpm} beats={beats} firstBeat={firstBeat} />
      <span className="tabular-nums text-silkscreen-2">{tempo(bpm)}</span>
      {inPlaylist && (
        <>
          <Button size="icon-sm" variant="outline" aria-label="Previous song" disabled={library.busy || library.position <= 0} onClick={() => session.skip(-1)}>
            <SkipBack />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Next song"
            disabled={library.busy || library.position + 1 >= library.queue.length}
            onClick={() => session.skip(1)}
          >
            <SkipForward />
          </Button>
          <span className="text-silkscreen-2">
            {library.position + 1} / {library.queue.length}
            {next ? ` · Next: ${next}` : ""}
          </span>
        </>
      )}
      <div className="ml-auto flex items-center gap-3">
        <PreparePedalsButton session={session} compact />
        <span
          role="img"
          aria-label={armed ? "MIDI armed" : "MIDI not armed"}
          title={midiStatus || (armed ? "MIDI output armed" : "MIDI output not armed")}
          className={`inline-block size-2.5 rounded-full ${armed ? "bg-emerald-400" : "bg-white/25"}`}
        />
      </div>
    </div>
  );
}
