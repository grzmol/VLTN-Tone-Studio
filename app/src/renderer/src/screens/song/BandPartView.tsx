import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { fromStoredNotes, type BandNotes } from "@/song/band/stored-notes";
import { sectionColours } from "./section-colours";
import { layoutSection, noteName } from "./band-part-layout";
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
}

const FALLBACK_WIDTH = 760;

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
export function BandPartView({ notes, grid, harmony, sections, selected, onSelect, onPlayFrom, getPosition, playing = false }: BandPartViewProps) {
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
    drawSection(context, layout, width, readColours(element, edge?.fill ?? "transparent"));
  }, [layout, width, edge]);

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
              line.map((bar, column) => (
                <button
                  key={bar.barIndex}
                  type="button"
                  aria-label={bar.label}
                  disabled={!onPlayFrom}
                  title={onPlayFrom ? "Play from this bar" : undefined}
                  className="absolute rounded-sm outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  style={{ left: barLeft(width, column), top: row * LINE_HEIGHT, width: barWidth(width), height: LINE_HEIGHT - 8 }}
                  onClick={() => onPlayFrom?.(bar.start)}
                />
              )),
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
        </>
      )}
    </section>
  );
}
