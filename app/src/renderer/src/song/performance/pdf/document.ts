import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

/*
 * Opens a song's PDF chart with pdf.js (Apache-2.0, see song/audio/NOTICE.md). The parser runs in pdf.js's own worker, so a large or
 * damaged file does not stall the reader. The file is fetched from the app's library protocol, never by a path, and read into memory first.
 * pdf.js is loaded on first use, so the rest of the app does not carry it.
 */

type PdfJs = typeof import("pdfjs-dist");
type DocumentOptions = Omit<Parameters<PdfJs["getDocument"]>[0] & object, "data">;
let pdfjs: Promise<PdfJs> | undefined;

/**
 * The options that point pdf.js at its data files: the standard fonts (charts that do not embed Helvetica, Times and the other standard
 * faces), the WASM image decoders, and the CMaps (packed) for CJK text. `base` is the folder the files are published in (`pdfjs/`).
 */
export function pdfjsOptions(base: string): DocumentOptions {
  return {
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
  };
}

/** The folder the renderer's pdf.js data files are served from: next to the page in the desktop app and the browser build. */
export function pdfjsBase(): string {
  return new URL("pdfjs/", document.baseURI).href;
}

function library(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return pdfjs;
}

/** An open PDF, and the way to close it: destroying the loading task frees the document and its worker. */
export interface OpenChart {
  doc: PDFDocumentProxy;
  close(): Promise<void>;
}

/** Fetches the PDF at `url` and opens it. Rejects with a readable message when it is missing or is not a PDF pdf.js can read. */
export async function openChart(url: string): Promise<OpenChart> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The PDF is missing from the library.");
  const data = new Uint8Array(await response.arrayBuffer());
  const lib = await library();
  const task = lib.getDocument({ data, ...pdfjsOptions(pdfjsBase()) });
  try {
    return { doc: await task.promise, close: () => task.destroy() };
  } catch (e) {
    await task.destroy().catch(() => {});
    throw e;
  }
}
