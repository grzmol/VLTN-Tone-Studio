import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Dices, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { marksByBar, withMark, withoutMark, type BarMark, type BarMarkKind } from "@/song/band/marks";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fromStoredNotes, type BandNotes } from "@/song/band/stored-notes";
import { sectionColours } from "./section-colours";
import { barPlace, layoutSection, noteName } from "./band-part-layout";
import { BarMarkMenu, markText } from "./BarMarkMenu";
import { BandMarksList, markRows } from "./BandMarksList";
import { barLeft, barWidth, drawSection, LINE_HEIGHT, type PartColours } from "./band-part-draw";

/** A section the view can show. */
export interface PartSection {
  name: string;
  start: number;
  end: number;
}

export interface BandPartViewProps {
  /** The notes of the last Generate. Null when this song has none saved: the view then asks for a Generate. */
  notes: BandNotes | null;
  grid: BeatGrid | null;
  harmony: readonly ChordAtBeat[];
  sections: readonly PartSection[];
  /** The section shown, as an index into `sections`. */
  selected: number;
  onSelect(index: number): void;
  /** Starts the song at a time. Clicking a bar calls it. Left out in stage mode, where the bars do nothing. */
  onPlayFrom?(seconds: number): void;
  /** The song position now, in seconds, read each frame while `playing` to move the playhead. */
  getPosition?(): number;
  playing?: boolean;
  /** The marks the performer put on bars (spec 135). */
  marks: readonly BarMark[];
  /** Saves the marks after a change. Not given, the bars cannot be marked (a bar then only plays from itself). */
  onMarks?(marks: BarMark[]): void;
  /** True while the band works or the song plays: marks cannot be changed then. */
  disabled?: boolean;
  /** The shown section's own seed (spec 135): another draw for this section alone, and keeping it when the song's seed changes. Not shown when not given. */
  sectionSeed?: {
    kept: boolean;
    onTryAnother(): void;
    onKeep(keep: boolean): void;
  };
}

const FALLBACK_WIDTH = 760;
/** The tint of a marked bar. */
const MARK_TINT = "rgb(250 204 21)";

/** The colours the canvas draws with, read from the tokens the page uses. */
function readColours(element: HTMLElement, tint: string): PartColours {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    drums: token("--block-dst", "#ff7a1a"),
    bass: token("--block-mod", "#4aa3ff"),
    text: style.color || "#cbd5e1",
    strong: token("--silkscreen", "#f1f5f9"),
    line: "rgb(148 163 184 / 0.55)",
    section: tint,
  };
}

/** The beat a note starts on, counted from 1 and rounded to a quarter beat, for the bass table. */
function beatOf(x: number, beatsPerBar: number): string {
  return String(Math.round(x * beatsPerBar * 4) / 4 + 1);
}

/** A read-only picture of one section's drums and bass, bar by bar, for judging what the band plays and for picking a bar to play from. */
export function BandPartView({
  notes,
  grid,
  harmony,
  sections,
  selected,
  onSelect,
  onPlayFrom,
  getPosition,
  playing = false,
  marks,
  onMarks,
  disabled = false,
  sectionSeed,
}: BandPartViewProps) {
  const section = sections[selected] ?? sections[0];
  const layout = useMemo(() => {
    if (!notes || !grid || !section) return null;
    return layoutSection({ drums: fromStoredNotes(notes.drums), bass: fromStoredNotes(notes.bass) }, grid, section, harmony);
  }, [notes, grid, section, harmony]);
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const edge = section ? sectionColours(section) : null;
  const [editing, setEditing] = useState<number | null>(null);
  const placed = useMemo(() => (grid ? marksByBar(grid, marks) : null), [grid, marks]);

  useEffect(() => {
    const element = holder.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth > 0 ? element.clientWidth : FALLBACK_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout !== null]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !layout) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const height = layout.lines.length * LINE_HEIGHT;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawSection(context, layout, width, readColours(element, edge?.fill ?? "transparent"), (bar) => (placed?.byBar.has(bar.barIndex) ? MARK_TINT : undefined));
  }, [layout, width, edge, placed]);

  // The playhead is moved straight on the element each frame, so the clock is never React state.
  useEffect(() => {
    const head = playhead.current;
    if (!head || !layout || !playing || !getPosition) {
      if (head) head.style.display = "none";
      return;
    }
    let frame = 0;
    const move = () => {
      const time = getPosition();
      const bar = layout.bars.find((candidate) => time >= candidate.start && time < candidate.end);
      if (!bar) head.style.display = "none";
      else {
        const index = layout.bars.indexOf(bar);
        const row = Math.floor(index / 4);
        const x = barLeft(width, index % 4) + ((time - bar.start) / (bar.end - bar.start)) * barWidth(width);
        head.style.display = "block";
        head.style.transform = `translate(${x}px, ${row * LINE_HEIGHT}px)`;
      }
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [layout, width, playing, getPosition]);

  if (sections.length === 0 || !section) return <p className="text-silkscreen-3">This song has no sections.</p>;
  const beatsPerBar = grid?.beatsPerBar ?? 4;
  return (
    <section aria-label="Parts view" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="icon-sm" variant="outline" aria-label="Previous section" disabled={selected <= 0} onClick={() => onSelect(selected - 1)}>
          <ChevronLeft />
        </Button>
        <Select value={String(selected)} onValueChange={(value) => onSelect(Number(value))}>
          <SelectTrigger aria-label="Section to show" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sections.map((row, index) => (
              <SelectItem key={`${row.name}-${row.start}`} value={String(index)}>
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Next section"
          disabled={selected >= sections.length - 1}
          onClick={() => onSelect(selected + 1)}
        >
          <ChevronRight />
        </Button>
        {sectionSeed && (
          <>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={sectionSeed.onTryAnother}>
              <Dices /> Try another for this section
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sectionSeed.kept ? "secondary" : "outline"}
              aria-pressed={sectionSeed.kept}
              disabled={disabled}
              title="Keeps this section as it is when you try another for the whole song. Its notes are drawn once more when you turn this on."
              onClick={() => sectionSeed.onKeep(!sectionSeed.kept)}
            >
              {sectionSeed.kept ? <Lock /> : <LockOpen />} Keep this section
            </Button>
          </>
        )}
        {edge && <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: edge.edge }} />}
        {layout && <span className="text-silkscreen-3">{layout.bars.length === 1 ? "1 bar" : `${layout.bars.length} bars`}</span>}
      </div>
      {!notes ? (
        <p className="text-silkscreen-3">Generate once to see the parts.</p>
      ) : !layout || layout.bars.length === 0 ? (
        <p className="text-silkscreen-3">{grid ? "No bars of this section have notes." : "Find the beat first, so the parts can be drawn on bars."}</p>
      ) : (
        <>
          <div ref={holder} className="relative min-w-0 text-silkscreen-3" style={{ height: layout.lines.length * LINE_HEIGHT }}>
            <canvas ref={canvas} aria-hidden="true" className="absolute left-0 top-0" style={{ width, height: layout.lines.length * LINE_HEIGHT }} />
            {layout.lines.map((line, row) =>
              line.map((bar, column) => {
                const onBar = placed?.byBar.get(bar.barIndex) ?? [];
                const box = { left: barLeft(width, column), top: row * LINE_HEIGHT, width: barWidth(width) };
                const label = onBar.length > 0 ? `${bar.label}. Marked: ${onBar.map(markText).join(", ")}` : bar.label;
                // The marks that landed on this bar are moved to its start when one is added or taken off, so a bar keeps one time.
                const rebased = marks.map((mark) => (onBar.includes(mark) ? { ...mark, time: bar.start } : mark));
                const choose = (kind: BarMarkKind, beats: number | undefined) =>
                  onMarks?.(onBar.some((mark) => mark.kind === kind) ? withoutMark(rebased, bar.start, kind) : withMark(rebased, bar.start, kind, beats));
                return (
                  <Popover key={bar.barIndex} open={editing === bar.barIndex} onOpenChange={(open) => setEditing(open ? bar.barIndex : null)}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={label}
                        disabled={!onMarks && !onPlayFrom}
                        title={onMarks ? "Mark this bar" : onPlayFrom ? "Play from this bar" : undefined}
                        className="absolute rounded-sm outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                        style={{ ...box, height: LINE_HEIGHT - 8 }}
                        onClick={(event) => {
                          // Without marks a bar only plays from itself.
                          if (onMarks) return;
                          event.preventDefault();
                          onPlayFrom?.(bar.start);
                        }}
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-64" align="start">
                      <BarMarkMenu
                        title={`Bar ${bar.number}`}
                        marks={onBar}
                        disabled={disabled}
                        onChoose={choose}
                        onClear={() => onMarks?.(marks.filter((mark) => !onBar.includes(mark)))}
                        onPlayFrom={
                          onPlayFrom
                            ? () => {
                                setEditing(null);
                                onPlayFrom(bar.start);
                              }
                            : undefined
                        }
                      />
                    </PopoverContent>
                  </Popover>
                );
              }),
            )}
            {layout.lines.map((line, row) =>
              line.map((bar, column) => {
                const onBar = placed?.byBar.get(bar.barIndex) ?? [];
                if (onBar.length === 0) return null;
                return (
                  <span
                    key={`chip-${bar.barIndex}`}
                    aria-hidden="true"
                    className="pointer-events-none absolute truncate rounded bg-amber-300/90 px-1 text-[10px] font-medium leading-4 text-black"
                    style={{
                      left: barLeft(width, column) + barWidth(width) - 4,
                      top: row * LINE_HEIGHT,
                      maxWidth: barWidth(width) - 8,
                      transform: "translateX(-100%)",
                    }}
                  >
                    {onBar.map((mark) => markText(mark)).join(" · ")}
                  </span>
                );
              }),
            )}
            <div
              ref={playhead}
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 hidden w-0.5 bg-white"
              style={{ height: LINE_HEIGHT - 12 }}
            />
          </div>
          <table className="sr-only">
            <caption>Bass notes by bar</caption>
            <tbody>
              {layout.bars.map((bar) => (
                <tr key={bar.barIndex}>
                  <th scope="row">{`Bar ${bar.number}`}</th>
                  <td>
                    {bar.bass.length > 0 ? bar.bass.map((note) => `${noteName(note.pitch)} on beat ${beatOf(note.x, beatsPerBar)}`).join(", ") : "no bass"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {placed && grid && (
            <BandMarksList
              rows={markRows(marks, placed, (barIndex) => barPlace(grid, sections, barIndex))}
              disabled={disabled}
              onRemove={(mark) => onMarks?.(marks.filter((other) => other !== mark))}
              onRemoveAll={() => onMarks?.([])}
            />
          )}
        </>
      )}
    </section>
  );
}
