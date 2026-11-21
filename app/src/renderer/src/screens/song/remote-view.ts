import type { ViewHost } from "@/song/performance/actions";
import { holdAutoscroll } from "@/song/performance/autoscroll";
import { useReaderText } from "@/song/performance/reader-text";
import type { MetronomeMode } from "@/song/performance/rhythm";
import type { Mix } from "@/song/stems/mix";
import { toggleMuteGroup, type TrackInfo } from "@/song/tracks";
import { pdfOnScreen, turnVisiblePdf } from "@/song/performance/pdf/turner";
import { partKeysOf, type PartChoices } from "@/song/band/part-choice";

/** What the performance screen holds that the remote actions reach: the stage, the click, the mixer and the tap. */
export interface ViewState {
  stage: boolean;
  setStage(value: boolean): void;
  metronome: MetronomeMode;
  setMetronome(mode: MetronomeMode): void;
  mix: Mix;
  setMix(mix: Mix): void;
  tracks: Record<string, TrackInfo>;
  /** The drums and bass choice, and how to change it. */
  partChoices: PartChoices;
  choosePart(patch: Partial<PartChoices>): void;
  tap(): void;
}

/** How far a scroll step moves the lyrics, in pixels. A page is nine tenths of the visible lyrics. */
const SCROLL_STEP_PX = 80;

/**
 * The reader's scrolling panel that is on screen. Stage mode and the inline reader both render one, and the hidden one has no
 * boxes, so the visible one is the one that scrolls.
 */
function visibleReader(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[data-reader-scroll]")].find((el) => el.getClientRects().length > 0);
}

/**
 * The view actions for the current render of the performance screen. The session is given them again whenever they change.
 * `scrollLyrics` also turns the pages of a PDF chart when one is on screen: a page action turns a page, a line action scrolls. Stage mode
 * turns half a page at a time in a scrolling PDF, so a page-turner works in both.
 */
export function buildViewHost(state: ViewState): ViewHost {
  return {
    scrollLyrics: (direction, pages) => {
      // A remote turn is a manual one: autoscroll waits for it, and then returns to the song position.
      holdAutoscroll();
      const pdf = turnVisiblePdf(direction, pages, state.stage);
      if (pdf) return pdf.hint;
      const reader = visibleReader();
      if (!reader) return "Lyrics are not on screen.";
      const step = pages ? reader.clientHeight * 0.9 : SCROLL_STEP_PX;
      reader.scrollBy({ top: direction * step, behavior: "smooth" });
    },
    pdfOnScreen,
    fontSize: (direction) => useReaderText.getState().step(direction),
    toggleStage: () => state.setStage(!state.stage),
    muteGroup: (group) => {
      const result = toggleMuteGroup(state.mix, state.tracks, group);
      if ("hint" in result) return result.hint;
      state.setMix(result.mix);
    },
    // A click that is off comes on while the song plays; a click that is on goes off.
    toggleClick: () => state.setMetronome(state.metronome === "off" ? "playing" : "off"),
    togglePart: (kind) => {
      // Only a part with a generated track has something to switch to; the original is always there to fall back on.
      if (!partKeysOf(state.tracks, null)[kind]?.generated) return `Generate the ${kind} first.`;
      state.choosePart({ [kind]: state.partChoices[kind] === "original" ? "generated" : "original" });
    },
    tap: () => state.tap(),
  };
}
