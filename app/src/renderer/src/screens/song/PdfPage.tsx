import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Input } from "@/components/ui/input";
import type { Mark, Point } from "@shared/chart-annotations";
import { fitScale } from "@/song/performance/pdf/layout";
import { clampPoint, strokeMark, textMark, type AnnotationTool } from "@/song/performance/pdf/annotations";
import { drawMark } from "@/song/performance/pdf/draw";

/** A4 proportions, used for the box of a page until its real size is known, so the page is in place before it draws. */
const PLACEHOLDER_RATIO = 1.4142;

export interface PdfPageProps {
  doc: PDFDocumentProxy;
  /** The page number, from 1. */
  page: number;
  /** The box the page must fit in, in CSS pixels. An infinite height fits the width only. */
  box: { width: number; height: number };
  marks: Mark[];
  /** The tool drawing on this page. `none` takes no pointer input. */
  tool: AnnotationTool;
  colour: string;
  onAdd(mark: Mark): void;
  onError(message: string): void;
}

/** A pdf.js render that was stopped on purpose is not an error. */
const isCancelled = (e: unknown) => e instanceof Error && e.name === "RenderingCancelledException";

/**
 * One page of the PDF: the page drawn by pdf.js, and a transparent canvas on top for the marks. The page is drawn once it scrolls near the
 * reader, so a long chart does not render every page at once. The PDF is never changed; the marks belong to the annotation file.
 */
export function PdfPage({ doc, page, box, marks, tool, colour, onAdd, onError }: PdfPageProps) {
  const wrap = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [note, setNote] = useState<Point | null>(null);
  // The note's place, kept in a ref too: Enter closes the note and the field then loses focus, which must not add it twice.
  const notePlace = useRef<Point | null>(null);
  const points = useRef<Point[]>([]);

  useEffect(() => {
    const el = wrap.current;
    if (visible || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  // Draws the page at the size its box allows. A new box (a resize, or a turn in page mode) draws it again.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let task: RenderTask | undefined;
    (async () => {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: fitScale(base.width, base.height, box.width, box.height) });
      const target = canvas.current;
      if (!alive || !target) return;
      const dpr = window.devicePixelRatio || 1;
      target.width = Math.floor(viewport.width * dpr);
      target.height = Math.floor(viewport.height * dpr);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      setSize({ width: viewport.width, height: viewport.height });
      task = pdfPage.render({ canvas: target, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      await task.promise;
    })().catch((e: unknown) => {
      if (alive && !isCancelled(e)) onError(`Page ${page} could not be drawn.`);
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [visible, doc, page, box.width, box.height, onError]);

  // The marks, and the stroke being drawn, on the transparent canvas over the page.
  useEffect(() => {
    const target = overlay.current;
    if (!target || !size) return;
    const dpr = window.devicePixelRatio || 1;
    target.width = Math.floor(size.width * dpr);
    target.height = Math.floor(size.height * dpr);
    target.style.width = `${size.width}px`;
    target.style.height = `${size.height}px`;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    for (const mark of draft ? [...marks, draft] : marks) drawMark(ctx, mark, size.width, size.height);
  }, [marks, size, draft]);

  const toPoint = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clampPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };
  // The stroke tool in use, or null for a tool that does not draw (text notes and none take a click instead).
  const stroke = tool === "pen" || tool === "highlighter" ? tool : null;

  const openNote = (at: Point) => {
    notePlace.current = at;
    setNote(at);
  };
  /** Closes the note. Text that is given (not cancelled) becomes a mark, once. */
  const finishNote = (text: string | null) => {
    const at = notePlace.current;
    if (!at) return;
    notePlace.current = null;
    setNote(null);
    const mark = text === null ? null : textMark(colour, at.x, at.y, text);
    if (mark) onAdd(mark);
  };

  return (
    <div
      ref={wrap}
      data-page={page}
      aria-label={`Page ${page}`}
      className="relative mx-auto shrink-0 bg-white shadow-lg"
      style={{
        width: size?.width ?? box.width,
        height: size?.height ?? (box.width > 0 ? box.width * PLACEHOLDER_RATIO : 0),
      }}
    >
      <canvas ref={canvas} className="absolute top-0 left-0" aria-hidden="true" />
      <canvas
        ref={overlay}
        aria-label={`Annotations on page ${page}`}
        className={"absolute top-0 left-0 " + (tool === "none" ? "pointer-events-none" : "cursor-crosshair touch-none")}
        onPointerDown={(event) => {
          if (!stroke) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          points.current = [toPoint(event)];
          setDraft(strokeMark(stroke, colour, points.current));
        }}
        onPointerMove={(event) => {
          if (!stroke || !points.current.length) return;
          points.current = [...points.current, toPoint(event)];
          setDraft(strokeMark(stroke, colour, points.current));
        }}
        onPointerUp={() => {
          if (!stroke || !points.current.length) return;
          const mark = strokeMark(stroke, colour, points.current);
          points.current = [];
          setDraft(null);
          if (mark) onAdd(mark);
        }}
        onClick={(event) => {
          if (tool === "text") openNote(toPoint(event));
        }}
      />
      {note && (
        <Input
          autoFocus
          aria-label={`Note on page ${page}`}
          placeholder="Type a note, then press Enter"
          maxLength={500}
          className="absolute h-8 w-56 bg-white text-sm text-black"
          style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%` }}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishNote(event.currentTarget.value);
            if (event.key === "Escape") finishNote(null);
          }}
          onBlur={(event) => finishNote(event.currentTarget.value)}
        />
      )}
    </div>
  );
}
