import type { ViewHost } from "@/song/performance/actions";
import { holdAutoscroll } from "@/song/performance/autoscroll";
import { useReaderText } from "@/song/performance/reader-text";
import type { MetronomeMode } from "@/song/performance/rhythm";
import type { Mix } from "@/song/stems/mix";
import { toggleMuteGroup, type TrackInfo } from "@/song/tracks";

/** What the performance screen holds that the remote actions reach: the stage, the click, the mixer and the tap. */
export interface ViewState {
  stage: boolean;
  setStage(value: boolean): void;
  metronome: MetronomeMode;
  setMetronome(mode: MetronomeMode): void;
  mix: Mix;
  setMix(mix: Mix): void;
  tracks: Record<string, TrackInfo>;
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
 * `scrollLyrics` moves the visible reader by a line, or by a page for a page action, in stage mode too.
 */
export function buildViewHost(state: ViewState): ViewHost {
  return {
    scrollLyrics: (direction, pages) => {
      // A remote turn is a manual one: autoscroll waits for it, and then returns to the song position.
      holdAutoscroll();
      const reader = visibleReader();
      if (!reader) return "Lyrics are not on screen.";
      const step = pages ? reader.clientHeight * 0.9 : SCROLL_STEP_PX;
      reader.scrollBy({ top: direction * step, behavior: "smooth" });
    },
    fontSize: (direction) => useReaderText.getState().step(direction),
    toggleStage: () => state.setStage(!state.stage),
    muteGroup: (group) => {
      const result = toggleMuteGroup(state.mix, state.tracks, group);
      if ("hint" in result) return result.hint;
      state.setMix(result.mix);
    },
    // A click that is off comes on while the song plays; a click that is on goes off.
    toggleClick: () => state.setMetronome(state.metronome === "off" ? "playing" : "off"),
    tap: () => state.tap(),
  };
}
