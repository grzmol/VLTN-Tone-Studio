// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("page actions with lyrics on screen", () => {
  it("scrolls the lyrics by a page", () => {
    const reader = shown(document.createElement("div"), true);
    reader.setAttribute("data-reader-scroll", "");
    reader.scrollBy = vi.fn();
    Object.defineProperty(reader, "clientHeight", { value: 500 });
    document.body.appendChild(reader);
    buildViewHost(state()).scrollLyrics(1, true);
    expect(reader.scrollBy).toHaveBeenCalledWith({ top: 450, behavior: "smooth" });
  });

  it("says the lyrics are not on screen when the reader is not", () => {
    expect(buildViewHost(state()).scrollLyrics(1, true)).toBe("Lyrics are not on screen.");
  });
});
