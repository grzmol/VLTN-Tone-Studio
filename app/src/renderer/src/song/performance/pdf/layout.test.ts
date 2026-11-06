import { describe, expect, it, vi } from "vitest";
import { LINE_STEP_PX, SPREAD_MIN_WIDTH, fitScale, scrollPdfBy, showsSpread, turnStep, turnedPage, visiblePages } from "./layout";

describe("fitScale", () => {
  it("fits a page into the box by its tighter side", () => {
    expect(fitScale(600, 800, 300, 1000)).toBe(0.5);
    expect(fitScale(600, 800, 1200, 400)).toBe(0.5);
  });

  it("fits the width alone when the height is unlimited, as a scroll does", () => {
    expect(fitScale(600, 800, 300, Number.POSITIVE_INFINITY)).toBe(0.5);
  });

  it("falls back to 1 for a box or page that has no size yet", () => {
    expect(fitScale(0, 800, 300, 300)).toBe(1);
    expect(fitScale(600, 800, 0, 300)).toBe(1);
  });
});

describe("spreads and page turns", () => {
  it("shows two pages side by side only when the box is wide enough", () => {
    expect(showsSpread(SPREAD_MIN_WIDTH - 1)).toBe(false);
    expect(showsSpread(SPREAD_MIN_WIDTH)).toBe(true);
  });

  it("shows the pages from the current page, and one page on the last odd page of a spread", () => {
    expect(visiblePages(3, 10, false)).toEqual([3]);
    expect(visiblePages(3, 10, true)).toEqual([3, 4]);
    expect(visiblePages(5, 5, true)).toEqual([5]);
  });

  it("turns a spread by two pages and a single page by one", () => {
    expect(turnStep(true)).toBe(2);
    expect(turnStep(false)).toBe(1);
    expect(turnedPage(1, 1, turnStep(true), 9)).toBe(3);
  });

  it("stops at the first and last page rather than leaving the chart", () => {
    expect(turnedPage(1, -1, 1, 4)).toBe(1);
    expect(turnedPage(4, 1, 2, 4)).toBe(4);
    expect(turnedPage(3, 1, 2, 4)).toBe(4);
  });
});

describe("scrollPdfBy", () => {
  /** A scroller of the given box height that records its scrolls. */
  function scroller(clientHeight: number) {
    return { clientHeight, scrollBy: vi.fn() };
  }

  it("turns nine tenths of the box for a page turn outside stage mode", () => {
    const el = scroller(600);
    scrollPdfBy(el, 1, true, false);
    expect(el.scrollBy).toHaveBeenCalledWith({ top: 540, behavior: "instant" });
  });

  it("turns half the box for a page turn in stage mode, backwards when the direction is -1", () => {
    const el = scroller(600);
    scrollPdfBy(el, -1, true, true);
    expect(el.scrollBy).toHaveBeenCalledWith({ top: -300, behavior: "instant" });
  });

  it("scrolls a line step by a fixed distance", () => {
    const el = scroller(600);
    scrollPdfBy(el, 1, false, false);
    expect(el.scrollBy).toHaveBeenCalledWith({ top: LINE_STEP_PX, behavior: "instant" });
  });

  it("always scrolls instantly, so a window that is not painting still moves", () => {
    const el = scroller(600);
    scrollPdfBy(el, 1, true, true);
    expect(el.scrollBy.mock.calls[0][0]).toMatchObject({ behavior: "instant" });
  });
});
