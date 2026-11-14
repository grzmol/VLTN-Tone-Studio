import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BeatGrid as AnalysedGrid } from "@/song/band/beat-grid";
import { AUTOSCROLL_LABELS, useAutoscroll } from "@/song/performance/autoscroll";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { barAndBeat, barsUntil, patchCues, patchNext, patchNow, patchPedal, patchText, type PatchCue } from "@/song/performance/position";
import { READER_TEXT, useReaderText } from "@/song/performance/reader-text";
import { sectionIndexAt, sortedSections, type Section } from "@/song/performance/sections";
import { selectArmed, selectOutput, useSession, type PerformanceSession } from "@/song/performance/session";
import { BeatIndicator, useBeatIndex, useBeatLit, type BeatGrid } from "./BeatIndicator";
import { clock } from "./format";
import { ClockOverDuration } from "./PlaybackDisplay";
import { sectionColours } from "./section-colours";

/** The reader's settings that the "⋯" menu holds in stage mode. */
export interface StageControls {
  follow: boolean;
  onFollow: (follow: boolean) => void;
  showCommands: boolean;
  onShowCommands: (show: boolean) => void;
  edgeFlash: boolean;
  onEdgeFlash: (on: boolean) => void;
  onExit: () => void;
}

const sectionColour = (section: Section) => section.color ?? sectionColours(section).edge;

/** The section the song is in and the one after it: "Verse 2 → Pre-chorus 2". An armed jump replaces the next one. */
function SectionNow({ session, sections }: { session: PerformanceSession; sections: readonly Section[] }) {
  const index = usePlaybackClock((s) => sectionIndexAt(sections, s.position));
  const live = useSession(session, (s) => s.sectionLive);
  const decided = useSession(session, (s) => s.sectionNext);
  const current = sections[index];
  const looping = !!current && (live.loop === current.id || (current.mode === "loop" && !live.released.includes(current.id)));
  const jumpId = live.jump ?? (decided?.kind === "jump" ? decided.target : null);
  const next = (jumpId ? sections.find((s) => s.id === jumpId) : undefined) ?? sections[index + 1];
  if (!current) return null;
  return (
    <p className="min-w-0 text-2xl leading-tight font-bold" aria-label="Section now and next">
      <span style={{ color: sectionColour(current) }}>{current.name}</span>
      {looping && !jumpId ? (
        <span className="ml-3 text-xl font-semibold text-foreground/80">Looping</span>
      ) : (
        next && (
          <>
            <span className="mx-2 text-silkscreen-3">→</span>
            <span className="text-xl font-semibold text-foreground/80">{next.name}</span>
          </>
        )
      )}
    </p>
  );
}

/** Bars left in the section: "4 bars", or seconds ("0:12") when the song has no beat grid. It steps on each bar and not on each frame. */
export function BarsLeft({ sections, grid, decorative = false }: { sections: readonly Section[]; grid: AnalysedGrid | null; decorative?: boolean }) {
  const left = usePlaybackClock((s) => {
    const section = sections[sectionIndexAt(sections, s.position)];
    if (!section) return null;
    const bars = barsUntil(grid, s.position, section.end);
    return bars === null ? `${clock(Math.ceil(section.end - s.position))}` : `${bars} ${bars === 1 ? "bar" : "bars"}`;
  });
  if (left === null) return null;
  return (
    <p className="text-2xl font-bold tabular-nums" aria-label={decorative ? undefined : "Left in the section"} aria-hidden={decorative || undefined}>
      {left}
    </p>
  );
}

/** "Bar 37 · 3": the bar and the beat in it, with the beat light. */
function BarBeat({ grid, beat }: { grid: AnalysedGrid | null; beat: BeatGrid }) {
  const position = usePlaybackClock((s) => {
    const found = barAndBeat(grid, s.position);
    return found ? `Bar ${found.bar} · ${found.beat}` : "";
  });
  return (
    <div className="flex items-center gap-2">
      <BeatIndicator {...beat} />
      {position && <p className="text-lg font-semibold tabular-nums">{position}</p>}
    </div>
  );
}

/** The memory the pedal is on and the one that comes next with the time to it. */
function PedalNow({ patches }: { patches: readonly PatchCue[] }) {
  const now = usePlaybackClock((s) => patchNow(patches, s.position));
  const next = usePlaybackClock((s) => patchNext(patches, s.position));
  const seconds = usePlaybackClock((s) => (next ? Math.ceil(next.time - s.position) : 0));
  const first = patches[0];
  const shown = now ?? first;
  if (!shown) return null;
  return (
    <p className="min-w-0 text-lg leading-tight" aria-label="Pedal">
      <span className="font-semibold">
        {patchPedal(shown)}: {patchText(shown)}
      </span>
      {next && (
        <span className="block truncate text-sm text-silkscreen-3">
          → {patchText(next)} in {clock(seconds)}
        </span>
      )}
    </p>
  );
}

/** One dot and a word: Ready, Cues off or No MIDI. A problem says why. */
function Health({ session, reason }: { session: PerformanceSession; reason: string }) {
  const output = useSession(session, selectOutput);
  const armed = useSession(session, selectArmed);
  const error = useSession(session, (s) => s.error || s.parseError);
  const lateNotice = useSession(session, (s) => s.lateNotice);
  const connected = output?.state === "connected";
  const late =
    lateNotice && lateNotice.dropped + (lateNotice.resynced ? 1 : 0) > 0
      ? `${lateNotice.dropped} late MIDI command${lateNotice.dropped === 1 ? "" : "s"} dropped`
      : "";
  const state = error
    ? { dot: "bg-red-500", word: "Problem", why: error }
    : !connected
      ? { dot: "bg-amber-400", word: "No MIDI", why: "Output disconnected" }
      : !armed
        ? { dot: "bg-amber-400", word: "Cues off", why: "Cues disarmed" }
        : late
          ? { dot: "bg-amber-400", word: "Ready", why: late }
          : { dot: "bg-emerald-500", word: "Ready", why: "" };
  const why = [state.why, reason].filter(Boolean).join(" · ");
  return (
    <div role={error ? "alert" : "status"} aria-label="Performance status" className="flex min-w-0 items-center gap-2 text-lg font-semibold">
      <span aria-hidden className={`size-3.5 shrink-0 rounded-full ${state.dot}`} />
      {state.word}
      {why && <span className="truncate text-sm font-normal text-amber-300">{why}</span>}
    </div>
  );
}

/** The last bar pulses the edge of the strip on each beat. A performer who prefers reduced motion gets none. */
function useLastBarPulse(beat: BeatGrid, active: boolean): boolean {
  const index = useBeatIndex(beat.bpm, beat.firstBeat);
  const lit = useBeatLit(active ? index : -1);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return lit && !reduced;
}

/**
 * The top band of stage mode: where the song is, what comes next and whether everything is all right. It reads the clock in small parts,
 * each of which re-renders only when its own text changes (once per bar, beat or second), never once per frame.
 */
export function StageStatusStrip({
  session,
  title,
  setPosition,
  nextTitle,
  duration,
  grid,
  beat,
  speedNote,
  controls,
  notices,
  extra,
}: {
  session: PerformanceSession;
  title: string;
  /** "2 / 6" while a set plays */
  setPosition: string | null;
  /** The song that plays next, shown in place of the section while a set card is up */
  nextTitle: string | null;
  duration: number;
  grid: AnalysedGrid | null;
  beat: BeatGrid;
  speedNote: string | null;
  controls: StageControls;
  /** Anything that needs saying besides the dot, such as a power or library problem */
  notices: string;
  /** More controls for the right end, such as the PDF view switch */
  extra?: ReactNode;
}) {
  const sections = useSession(session, (s) => s.sections);
  const cues = useSession(session, (s) => s.cues);
  const ordered = useMemo(() => sortedSections(sections), [sections]);
  const patches = useMemo(() => patchCues(cues), [cues]);
  const size = useReaderText((s) => s.size);
  const autoscroll = useAutoscroll((s) => s.mode);
  const lastBar = usePlaybackClock((s) => {
    const section = ordered[sectionIndexAt(ordered, s.position)];
    return !!section && s.playing && barsUntil(grid, s.position, section.end) === 1;
  });
  const pulse = useLastBarPulse(beat, lastBar);
  return (
    <div
      aria-label="Stage status"
      className={`flex min-h-16 shrink-0 flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-black/10 px-4 py-2 transition-colors duration-150 ${pulse ? "border-amber-400" : "border-seam"}`}
      style={{ fontSize: `${(size / READER_TEXT.initial) * 100}%` }}
    >
      <div className="min-w-0 max-w-[22%]">
        <p className="truncate text-lg font-semibold" title={title}>
          {title}
        </p>
        {setPosition && <p className="text-sm text-silkscreen-3">{setPosition}</p>}
      </div>
      {nextTitle ? <p className="text-2xl font-bold">Next: {nextTitle}</p> : <SectionNow session={session} sections={ordered} />}
      {!nextTitle && (
        <span className="[@media(max-height:719px)]:hidden">
          <BarsLeft sections={ordered} grid={grid} />
        </span>
      )}
      <BarBeat grid={grid} beat={beat} />
      <PedalNow patches={patches} />
      <Health session={session} reason={notices} />
      <div className="ml-auto flex items-center gap-2">
        {speedNote && <span className="rounded-md border border-seam px-2 py-1 text-sm tabular-nums">{speedNote}</span>}
        {extra}
        <ClockOverDuration className="text-xl font-semibold tabular-nums" duration={duration} plain />
        <Button variant="outline" aria-label="Smaller performance text" disabled={size <= READER_TEXT.min} onClick={() => useReaderText.getState().step(-1)}>
          A−
        </Button>
        <Button variant="outline" aria-label="Larger performance text" disabled={size >= READER_TEXT.max} onClick={() => useReaderText.getState().step(1)}>
          A+
        </Button>
        <StageMenu controls={controls} line={autoscroll === "line"} />
      </div>
    </div>
  );
}

/** The "⋯" menu: what stage mode needs less often than the actions. */
function StageMenu({ controls, line }: { controls: StageControls; line: boolean }) {
  const item = (label: string, checked: boolean, onChange: (checked: boolean) => void): ReactNode => (
    <DropdownMenuCheckboxItem checked={checked} onCheckedChange={onChange} className="py-3 text-base">
      {label}
    </DropdownMenuCheckboxItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="More stage settings">
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[60] min-w-56">
        {item("Follow playback", controls.follow, controls.onFollow)}
        {item(AUTOSCROLL_LABELS.line, line, (on) => useAutoscroll.getState().update({ mode: on ? "line" : "continuous" }))}
        {item("Show MIDI commands", controls.showCommands, controls.onShowCommands)}
        {item("Edge flash", controls.edgeFlash, controls.onEdgeFlash)}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="py-3 text-base" onSelect={controls.onExit}>
          Exit stage mode
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
