import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { BeatIndicator } from "./BeatIndicator";
import { PreparePedalsButton } from "./PreparePedalsButton";
import { ClockOverDuration, PositionSlider } from "./PlaybackDisplay";
import { host } from "@/host";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import type { Chord } from "@/song/performance/chords";
import { readStoredBand } from "@/song/band/stored";
import { steadyGrid } from "@/song/performance/position";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { sortedSections } from "@/song/performance/sections";
import { selectArmed, selectOutput, useSession, type PerformanceSession } from "@/song/performance/session";
import { useStagePower } from "./use-stage-power";
import { EdgeFlash, type BeatGrid } from "./BeatIndicator";
import { PerformanceReader, type PdfReaderState } from "./PerformanceReader";
import type { ChartMetadata } from "@/song/performance/import/import-result";
import { PracticeMuteBanner } from "./PracticeMute";
import { SessionTimeline } from "./SessionTimeline";
import { SongPreparationStatus } from "./SongPreparationStatus";
import { StageActions } from "./StageActions";
import { StageSetCard } from "./StageSetCard";
import { BarsLeft, StageStatusStrip } from "./StageStatusStrip";

/** The reader with its transport, used both inline and as the full-screen stage view. */
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
  soloScale,
  settingsKey,
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
  /** For the reader's Solo scale button */
  soloScale?: { storageKey: string; capo: number; onChange?: () => void };
  /** The song's settings key: its saved band beat grid, when it has one, gives the strip the song's real bar lines. */
  settingsKey?: string;
}) {
  const library = useSongLibrary();
  const source = useSong((s) => s.source);
  const player = useSession(session, (s) => s.player);
  const playing = useSession(session, (s) => s.playing);
  const starting = useSession(session, (s) => s.starting);
  const sections = useSession(session, (s) => s.sections);
  const ordered = useMemo(() => sortedSections(sections), [sections]);
  const queued = useSession(session, (s) => s.queued);
  const parseError = useSession(session, (s) => s.parseError);
  const error = useSession(session, (s) => s.error);
  const lateNotice = useSession(session, (s) => s.lateNotice);
  const output = useSession(session, selectOutput);
  const armed = useSession(session, selectArmed);
  const powerError = useStagePower(stage && (starting || playing || library.playlistPlaying));
  const atStart = usePlaybackClock((s) => s.position < 0.5);
  const duration = player?.duration ?? 0;
  const entry = library.index?.songs.find((s) => s.id === source?.libraryId);
  const title = entry?.title ?? source?.name ?? "Performance";
  // Off by default: a full-screen flash is for performers who cannot look at the beat light.
  const [edgeFlash, setEdgeFlash] = useState(false);
  // The saved grid follows the song's own tempo and bar lines; the steady one is the fallback. Stage mode locks editing, so it is read on entry.
  const saved = useMemo(() => (stage && settingsKey ? readStoredBand(settingsKey).grid : null), [stage, settingsKey, source]);
  const grid = useMemo(
    () => (saved && saved.beats.length > 1 ? saved : steadyGrid(beat.bpm, beat.beats, beat.firstBeat, duration)),
    [saved, beat.bpm, beat.beats, beat.firstBeat, duration],
  );
  // Between songs of a set the chart gives way to the card of the song that plays next.
  const card = stage && queued && !playing && !starting && atStart;
  const notices = [powerError, library.error, library.notice, parseError].filter(Boolean).join(" · ");
  return (
    <>
      <PerformanceReader
        stage={stage}
        onExitStage={onExitStage}
        pdf={pdf}
        soloScale={soloScale}
        chart={chart}
        lyrics={lyrics}
        chords={chords}
        shift={shift}
        songKey={songKey}
        title={title}
        onEditStart={session.pause}
        onSaveChart={stage ? undefined : onSaveChart}
        onImportMetadata={stage ? undefined : onImportMetadata}
        status={
          <>
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
            <PreparePedalsButton session={session} />
            <Button
              disabled={!starting && (!player || !!parseError || library.busy)}
              onClick={() => (starting ? session.cancelStart() : playing ? session.pause() : session.startPlayback())}
            >
              {starting ? "Cancel start" : playing ? "Pause" : queued && library.queue.length > 1 ? "Play playlist" : "Play song"}
            </Button>
            <Button variant="outline" disabled={!player} onClick={() => void session.seek(0)}>
              Rewind
            </Button>
            <BeatIndicator large {...beat} />
            {speedNote && <span className="rounded-md border border-seam px-2 py-1 text-sm tabular-nums">{speedNote}</span>}
            <PositionSlider label="Expanded song position" className="min-w-32 flex-1" duration={duration} onSeek={(value) => void session.seek(value)} />
            <Button variant="outline" onClick={session.panicAndDisarm}>
              Panic / stop MIDI
            </Button>
            <ClockOverDuration className="text-sm" duration={duration} />
          </>
        }
        stageCard={card ? <StageSetCard session={session} title={title} artist={entry?.artist ?? ""} songKey={entry?.key} bpm={entry?.bpm} /> : undefined}
        stageTop={(reader) => (
          <>
            <StageStatusStrip
              session={session}
              title={entry ? [entry.title, entry.artist].filter(Boolean).join(" · ") : title}
              setPosition={queued ? `${library.position + 1} / ${library.queue.length}` : null}
              nextTitle={card ? title : null}
              duration={duration}
              grid={grid}
              beat={beat}
              speedNote={speedNote}
              notices={notices}
              extra={reader.pdfControls}
              controls={{
                follow: reader.follow,
                onFollow: reader.onFollow,
                showCommands: reader.showCommands,
                onShowCommands: reader.onShowCommands,
                edgeFlash,
                onEdgeFlash: setEdgeFlash,
                onExit: onExitStage,
              }}
            />
            <div className="relative shrink-0">
              <SessionTimeline
                session={session}
                songId={source ? (source.libraryId ?? source.name) : null}
                channels={source?.audio.channels ?? null}
                sampleRate={source?.audio.sampleRate ?? 0}
                barSeconds={(beat.beats * 60) / (beat.bpm || 120)}
                stage
              />
              <div className="pointer-events-none absolute top-1 right-2 hidden rounded bg-black/60 px-2 [@media(max-height:719px)]:block">
                <BarsLeft sections={ordered} grid={grid} decorative />
              </div>
            </div>
            <StageActions session={session} />
            <div className="empty:hidden flex flex-wrap gap-x-6 text-sm">
              {stage && host.song.stagePower && (playing || library.playlistPlaying) && !powerError && (
                <p>Desktop sleep prevention requested during playback.</p>
              )}
              <PracticeMuteBanner />
              <SongPreparationStatus session={session} />
            </div>
          </>
        )}
      />
      {stage && edgeFlash && <EdgeFlash {...beat} />}
    </>
  );
}
