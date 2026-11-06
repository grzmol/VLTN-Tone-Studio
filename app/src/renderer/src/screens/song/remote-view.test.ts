// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPdfTurners, registerPdfTurner } from "@/song/performance/pdf/turner";
import { buildViewHost, type ViewState } from "./remote-view";

const state = (): ViewState => ({
  stage: false,
  setStage: vi.fn(),
  metronome: "off",
  setMetronome: vi.fn(),
  mix: { gains: {}, pans: {}, muted: [], soloed: [] } as unknown as ViewState["mix"],
  setMix: vi.fn(),
  tracks: {},
  tap: vi.fn(),
});

/** An element that is on screen (it has a box) or hidden (it has none), as a reader that is not showing has. */
function shown(el: HTMLElement, on: boolean): HTMLElement {
  Object.defineProperty(el, "getClientRects", { value: () => (on ? [{}] : []) });
  return el;
}

beforeEach(() => clearPdfTurners());
afterEach(() => {
  clearPdfTurners();
  document.body.innerHTML = "";
});

describe("page actions with a PDF on screen", () => {
  it("turns a page for a page action and scrolls by a line for a line action", () => {
    const turn = vi.fn(() => undefined);
    const pdf = shown(document.createElement("div"), true);
    document.body.appendChild(pdf);
    registerPdfTurner({ element: () => pdf, turn });
    const host = buildViewHost(state());
    expect(host.scrollLyrics(1, true)).toBeUndefined();
    expect(turn).toHaveBeenLastCalledWith(1, true, false);
    host.scrollLyrics(-1, false);
    expect(turn).toHaveBeenLastCalledWith(-1, false, false);
  });

  it("gives a half-page turn in stage mode, so a page-turner works there too", () => {
    const turn = vi.fn(() => undefined);
    const pdf = shown(document.createElement("div"), true);
    document.body.appendChild(pdf);
    registerPdfTurner({ element: () => pdf, turn });
    buildViewHost({ ...state(), stage: true }).scrollLyrics(1, true);
    expect(turn).toHaveBeenCalledWith(1, true, true);
  });

  it("tells the actions that a PDF is on screen, so the default section keys turn its pages", () => {
    expect(buildViewHost(state()).pdfOnScreen()).toBe(false);
    const pdf = shown(document.createElement("div"), true);
    document.body.appendChild(pdf);
    registerPdfTurner({ element: () => pdf, turn: () => undefined });
    expect(buildViewHost(state()).pdfOnScreen()).toBe(true);
  });

  it("passes on the hint of a turn that did not move", () => {
    const pdf = shown(document.createElement("div"), true);
    document.body.appendChild(pdf);
    registerPdfTurner({ element: () => pdf, turn: () => "This is the last page." });
    expect(buildViewHost(state()).scrollLyrics(1, true)).toBe("This is the last page.");
  });
});

describe("page actions with lyrics on screen", () => {
  it("scrolls the lyrics by a page when no PDF is on screen", () => {
    const reader = shown(document.createElement("div"), true);
    reader.setAttribute("data-reader-scroll", "");
    reader.scrollBy = vi.fn();
    Object.defineProperty(reader, "clientHeight", { value: 500 });
    document.body.appendChild(reader);
    buildViewHost(state()).scrollLyrics(1, true);
    expect(reader.scrollBy).toHaveBeenCalledWith({ top: 450, behavior: "smooth" });
  });

  it("says the lyrics are not on screen when neither a PDF nor the reader is", () => {
    expect(buildViewHost(state()).scrollLyrics(1, true)).toBe("Lyrics are not on screen.");
  });
});
