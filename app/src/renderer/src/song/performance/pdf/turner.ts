/*
 * The page turns that remote actions make (spec 31): a page-turner or key that asks for the next or previous page. The reader that is on
 * screen registers itself here, so the turn reaches the PDF in the inline reader or in stage mode, and a page-turner works in both.
 * When no PDF is on screen, the turn falls back to the lyrics, which the caller handles.
 */

export interface PdfTurner {
  /** The element whose box shows the PDF. A hidden reader has no boxes, so the visible one takes the turn. */
  element(): HTMLElement | null;
  /** Turns a page (or scrolls the PDF when it is laid out as a scroll). `half` is a half-page scroll in scroll layout. Returns a hint when it did not move. */
  turn(direction: -1 | 1, page: boolean, half: boolean): string | void;
}

const turners = new Set<PdfTurner>();

/** Registers a PDF on screen. Returns the function that removes it. */
export function registerPdfTurner(turner: PdfTurner): () => void {
  turners.add(turner);
  return () => turners.delete(turner);
}

/**
 * Sends the turn to the PDF on screen. Null when no PDF is on screen, so the caller scrolls the lyrics instead. Otherwise the result is the
 * hint from the turn (undefined when it moved).
 */
export function turnVisiblePdf(direction: -1 | 1, page: boolean, half: boolean): { hint: string | void } | null {
  for (const turner of turners) {
    if (turner.element()?.getClientRects().length) return { hint: turner.turn(direction, page, half) };
  }
  return null;
}

/** Whether a PDF is on screen, for the actions that should say so. */
export function pdfOnScreen(): boolean {
  return [...turners].some((turner) => turner.element()?.getClientRects().length);
}

/** For tests: forgets every registered PDF. */
export function clearPdfTurners(): void {
  turners.clear();
}
