import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { fitScale } from "@/song/performance/pdf/layout";
import { openChart } from "@/song/performance/pdf/document";

/**
 * One page of the song's PDF, fitted to the audience screen. It draws the page only: the performer's marks stay with the performer's
 * screen. The file comes from the song library's protocol, which the audience window's content policy allows.
 */
export function AudiencePdf({ url, page }: { url: string; page: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const wrap = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    let close: (() => Promise<void>) | undefined;
    setFailed(false);
    openChart(url)
      .then((chart) => {
        if (!live) {
          void chart.close();
          return;
        }
        close = chart.close;
        setDoc(chart.doc);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      setDoc(null);
      void close?.();
    };
  }, [url]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !box.width || !box.height) return;
    let alive = true;
    let task: RenderTask | undefined;
    (async () => {
      const pdfPage = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: fitScale(base.width, base.height, box.width, box.height) });
      const target = canvas.current;
      if (!alive || !target) return;
      const dpr = window.devicePixelRatio || 1;
      target.width = Math.floor(viewport.width * dpr);
      target.height = Math.floor(viewport.height * dpr);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      task = pdfPage.render({ canvas: target, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      await task.promise;
    })().catch(() => {
      // A page turn that was cancelled is not an error; a page that cannot be drawn leaves the last page on screen.
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, page, box]);

  if (failed) return <p className="p-[5vh] text-center text-[3vh] text-silkscreen-3">The PDF chart could not be shown.</p>;
  return (
    <div ref={wrap} className="flex h-full w-full items-center justify-center">
      <canvas ref={canvas} aria-label={`Chart page ${page}`} />
    </div>
  );
}
