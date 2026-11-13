import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Repeat, CornerDownRight } from "lucide-react";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { sectionIndexAt, sortedSections, type Section } from "@/song/performance/sections";
import { cn } from "@/lib/utils";
import { clock } from "./format";
import { sectionColours } from "./section-colours";

/** A timed MIDI cue, drawn as a tick on the top edge. */
export interface TimelineCue {
  time: number;
  label: string;
}

export interface SongTimelineProps {
  /** The song's length in seconds: the whole timeline stands for it. */
  duration: number;
  sections: readonly Section[];
  /** Waveform peaks, 0 to 1, evenly spread over the duration. Without them only the sections are drawn. */
  peaks?: Float32Array | null;
  /** The part of the song that plays: the rest is shaded. */
  trim?: { start: number; end: number };
  cues?: readonly TimelineCue[];
  /** The section that loops, and the one a queued jump lands on. Each gets a mark. */
  loopingId?: string | null;
  jumpTargetId?: string | null;
  /** Outlines the section after the current one. */
  showNext?: boolean;
  /** Section labels stay pressable while seeking is locked (stage mode): a press jumps under the session's rules, as the chips do. */
  jumpable?: boolean;
  /** Bigger section labels, for reading from a distance. */
  large?: boolean;
  /** Seconds in one bar, for Shift + arrow. Without it a bar is taken as 2 s. */
  barSeconds?: number;
  /** Seeking is not allowed (stage mode, or the session locked it): nothing is called and the timeline says so. */
  locked?: boolean;
  /** Called with a song time in seconds, from a click, a drag or the arrow keys. */
  onSeek: (seconds: number) => void;
  /** Called when a section's label is pressed, with the same effect as a press on its chip. */
  onSection?: (id: string) => void;
  className?: string;
}

/** Seconds one arrow press moves. */
const STEP_S = 5;

const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);

/**
 * The song as one bar of time: its waveform, its sections as labelled blocks in proportion to their length, the playhead, the trimmed ends
 * and the MIDI cues. A click seeks, a drag scrubs, and the arrow keys move 5 s (a bar with Shift). It reads the playback clock itself, so
 * the page around it does not re-render while playing.
 */
export function SongTimeline({
  duration,
  sections,
  peaks,
  trim,
  cues = [],
  loopingId,
  jumpTargetId,
  showNext = false,
  jumpable = false,
  large = false,
  barSeconds,
  locked = false,
  onSeek,
  onSection,
  className,
}: SongTimelineProps) {
  const ordered = useMemo(() => sortedSections(sections), [sections]);
  const position = usePlaybackClock((s) => Math.round(s.position * 10) / 10);
  const currentIndex = usePlaybackClock((s) => sectionIndexAt(ordered, s.position));
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const total = Math.max(duration, 0.001);
  const pct = (seconds: number) => `${(clamp(seconds, total) / total) * 100}%`;
  const current = ordered[currentIndex];
  const blockWidth = (section: Section) => `${(Math.max(0, Math.min(section.end, total) - Math.max(0, section.start)) / total) * 100}%`;

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    const element = canvas.current;
    if (!ctx || !element) return;
    const { width, height } = element;
    ctx.clearRect(0, 0, width, height);
    if (!peaks?.length) return;
    ctx.fillStyle = "rgba(200, 200, 215, 0.55)";
    const barWidth = Math.max(1, width / peaks.length);
    peaks.forEach((peak, i) => {
      const h = Math.max(1, peak * height * 0.9);
      ctx.fillRect((i / peaks.length) * width, (height - h) / 2, barWidth, h);
    });
  }, [peaks]);

  const timeAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / (rect.width || 1)) * total, total);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (locked || !duration) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSeek(timeAt(event));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current && !locked) onSeek(timeAt(event));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked || !duration) return;
    const step = event.shiftKey ? (barSeconds ?? 2) : STEP_S;
    if (event.key === "ArrowRight") onSeek(clamp(position + step, total));
    else if (event.key === "ArrowLeft") onSeek(clamp(position - step, total));
    else return;
    event.preventDefault();
  };

  return (
    <div className={cn("relative h-[72px] w-full shrink-0 select-none", className)}>
      <div
        ref={surface}
        role="slider"
        tabIndex={0}
        aria-label="Song timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={position}
        aria-valuetext={`${clock(position)} of ${clock(duration)}${current ? `, ${current.name}` : ""}`}
        aria-disabled={locked || undefined}
        title={locked ? "Seeking is locked." : undefined}
        className={cn(
          "absolute inset-0 overflow-hidden rounded-md bg-well outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60",
          locked ? "cursor-not-allowed" : "cursor-pointer",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {ordered.map((section, i) => (
          <div
            key={section.id}
            data-section={section.id}
            data-current={i === currentIndex || undefined}
            data-next={(showNext && i === currentIndex + 1) || undefined}
            className="absolute inset-y-0 border-l"
            style={{
              left: pct(section.start),
              width: blockWidth(section),
              background: sectionColours(section).fill,
              borderColor: sectionColours(section).edge,
              boxShadow:
                i === currentIndex
                  ? `inset 0 0 0 2px ${sectionColours(section).edge}`
                  : showNext && i === currentIndex + 1
                    ? `inset 0 0 0 2px ${sectionColours(section).edge}66`
                    : undefined,
            }}
          />
        ))}
        <canvas ref={canvas} width={peaks?.length || 600} height={72} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
        {trim && trim.start > 0 && (
          <div data-trim="start" className="pointer-events-none absolute inset-y-0 left-0 bg-black/55" style={{ width: pct(trim.start) }} />
        )}
        {trim && trim.end < duration && (
          <div
            data-trim="end"
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/55"
            style={{ width: `${((total - trim.end) / total) * 100}%` }}
          />
        )}
        {cues.map((cue, i) => (
          <span key={i} title={cue.label} data-cue className="absolute top-0 h-2 w-px bg-amber-300" style={{ left: pct(cue.time) }} />
        ))}
        <div
          data-playhead
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgb(0_0_0/0.8)]"
          style={{ left: pct(position) }}
        />
      </div>
      {/* The labels sit above the seeking surface. Everything else in a block lets the click through to it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        {ordered.map((section) => (
          <button
            key={section.id}
            type="button"
            disabled={!onSection || (locked && !jumpable)}
            aria-label={`${section.name}, ${clock(section.start)} to ${clock(section.end)}`}
            className={cn(
              "pointer-events-auto absolute bottom-1 flex items-center justify-start gap-1 overflow-hidden rounded px-1 font-medium text-foreground/90 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
              large ? "text-sm leading-5" : "text-[11px] leading-4",
            )}
            style={{
              left: `calc(${pct(section.start)} + 2px)`,
              width: `calc(${blockWidth(section)} - 4px)`,
            }}
            onClick={() => onSection?.(section.id)}
          >
            {loopingId === section.id && <Repeat aria-label="Loops" className="size-3 shrink-0" />}
            {jumpTargetId === section.id && <CornerDownRight aria-label="Jump queued" className="size-3 shrink-0 text-amber-300" />}
            <span className="truncate">{section.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
