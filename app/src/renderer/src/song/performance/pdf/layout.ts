/*
 * How a PDF page is laid out in the reader (pure). The reader measures its box and passes the size in; this returns the scale and the
 * pages that are shown. Two pages sit side by side when the box is wide enough, so a wide screen shows a spread like a book.
 */

/** Boxes at least this wide show two pages side by side in page mode. */
export const SPREAD_MIN_WIDTH = 900;

export type ChartLayout = "scroll" | "page";

/** The scale that fits a page of `pageWidth` by `pageHeight` (PDF points) into `boxWidth` by `boxHeight` CSS pixels. */
export function fitScale(pageWidth: number, pageHeight: number, boxWidth: number, boxHeight: number): number {
  if (!(pageWidth > 0) || !(pageHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return 1;
  return Math.min(boxWidth / pageWidth, boxHeight / pageHeight);
}

/** Whether page mode shows two pages at once for a box this wide. */
export function showsSpread(boxWidth: number): boolean {
  return boxWidth >= SPREAD_MIN_WIDTH;
}

/** How many pages a page turn moves: a spread turns both of its pages together. */
export function turnStep(spread: boolean): number {
  return spread ? 2 : 1;
}

/** The pages on screen in page mode, starting from `first` (1-based). A spread on the last odd page shows one page. */
export function visiblePages(first: number, count: number, spread: boolean): number[] {
  const last = Math.min(count, first + (spread ? 1 : 0));
  const pages: number[] = [];
  for (let page = Math.max(1, first); page <= last; page++) pages.push(page);
  return pages;
}

/** The page a turn lands on, kept between 1 and `count`. A turn past either end stays on the end page. */
export function turnedPage(current: number, direction: -1 | 1, step: number, count: number): number {
  return Math.min(Math.max(1, count), Math.max(1, current + direction * step));
}

/** A line step in scroll layout moves the PDF this many pixels. */
export const LINE_STEP_PX = 80;

/**
 * Scrolls a PDF laid out as a scroll by a remote or key turn: a page turn moves nine tenths of the box, a half-page turn (stage) moves
 * half, and a line step moves `LINE_STEP_PX`. The scroll is instant, not smooth: a smooth scroll is animated frame by frame, and a window
 * that is not painting (a hidden or unfocused Electron window) would hold it where it is until the window is shown again.
 */
export function scrollPdfBy(
  el: { clientHeight: number; scrollBy(options: ScrollToOptions): void },
  direction: -1 | 1,
  byPage: boolean,
  half: boolean,
): void {
  const distance = byPage ? (half ? 0.5 : 0.9) * el.clientHeight : LINE_STEP_PX;
  el.scrollBy({ top: direction * distance, behavior: "instant" });
}
