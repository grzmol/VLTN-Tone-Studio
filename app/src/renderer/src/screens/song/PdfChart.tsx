import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { host } from "@/host";
import { holdAutoscroll, isAutoscrollHeld, onAutoscrollResume } from "@/song/performance/autoscroll";
import { addTurn, pageAtTime } from "@/song/performance/pdf/page-turns";
import { openChart, type OpenChart } from "@/song/performance/pdf/document";
import { ANNOTATION_COLOURS, addMark, clearPage, undoMark, type AnnotationTool } from "@/song/performance/pdf/annotations";
import { scrollPdfBy, showsSpread, turnedPage, turnStep, visiblePages, type ChartLayout } from "@/song/performance/pdf/layout";
import { registerPdfTurner } from "@/song/performance/pdf/turner";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { clearChartPage, setChartPage } from "@/song/performance/pdf/current-page";
import { emptyAnnotations, readAnnotations, type ChartAnnotations, type Mark } from "@shared/chart-annotations";
import { PdfPage } from "./PdfPage";
import { PdfToolbar } from "./PdfToolbar";

/** Where the layout choice is kept. It is a per-computer preference, like the autoscroll style. */
const LAYOUT_KEY = "vltn.performance.pdf.v1";
/** Annotation edits are written this long after the last one, so a stroke sequence is one save. */
const SAVE_DELAY_MS = 800;
/** The gap between the two pages of a spread. */
const SPREAD_GAP = 16;
/** A page with no marks shares this empty list, so the page does not re-render when another page changes. */
const noMarks: Mark[] = [];

function readLayout(): ChartLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "page" ? "page" : "scroll";
  } catch {
    return "scroll";
  }
}

/** The content box of an element: its size inside its padding. */
function contentBox(el: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(el);
  const px = (value: string) => parseFloat(value) || 0;
  return {
    width: el.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    height: el.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
  };
}

/** The top of an element in the scrolling content, so it can be scrolled to whatever the scroll offset is. */
function contentTop(el: HTMLElement, scroller: HTMLElement): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

export interface PdfChartProps {
  songId: string;
  /** The reader's follow-playback switch. Page turns from the song follow only while it is on. */
  follow: boolean;
  stage: boolean;
  /** The reader's box, so the PDF fills the same space as the lyrics. */
  className: string;
  onShowText(): void;
}

/**
 * A song's PDF chart in the reader. The PDF is drawn page by page with pdf.js (in its own worker), and the annotations are kept in the
 * song's library entry. The reader's page turns (remote actions) and the song's page turns both move the PDF. A PDF that cannot be read
 * shows an error with a way back to the text chart, and never throws into the reader.
 */
export function PdfChart({ songId, follow, stage, className, onShowText }: PdfChartProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [annotations, setAnnotations] = useState<ChartAnnotations>(emptyAnnotations());
  const [layout, setLayout] = useState<ChartLayout>(readLayout);
  const [page, setPage] = useState(1);
  // The audience display shows the page on screen (spec 43); it is cleared when this chart goes.
  useEffect(() => setChartPage(songId, page), [songId, page]);
  useEffect(() => () => clearChartPage(songId), [songId]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<AnnotationTool>("none");
  const [colour, setColour] = useState<string>(ANNOTATION_COLOURS[0]);
  const root = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null);
  // Refs read by the playback and remote-action callbacks, which must not wait for a render.
  const pageRef = useRef(1),
    layoutRef = useRef<ChartLayout>(layout),
    boxRef = useRef(box),
    docRef = useRef<PDFDocumentProxy | null>(null),
    latest = useRef<ChartAnnotations>(annotations),
    pending = useRef<{ id: string; annotations: ChartAnnotations } | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Opens the PDF and reads its annotations. A missing or unreadable annotation file leaves the PDF on screen without them.
  useEffect(() => {
    let alive = true;
    let opened: OpenChart | undefined;
    setDoc(null);
    setError("");
    setNotice("");
    (async () => {
      const library = host.song.library;
      const urls = await library?.chartUrls(songId);
      if (!urls) throw new Error("This song has no PDF chart.");
      const loaded = await openChart(urls.pdf);
      if (!alive) {
        void loaded.close();
        return;
      }
      opened = loaded;
      const text = urls.annotations ? await fetch(urls.annotations).then((r) => (r.ok ? r.text() : "")).catch(() => "") : "";
      const read = text ? readAnnotations(text) : { annotations: emptyAnnotations(), skipped: 0, unreadable: false };
      if (!alive) return;
      latest.current = read.annotations;
      setAnnotations(read.annotations);
      if (read.unreadable) setNotice("The annotations could not be read, so the PDF is shown without them.");
      else if (read.skipped) setNotice(`${read.skipped} annotation${read.skipped === 1 ? "" : "s"} could not be read and left out.`);
      docRef.current = loaded.doc;
      pageRef.current = 1;
      setPage(1);
      setDoc(loaded.doc);
    })().catch((e: unknown) => {
      if (!alive) return;
      const reason = e instanceof Error ? e.message : "";
      setError(`This PDF could not be shown${reason ? `: ${reason}` : "."} The text chart is still available.`);
    });
    return () => {
      alive = false;
      docRef.current = null;
      void opened?.close();
    };
  }, [songId]);

  const save = useCallback(() => {
    clearTimeout(timer.current);
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    void host.song.library?.saveAnnotations(job.id, JSON.stringify(job.annotations)).catch((e: unknown) => {
      setNotice(`The annotations could not be saved: ${e instanceof Error ? e.message : "unknown error"}`);
    });
  }, []);
  // Edits made for one song are saved before the reader moves to another song or closes.
  useEffect(() => () => save(), [songId, save]);

  /** Applies an edit to the annotations and schedules its save. */
  const edit = (change: (current: ChartAnnotations) => ChartAnnotations) => {
    const next = change(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    setAnnotations(next);
    pending.current = { id: songId, annotations: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  };

  // The box the pages fit in: the scroller's content box, which a resize re-measures.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const next = contentBox(el);
      if (next.width !== boxRef.current.width || next.height !== boxRef.current.height) {
        boxRef.current = next;
        setBox(next);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  const pages = doc?.numPages ?? 0;
  const spread = layout === "page" && showsSpread(box.width);
  const pageBox = layout === "page" ? (spread ? { width: (box.width - SPREAD_GAP) / 2, height: box.height } : box) : { width: box.width, height: Infinity };
  const shown = layout === "page" ? visiblePages(page, pages, spread) : Array.from({ length: pages }, (_, i) => i + 1);

  /** Moves to a page. In scroll layout the page is brought to the top of the scroller. */
  const goTo = useCallback((target: number) => {
    pageRef.current = target;
    setPage(target);
    const el = scroller.current;
    if (layoutRef.current === "scroll" && el) {
      const node = el.querySelector<HTMLElement>(`[data-page="${target}"]`);
      if (node) el.scrollTo({ top: contentTop(node, el) - 8, behavior: "instant" });
    }
  }, []);

  /**
   * A turn from a remote action or a key. A page turn moves a page (a spread moves two) in page layout; in scroll layout a page turn scrolls
   * most of a screen, and a half-page turn (stage) scrolls half. A line step scrolls a little. Returns a hint at either end.
   */
  const turnBy = useCallback(
    (direction: -1 | 1, byPage: boolean, half: boolean): string | void => {
      holdAutoscroll();
      const count = docRef.current?.numPages ?? 0;
      if (layoutRef.current === "page") {
        const next = turnedPage(pageRef.current, direction, turnStep(showsSpread(boxRef.current.width)), count);
        if (next === pageRef.current) return direction > 0 ? "This is the last page." : "This is the first page.";
        goTo(next);
        return;
      }
      const el = scroller.current;
      if (!el) return "The PDF is not on screen.";
      scrollPdfBy(el, direction, byPage, half);
    },
    [goTo],
  );

  // The remote page turns reach this PDF while it is on screen, inline or in stage mode (see screens/song/remote-view.ts).
  useEffect(() => {
    if (!doc) return;
    return registerPdfTurner({ element: () => scroller.current, turn: turnBy });
  }, [doc, turnBy]);

  // Scroll layout: the page on screen is the one at the top of the scroller, so the page count and the turns agree with the scroll.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc || layout !== "scroll") return;
    const onScroll = () => {
      const line = el.scrollTop + el.clientHeight * 0.3;
      let current = 1;
      el.querySelectorAll<HTMLElement>("[data-page]").forEach((node) => {
        if (contentTop(node, el) <= line) current = Number(node.dataset.page);
      });
      if (current !== pageRef.current) {
        pageRef.current = current;
        setPage(current);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [doc, layout, shown.length]);

  // Follow playback: the song's page turns move the PDF to the page for the song time, unless the performer has just scrolled or turned.
  useEffect(() => {
    if (!doc || !follow) return;
    const turns = annotations.turns;
    const apply = (position: number) => {
      if (!turns.length || isAutoscrollHeld()) return;
      const target = Math.min(doc.numPages, pageAtTime(turns, position));
      if (target !== pageRef.current) goTo(target);
    };
    apply(usePlaybackClock.getState().position);
    const unsubscribe = usePlaybackClock.subscribe((state) => apply(state.position));
    const stop = onAutoscrollResume(() => apply(usePlaybackClock.getState().position));
    return () => {
      unsubscribe();
      stop();
    };
  }, [doc, follow, annotations.turns, goTo]);

  const chooseLayout = (value: ChartLayout) => {
    layoutRef.current = value;
    setLayout(value);
    try {
      localStorage.setItem(LAYOUT_KEY, value);
    } catch {
      /* Storage can be blocked. The layout then lasts for this session. */
    }
    if (value === "scroll") requestAnimationFrame(() => goTo(pageRef.current));
  };

  const onError = useCallback((message: string) => setNotice(message), []);
  const editing = !stage && !!doc;

  if (error) {
    return (
      <div className={className + " flex flex-col items-start gap-3 rounded-lg p-4"}>
        <p role="alert" className="text-red-400">
          {error}
        </p>
        <Button variant="outline" onClick={onShowText}>
          Show text chart
        </Button>
      </div>
    );
  }

  return (
    <div ref={root} className={className + " flex min-h-0 flex-col"}>
      {doc && (
        <PdfToolbar
          layout={layout}
          onLayout={chooseLayout}
          page={page}
          pages={pages}
          onPage={(direction) => turnBy(direction, true, false)}
          editing={editing}
          tool={tool}
          onTool={setTool}
          colour={colour}
          onColour={setColour}
          onUndo={() => edit((a) => undoMark(a, page))}
          onClearPage={() => edit((a) => clearPage(a, page))}
          turns={annotations.turns.length}
          onTurnNow={() => edit((a) => ({ ...a, turns: addTurn(a.turns, usePlaybackClock.getState().position) }))}
          onClearTurns={() => edit((a) => ({ ...a, turns: [] }))}
        />
      )}
      {notice && (
        <p role="status" className="mb-2 shrink-0 text-sm text-amber-400">
          {notice}
        </p>
      )}
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="PDF chart"
        onWheel={() => holdAutoscroll()}
        onTouchMove={() => holdAutoscroll()}
        className={
          "relative min-h-0 flex-1 overscroll-contain rounded-lg p-3 " + (layout === "page" ? "overflow-hidden" : "overflow-y-auto")
        }
      >
        {!doc ? (
          <p className="text-sm text-silkscreen-3">Loading the PDF chart…</p>
        ) : (
          <div className={layout === "page" ? "flex h-full items-start justify-center gap-4" : "flex flex-col items-center gap-4"}>
            {shown.map((n) => (
              <PdfPage
                key={n}
                doc={doc}
                page={n}
                box={pageBox}
                marks={annotations.pages[String(n)] ?? noMarks}
                tool={stage ? "none" : tool}
                colour={colour}
                onAdd={(mark: Mark) => edit((a) => addMark(a, n, mark))}
                onError={onError}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
