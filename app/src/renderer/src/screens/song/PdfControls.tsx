import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { host } from "@/host";
import { useSongLibrary } from "@/song/library";
import { CHART_PDF_MAX_BYTES, type ChartView } from "@shared/song-library";

export interface PdfControlsProps {
  songId: string;
  /** Whether the song has a PDF chart in the library. */
  chart: boolean;
  view: ChartView;
  /** In stage mode the view can still be switched, but a PDF is not attached or removed. */
  stage: boolean;
  onView(view: ChartView): void;
}

/**
 * The PDF buttons in the reader's header: show the PDF or the text chart, and attach, replace or remove the PDF. The PDF is read into memory
 * and sent to the library in one piece. A file over the size limit is refused here, and the main process checks it again.
 */
export function PdfControls({ songId, chart, view, stage, onView }: PdfControlsProps) {
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const library = host.song.library;

  const attach = async (file: File) => {
    if (!library) return;
    if (file.size > CHART_PDF_MAX_BYTES) {
      setNotice("This PDF is larger than 50 MB, so it was not attached. Choose a smaller file.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await library.attachChart(songId, new Uint8Array(await file.arrayBuffer()));
      await useSongLibrary.getState().refresh();
      onView("pdf");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The PDF could not be attached.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!library) return;
    setBusy(true);
    setNotice("");
    try {
      await library.removeChart(songId);
      await useSongLibrary.getState().refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The PDF could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {chart && (
        <Button variant="outline" aria-pressed={view === "pdf"} onClick={() => onView(view === "pdf" ? "text" : "pdf")}>
          {view === "pdf" ? "Show text chart" : "Show PDF chart"}
        </Button>
      )}
      {!stage && library && (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            aria-label="Choose a PDF chart"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void attach(file);
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {chart ? "Replace PDF chart" : "Attach PDF chart"}
          </Button>
          {chart && (
            <Button variant="outline" disabled={busy} onClick={() => void remove()}>
              Remove PDF chart
            </Button>
          )}
        </>
      )}
      {notice && (
        <span role="alert" className="basis-full text-sm text-amber-400">
          {notice}
        </span>
      )}
    </>
  );
}
