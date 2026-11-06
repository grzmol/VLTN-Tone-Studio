import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog as StageDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { headingLabel, lrcTime, parseChart, stageText, transpose, type Cue } from "@/song/performance/chart";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import type { Chord } from "@/song/performance/chords";
import { ChordVoicings } from "./ChordVoicings";
import { formatted } from "./lyric-format";
import { PerformanceEditor } from "./PerformanceEditor";
import { performanceLines } from "@/song/performance/reader";
import { useActiveIndex, usePlaybackClock } from "@/song/performance/playback-clock";
import { READER_TEXT, useReaderText } from "@/song/performance/reader-text";
import {
  AUTOSCROLL_LABELS,
  AUTOSCROLL_MODES,
  LINES_PER_MINUTE,
  SCROLL_KEYS,
  autoscrollTarget,
  fitLinesPerMinute,
  holdAutoscroll,
  isAutoscrollHeld,
  isAutoscrollMode,
  onAutoscrollResume,
  scrollTopFor,
  useAutoscroll,
  type AutoscrollMode,
  type ScrollRow,
} from "@/song/performance/autoscroll";
import { keySpelling } from "@/song/performance/speed";
import type { ChartMetadata } from "@/song/performance/import/import-result";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { ClockText } from "./PlaybackDisplay";
import { PdfChart } from "./PdfChart";
import { PdfControls } from "./PdfControls";
import type { ChartView } from "@shared/song-library";

/** The PDF chart of the song on screen: whether it has one, which view is showing, and how to change the view. */
export interface PdfReaderState {
  songId: string;
  chart: boolean;
  /** The digest of the song's PDF. A new PDF is a new digest, so the viewer reloads it. Annotation saves do not change it. */
  revision: string;
  view: ChartView;
  onView(view: ChartView): void;
}

export function PerformanceReader({
  chart,
  lyrics,
  chords,
  shift,
  songKey,
  title,
  transport,
  status,
  onEditStart,
  onSaveChart,
  onImportMetadata,
  stage = false,
  onExitStage,
  pdf,
}: {
  stage?: boolean;
  onExitStage?: () => void;
  /** The song's PDF chart, when it is a saved song. The PDF replaces the lyrics body while its view is on. */
  pdf?: PdfReaderState;
  chart: string;
  lyrics: string;
  chords: Chord[];
  shift: number;
  /** The song's key, which the chord names are spelled by (see SongKey) */
  songKey?: string;
  title: string;
  transport?: ReactNode;
  status?: ReactNode;
  onEditStart?: () => void;
  onSaveChart?: (chart: string) => void;
  /** Receives the song details an import read (key, tempo, capo and so on), once the imported chart has been saved. */
  onImportMetadata?: (metadata: ChartMetadata) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  useEffect(() => {
    if (stage) {
      setEditing(false);
      setSelectedChord(null);
    }
  }, [stage]);
  const showCommands = useMidiConfiguration((s) => s.showCommands);
  const macros = useMidiConfiguration((s) => s.macros);
  const lines = useMemo(() => {
    const result = performanceLines(chart, lyrics, chords, macros).map((line) => ({ ...line, midi: [] as Cue[] }));
    if (showCommands) {
      let cues: Cue[] = [];
      try {
        cues = parseChart(chart, macros);
      } catch {
        /* Editor shows validation errors. */
      }
      // A trigger has no time, so it is not put on the timeline.
      for (const cue of cues.filter((c) => c.messages.length && !c.trigger)) {
        const existing = result.find((line) => line.time === cue.time);
        if (existing) existing.midi.push(cue);
        else result.push({ time: cue.time, text: "", chords: [], midi: [cue] });
      }
      result.sort((a, b) => (Number.isFinite(a.time) ? a.time : Infinity) - (Number.isFinite(b.time) ? b.time : Infinity));
    }
    return result;
  }, [chart, lyrics, chords, showCommands, macros]);
  const pdfShown = !!pdf?.chart && pdf.view === "pdf";
  const [expanded, setExpanded] = useState(false),
    [follow, setFollow] = useState(true),
    size = useReaderText((s) => s.size);
  // The song's length, from its library entry, for the constant-speed fit.
  const libraryId = useSong((s) => s.source?.libraryId);
  const librarySong = useSongLibrary((s) => s.index?.songs.find((song) => song.id === libraryId));
  const spelling = keySpelling(songKey, shift);
  const duration = librarySong?.duration ?? 0;
  const autoscrollMode = useAutoscroll((s) => s.mode),
    linesPerMinute = useAutoscroll((s) => s.linesPerMinute);
  const viewport = useRef<HTMLDivElement>(null),
    lyricsBody = useRef<HTMLDivElement>(null),
    rowRefs = useRef<(HTMLDivElement | null)[]>([]),
    expandButton = useRef<HTMLButtonElement>(null);
  const chordButton = useRef<HTMLButtonElement | null>(null);
  const active = useActiveIndex(useMemo(() => lines.map((line) => line.time), [lines]));
  const changes = useMemo(() => lines.flatMap((line) => line.chords), [lines]);
  const activeChord = useActiveIndex(useMemo(() => changes.map((chord) => chord.time), [changes]));
  // Where each row sits in the lyrics, measured after layout. The scroll reads this model, so it never waits for a render.
  const scrollModel = useRef<{ mode: AutoscrollMode; linesPerMinute: number; rows: ScrollRow[] }>({
    mode: "line",
    linesPerMinute: LINES_PER_MINUTE.initial,
    rows: [],
  });
  // The rows are measured again when they are shown (the PDF replaces them), and when their box changes size (a font load, a window resize).
  useLayoutEffect(() => {
    const measure = () => {
      scrollModel.current = {
        mode: autoscrollMode,
        linesPerMinute,
        rows: lines.map((line, index) => ({ time: line.time, top: rowRefs.current[index]?.offsetTop ?? 0 })),
      };
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const element of [viewport.current, lyricsBody.current]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [lines, size, expanded, stage, editing, pdfShown, autoscrollMode, linesPerMinute]);
  // Autoscroll follows the song position from the playback clock. The clock's listener moves the scroll box directly, so a frame of
  // playback does not re-render the reader. A manual or remote scroll holds it off for a while, and it then returns to the position.
  useEffect(() => {
    const apply = (position: number) => {
      const panel = viewport.current,
        model = scrollModel.current;
      if (!follow || !panel || isAutoscrollHeld()) return;
      const target = autoscrollTarget(model.mode, position, model.rows, model.linesPerMinute);
      if (target === null) return;
      const top = scrollTopFor(target, panel.clientHeight);
      if (Math.abs(panel.scrollTop - top) < 0.5) return;
      panel.scrollTo({ top, behavior: "instant" });
    };
    apply(usePlaybackClock.getState().position);
    const unsubscribe = usePlaybackClock.subscribe((state) => apply(state.position));
    const stopListening = onAutoscrollResume(() => apply(usePlaybackClock.getState().position));
    return () => {
      unsubscribe();
      stopListening();
    };
  }, [follow, editing, expanded, stage, size, lines, autoscrollMode, linesPerMinute, pdfShown]);
  useEffect(() => {
    if (stage || !expanded || selectedChord) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        expandButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded, selectedChord, stage]);
  const content = (
    <section
      aria-label="Combined performance view"
      className={
        expanded || stage ? "fixed inset-0 z-50 flex flex-col bg-background p-6 text-foreground" : "flex flex-col rounded-xl border border-seam bg-black/10 p-4"
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="font-semibold">Lyrics & chords · Perform</h2>
          <p className="text-sm text-silkscreen-3">
            {title} · <ClockText />
          </p>
        </div>
        {!stage && onSaveChart && (
          <Button
            variant="outline"
            disabled={editing}
            onClick={() => {
              onEditStart?.();
              setEditing(true);
            }}
          >
            Edit chords, lyrics & MIDI
          </Button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow playback
        </label>
        {pdf && <PdfControls songId={pdf.songId} chart={pdf.chart} view={pdf.view} stage={stage} onView={pdf.onView} />}
        {follow && !pdfShown && (
          <Select value={autoscrollMode} onValueChange={(value) => isAutoscrollMode(value) && useAutoscroll.getState().update({ mode: value })}>
            <SelectTrigger aria-label="Autoscroll style" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOSCROLL_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {AUTOSCROLL_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {follow && !pdfShown && autoscrollMode === "constant" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              Lines per minute
              <Input
                aria-label="Lines per minute"
                type="number"
                min={LINES_PER_MINUTE.min}
                max={LINES_PER_MINUTE.max}
                className="w-24"
                value={linesPerMinute}
                onChange={(e) => useAutoscroll.getState().update({ linesPerMinute: Number(e.target.value) })}
              />
            </label>
            {fitLinesPerMinute(lines.length, duration) !== null && (
              <Button variant="outline" onClick={() => useAutoscroll.getState().update({ linesPerMinute: fitLinesPerMinute(lines.length, duration) ?? linesPerMinute })}>
                Fit to song length
              </Button>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showCommands} onChange={(e) => useMidiConfiguration.getState().update({ showCommands: e.target.checked })} /> Show
          MIDI commands
        </label>
        <Button variant="outline" aria-label="Smaller performance text" disabled={size <= READER_TEXT.min} onClick={() => useReaderText.getState().step(-1)}>
          A−
        </Button>
        <Button variant="outline" aria-label="Larger performance text" disabled={size >= READER_TEXT.max} onClick={() => useReaderText.getState().step(1)}>
          A+
        </Button>
        {stage ? (
          <Button variant="outline" onClick={onExitStage}>
            Exit stage mode
          </Button>
        ) : (
          <Button ref={expandButton} variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Close expanded view" : "Expand performance view"}
          </Button>
        )}
      </div>
      {(expanded || stage) && (
        <div
          className={
            stage
              ? "mb-3 flex flex-wrap items-center gap-4 [&_button]:min-h-14 [&_button]:min-w-28 [&_button]:text-lg"
              : "mb-3 flex flex-wrap items-center gap-3"
          }
        >
          {transport}
        </div>
      )}
      {status && (
        <div className="mb-3 shrink-0 space-y-1 text-sm" aria-label="Performance status">
          {status}
        </div>
      )}
      {!stage && editing && onSaveChart ? (
        <PerformanceEditor
          chart={chart}
          lyrics={lyrics}
          chords={chords}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            onSaveChart(next);
            setEditing(false);
          }}
          onImportMetadata={onImportMetadata}
        />
      ) : pdfShown && pdf ? (
        <PdfChart
          key={`${pdf.songId}:${pdf.revision}`}
          songId={pdf.songId}
          follow={follow}
          stage={stage}
          onShowText={() => pdf.onView("text")}
          className={expanded || stage ? "min-h-0 flex-1" : "h-[28rem]"}
        />
      ) : (
        <div
          ref={viewport}
          data-reader-scroll
          tabIndex={0}
          aria-label="Combined lyrics and chords"
          onWheel={() => holdAutoscroll()}
          onTouchMove={() => holdAutoscroll()}
          onKeyDown={(event) => {
            if (SCROLL_KEYS.has(event.key)) holdAutoscroll();
          }}
          className={
            expanded || stage
              ? "relative min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg p-6"
              : "relative h-[28rem] overflow-y-auto overscroll-contain rounded-lg p-4"
          }
          style={{ fontSize: stage ? Math.max(36, size) : size, lineHeight: 1.6 }}
        >
          {lines.length ? (
            <div ref={lyricsBody} className="mx-auto max-w-4xl pb-48">
              {lines.map((line, index) => {
                const shown = stageText(line.text);
                const label = headingLabel(shown);
                return (
                  <div
                    key={index}
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    aria-current={index === active ? "true" : undefined}
                    className={
                      "mb-5 rounded-lg border-l-4 px-5 py-3 transition-colors " +
                      (index === active ? "border-sky-400 bg-sky-400/10 text-foreground" : "border-transparent text-silkscreen-3")
                    }
                  >
                    {!!line.chords.length && (
                      <div aria-label="Chords" className="flex flex-wrap gap-x-6 font-semibold text-sky-400">
                        {line.chords.map((chord, i) =>
                          chord.name === "N" ? (
                            <span key={i}>—</span>
                          ) : (
                            <button
                              disabled={stage}
                              key={i}
                              type="button"
                              aria-label={`Show ${transpose(`[${chord.name}]`, shift, spelling).slice(1, -1)} guitar voicings`}
                              title={(Number.isFinite(chord.time) ? lrcTime(chord.time) + " · " : "") + "Show guitar tabs"}
                              onClick={(event) => {
                                chordButton.current = event.currentTarget;
                                setSelectedChord(transpose(`[${chord.name}]`, shift, spelling).slice(1, -1));
                              }}
                              className={
                                "cursor-pointer rounded px-1 text-left hover:bg-sky-400/15 focus-visible:outline-2 focus-visible:outline-sky-400 " +
                                (changes[activeChord] === chord ? "bg-sky-400/20 text-sky-300 ring-1 ring-sky-400" : "")
                              }
                            >
                              {transpose(`[${chord.name}]`, shift, spelling).slice(1, -1)}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                    {label !== null ? (
                      <h3 className="text-sm font-semibold tracking-wide text-silkscreen-3 uppercase">{label}</h3>
                    ) : shown ? (
                      <p className={index === active ? "whitespace-pre-wrap font-semibold" : "whitespace-pre-wrap"}>
                        {formatted(transpose(shown, shift, spelling))}
                      </p>
                    ) : null}
                    {line.midi.map((cue, i) => (
                      <div key={i} aria-label="MIDI cue" className="my-2 rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-sm text-amber-300">
                        <strong>
                          {lrcTime(cue.time)} · {cue.label || "MIDI command"}
                        </strong>
                        <span className="ml-2 font-mono">
                          {cue.messages
                            .map((bytes) =>
                              bytes[0] < 0xf0
                                ? `ch ${(bytes[0] & 15) + 1} · ${bytes[0] >> 4 === 12 ? "PC" : bytes[0] >> 4 === 11 ? "CC" : "MIDI"} ${bytes.slice(1).join(" ")}`
                                : "SysEx",
                            )
                            .join(" → ")}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-base text-silkscreen-3">
              Generate lyrics from vocals or import a timed chart in the editors below. Lyrics and chords will appear together here and follow song playback.
            </p>
          )}
        </div>
      )}
      <ChordVoicings chord={selectedChord} onClose={() => setSelectedChord(null)} returnFocus={() => chordButton.current?.focus({ preventScroll: true })} />
      <p className="mt-2 text-xs text-silkscreen-3">
        Chords follow their timestamps above the corresponding lyric line. Chart chords take priority over estimates. Untimed text stays available for manual
        reading.
      </p>
    </section>
  );
  return stage ? (
    <StageDialog.Root open>
      <StageDialog.Portal>
        <StageDialog.Content
          data-stage-mode=""
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 bg-background text-foreground"
        >
          <StageDialog.Title className="sr-only">Stage mode</StageDialog.Title>
          {content}
        </StageDialog.Content>
      </StageDialog.Portal>
    </StageDialog.Root>
  ) : (
    content
  );
}
