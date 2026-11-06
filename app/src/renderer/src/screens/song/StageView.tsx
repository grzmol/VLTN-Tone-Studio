import { Button } from "@/components/ui/button";
import { host } from "@/host";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import type { Chord } from "@/song/performance/chords";
import { selectArmed, selectOutput, useSession, type PerformanceSession } from "@/song/performance/session";
import { useState } from "react";
import { useStagePower } from "./use-stage-power";
import { BeatIndicator, EdgeFlash, type BeatGrid } from "./BeatIndicator";
import { PerformanceReader, type PdfReaderState } from "./PerformanceReader";
import type { ChartMetadata } from "@/song/performance/import/import-result";
import { ClockOverDuration, PositionSlider } from "./PlaybackDisplay";
import { SectionStrip } from "./SectionStrip";

/** The reader with its status lines and transport, used both inline and as the full-screen stage view. */
export function StageView({
  session,
  stage,
  onExitStage,
  chart,
  lyrics,
  chords,
  shift,
  songKey,
  onSaveChart,
  onImportMetadata,
  beat,
  speedNote,
  pdf,
}: {
  session: PerformanceSession;
  stage: boolean;
  onExitStage: () => void;
  chart: string;
  lyrics: string;
  chords: Chord[];
  shift: number;
  songKey?: string;
  onSaveChart: (chart: string) => void;
  onImportMetadata?: (metadata: ChartMetadata) => void;
  /** The song's beat grid, for the beat light and the edge flash */
  beat: BeatGrid;
  /** Shown beside the beat light when the song is not at its own speed or pitch */
  speedNote: string | null;
  /** The song's PDF chart, when it is a saved song with one (or can take one) */
  pdf?: PdfReaderState;
}) {
  const library = useSongLibrary();
  const source = useSong((s) => s.source);
  const player = useSession(session, (s) => s.player);
  const playing = useSession(session, (s) => s.playing);
  const queued = useSession(session, (s) => s.queued);
  const sectioned = useSession(session, (s) => s.sections.length > 0);
  const parseError = useSession(session, (s) => s.parseError);
  const error = useSession(session, (s) => s.error);
  const lateNotice = useSession(session, (s) => s.lateNotice);
  const output = useSession(session, selectOutput);
  const armed = useSession(session, selectArmed);
  const powerError = useStagePower(stage && (playing || library.playlistPlaying));
  const duration = player?.duration ?? 0;
  const nextTitle = library.index?.songs.find((s) => s.id === library.queue[library.position + 1])?.title ?? "End of set";
  // Off by default: a full-screen flash is for performers who cannot look at the beat light.
  const [edgeFlash, setEdgeFlash] = useState(false);
  return (
    <>
      <PerformanceReader
        stage={stage}
        onExitStage={onExitStage}
        pdf={pdf}
        chart={chart}
        lyrics={lyrics}
        chords={chords}
        shift={shift}
        songKey={songKey}
        title={source?.name ?? "Performance"}
        onEditStart={session.pause}
        onSaveChart={stage ? undefined : onSaveChart}
        onImportMetadata={stage ? undefined : onImportMetadata}
        status={
          <>
            {stage && <p>Stage mode: seeking and editing locked. {queued ? `Set ${library.position + 1} / ${library.queue.length}` : ""}</p>}
            {stage && (playing || library.playlistPlaying) && !powerError && host.song.stagePower && <p>Desktop sleep prevention requested during playback.</p>}
            {stage && library.error && <p role="alert">{library.error}</p>}
            {stage && library.notice && <p role="status">{library.notice}</p>}
            {stage && queued && <p>Next: {nextTitle}</p>}
            {stage && powerError && <p role="alert">{powerError}</p>}
            <p role="status">
              MIDI: {output?.state === "connected" ? `${output.name} · ${armed ? "Cues armed" : "Cues disarmed"}` : "Output disconnected · Cues disarmed"}
            </p>
            {lateNotice && lateNotice.dropped + (lateNotice.resynced ? 1 : 0) > 0 && (
              <p role="status" className="text-amber-400">
                {lateNotice.dropped} late MIDI command{lateNotice.dropped === 1 ? "" : "s"} dropped at {Math.floor(lateNotice.position / 60)}:
                {String(Math.floor(lateNotice.position % 60)).padStart(2, "0")}
                {lateNotice.resynced ? " (resynced)" : ""}
              </p>
            )}
            {(error || parseError) && (
              <p role="alert" className="text-red-400">
                {error || parseError}
              </p>
            )}
          </>
        }
        transport={
          <>
            <Button disabled={!player || !!parseError || library.busy} onClick={() => (playing ? session.pause() : session.startPlayback())}>
              {playing ? "Pause" : queued && library.queue.length > 1 ? "Play playlist" : "Play song"}
            </Button>
            <Button variant="outline" disabled={!player || stage} onClick={() => void session.seek(0)}>
              Rewind
            </Button>
            <BeatIndicator large {...beat} />
            {speedNote && <span className="rounded-md border border-seam px-2 py-1 text-sm tabular-nums">{speedNote}</span>}
            {stage && (
              <Button variant="outline" aria-pressed={edgeFlash} onClick={() => setEdgeFlash(!edgeFlash)}>
                {edgeFlash ? "Edge flash on" : "Edge flash off"}
              </Button>
            )}
            {/* In Stage the sections replace the seek bar: seeking stays locked, jumps between sections do not. */}
            {stage && sectioned ? (
              <SectionStrip session={session} />
            ) : (
              <PositionSlider
                disabled={stage}
                label="Expanded song position"
                className="min-w-32 flex-1"
                duration={duration}
                onSeek={(value) => void session.seek(value)}
              />
            )}
            <Button variant="outline" onClick={session.panicAndDisarm}>
              Panic / stop MIDI
            </Button>
            {stage && (
              <Button variant="outline" onClick={session.pause}>
                Stop playback
              </Button>
            )}
            <ClockOverDuration className="text-sm" duration={duration} />
          </>
        }
      />
      {stage && edgeFlash && <EdgeFlash {...beat} />}
    </>
  );
}
