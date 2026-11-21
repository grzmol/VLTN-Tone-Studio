import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPdfTurners, pdfOnScreen, registerPdfTurner, turnVisiblePdf } from "./turner";

/** An element that is on screen (it has a box) or hidden (it has none), as the reader's hidden panel does. */
function element(visible: boolean): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "getClientRects", { value: () => (visible ? [{}] : []) });
  return el;
}

beforeEach(() => clearPdfTurners());
afterEach(() => clearPdfTurners());

describe("turnVisiblePdf", () => {
  it("returns null when no PDF is on screen, so the lyrics take the action", () => {
    expect(turnVisiblePdf(1, true, false)).toBeNull();
    const hidden = element(false);
    registerPdfTurner({ element: () => hidden, turn: vi.fn() });
    expect(turnVisiblePdf(1, true, false)).toBeNull();
    expect(pdfOnScreen()).toBe(false);
  });

  it("sends the turn to the PDF that is on screen, with its direction, page and half-page flags", () => {
    const turn = vi.fn(() => undefined);
    registerPdfTurner({ element: () => element(true), turn });
    expect(turnVisiblePdf(-1, true, true)).toEqual({ hint: undefined });
    expect(turn).toHaveBeenCalledWith(-1, true, true);
    expect(pdfOnScreen()).toBe(true);
  });

  it("passes on the hint from a turn that did not move, such as the last page", () => {
    registerPdfTurner({ element: () => element(true), turn: () => "This is the last page." });
    expect(turnVisiblePdf(1, true, false)).toEqual({ hint: "This is the last page." });
  });

  it("forgets a PDF when its reader unregisters", () => {
    const stop = registerPdfTurner({ element: () => element(true), turn: vi.fn() });
    stop();
    expect(turnVisiblePdf(1, true, false)).toBeNull();
  });
});
