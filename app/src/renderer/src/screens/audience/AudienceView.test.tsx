import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudienceModel, AudienceState } from "@shared/audience";
import { AudienceView } from "./AudienceView";

/** The audience window's feed: the test pushes state through it, as the preload would. */
function feed(initial: AudienceState) {
  let listener: ((state: AudienceState) => void) | null = null;
  let current = initial;
  window.audienceFeed = {
    subscribe: (callback) => {
      listener = callback;
      callback(current);
      return () => {
        listener = null;
      };
    },
  };
  return {
    // As the preload does: a null part of the update keeps what was there.
    push(update: AudienceState) {
      current = { model: update.model ?? current.model, clock: update.clock ?? current.clock };
      act(() => listener?.(current));
    },
  };
}

const model = (patch: Partial<AudienceModel> = {}): AudienceModel => ({
  songKey: "song-1",
  screen: "lyrics",
  blackout: false,
  blackBetweenSongs: false,
  title: "Harbour Lights",
  nextTitle: "Kitchen Table",
  timed: true,
  lines: [
    { time: 1, heading: null, text: "Harbour lights", chords: ["G"] },
    { time: 5, heading: null, text: "Shine on me", chords: ["C"] },
    { time: 9, heading: null, text: "Last line", chords: [] },
  ],
  showChords: true,
  fontScale: 1,
  rotation: 0,
  pdf: null,
  ...patch,
});

afterEach(() => {
  cleanup();
  delete window.audienceFeed;
  vi.useRealTimers();
});

describe("AudienceView", () => {
  it("shows the logo while no song is on, and nothing at all when blacked out", () => {
    feed({ model: model({ screen: "logo", lines: [], title: "", timed: false }), clock: null });
    const { unmount } = render(<AudienceView />);
    expect(screen.getByText("VLTN Tone Studio")).toBeTruthy();
    unmount();
    feed({ model: model({ blackout: true }), clock: null });
    render(<AudienceView />);
    expect(screen.queryByText("Harbour lights")).toBeNull();
    expect(screen.queryByText("Harbour Lights")).toBeNull();
  });

  it("shows the line that is on screen, its chords and the next line, large and with the song and the next title", () => {
    const now = Date.now();
    feed({ model: model(), clock: { songKey: "song-1", songPosition: 6, at: now, rate: 1, playing: false } });
    render(<AudienceView />);
    expect(screen.getByText("Shine on me")).toBeTruthy();
    expect(screen.getByLabelText("Chords").textContent).toBe("C");
    expect(screen.getByText("Last line")).toBeTruthy();
    expect(screen.getByText("Harbour Lights")).toBeTruthy();
    expect(screen.getByText("Next: Kitchen Table")).toBeTruthy();
  });

  it("hides the chord row when the performer turns chords off", () => {
    feed({ model: model({ showChords: false }), clock: { songKey: "song-1", songPosition: 6, at: Date.now(), rate: 1, playing: false } });
    render(<AudienceView />);
    expect(screen.queryByLabelText("Chords")).toBeNull();
  });

  it("follows the song between snapshots: the line changes on its own while playing", () => {
    vi.useFakeTimers({ now: 10_000 });
    const pushes = feed({ model: model(), clock: { songKey: "song-1", songPosition: 0, at: Date.now(), rate: 1, playing: true } });
    const { container } = render(<AudienceView />);
    // The large line is the one on screen: nothing before the first timed line starts.
    const large = () => container.querySelector("p.font-semibold")?.textContent;
    expect(large()).toBe("");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(large()).toBe("Harbour lights");
    pushes.push({ model: null, clock: { songKey: "song-1", songPosition: 5.5, at: Date.now(), rate: 1, playing: false } });
    expect(large()).toBe("Shine on me");
  });

  it("shows an untimed chart as text from the top, without following the song", () => {
    feed({
      model: model({
        timed: false,
        lines: [
          { time: null, heading: "Verse", text: "", chords: [] },
          { time: null, heading: null, text: "Verse one", chords: [] },
        ],
      }),
      clock: null,
    });
    render(<AudienceView />);
    expect(screen.getByText("Verse one")).toBeTruthy();
    expect(screen.getByText("Verse")).toBeTruthy();
  });

  it("is black between songs while the song is stopped at its start, and shows the line once it plays", () => {
    const pushes = feed({ model: model({ blackBetweenSongs: true }), clock: { songKey: "song-1", songPosition: 0, at: Date.now(), rate: 1, playing: false } });
    const { container } = render(<AudienceView />);
    expect(container.textContent).toBe("");
    pushes.push({ model: null, clock: { songKey: "song-1", songPosition: 0, at: Date.now(), rate: 1, playing: true } });
    expect(container.textContent).toContain("Harbour Lights");
  });
});
