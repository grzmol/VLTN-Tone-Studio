import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoscroll } from "@/song/performance/autoscroll";
import { setClockPosition } from "@/song/performance/playback-clock";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { PerformanceReader } from "./PerformanceReader";


const at = (seconds: number) => act(() => setClockPosition(seconds));

afterEach(() => {
  cleanup();
  setClockPosition(0);
});
it("follows playback and backward seeks, transposes chords, and can stop following", () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollTo = scroll;
  const props = { title: "Song", chart: "[00:01] [C] First\n[00:05] [G] Second", lyrics: "", shift: 2 };
  at(1);
  render(<PerformanceReader {...props} />);
  expect(screen.getByText("First").parentElement?.getAttribute("aria-current")).toBe("true");
  expect(within(screen.getAllByLabelText("Chords")[0]).getByText("D")).toBeTruthy();
  at(6);
  expect(screen.getByText("Second").parentElement?.getAttribute("aria-current")).toBe("true");
  at(1);
  expect(screen.getByText("First").parentElement?.getAttribute("aria-current")).toBe("true");
  fireEvent.click(screen.getByLabelText("Follow playback"));
  scroll.mockClear();
  at(6);
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Expand performance view"));
  expect(screen.getByText("Close expanded view")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByText("Expand performance view")).toBeTruthy();
});

it("shows untimed chord symbols transposed", () => {
  render(<PerformanceReader title="Demo" chart={"[Am] Open road [F]\n[C] New day"} lyrics="" shift={2} />);
  expect(screen.getByText("Bm")).toBeTruthy();
  expect(screen.getByText("G")).toBeTruthy();
  expect(screen.getByText("D")).toBeTruthy();
  expect(screen.getByText("Open road")).toBeTruthy();
});

describe("headings, comments, colour and key spelling", () => {
  afterEach(() => {
    useSongLibrary.setState({ index: null } as never);
    useSong.setState({ source: null } as never);
  });
  it("shows a heading as a label, a comment not at all, and a coloured span in its colour", () => {
    render(<PerformanceReader title="Song" chart={"[00:00] # Chorus\n[00:01] Shown {color:red}loud{/color} // editor note"} lyrics="" shift={0} />);
    expect(screen.getByRole("heading", { name: "Chorus", level: 3 })).toBeTruthy();
    expect(screen.queryByText(/editor note/)).toBeNull();
    expect(screen.getByText("loud").className).toContain("text-red-400");
  });
  it("spells the chords by the song's key, so an A# in a flat key shows as Bb", () => {
    render(<PerformanceReader title="Song" chart={"[00:01] [A#] Hello"} lyrics="" shift={0} songKey="Bb" />);
    expect(within(screen.getByLabelText("Chords")).getByText("Bb")).toBeTruthy();
  });
  it("keeps the chords' own spelling when no song key is known", () => {
    render(<PerformanceReader title="Song" chart={"[00:01] [A#] Hello"} lyrics="" shift={0} />);
    expect(within(screen.getByLabelText("Chords")).getByText("A#")).toBeTruthy();
  });
  it("shows an untimed chart's headings and inline chords, and the chord names are transposed", () => {
    render(<PerformanceReader title="Song" chart={"# Verse\n[C]Hello there"} lyrics="" shift={2} />);
    expect(screen.getByRole("heading", { name: "Verse", level: 3 })).toBeTruthy();
    expect(within(screen.getByLabelText("Chords")).getByText("D")).toBeTruthy();
    expect(screen.getByText("Hello there")).toBeTruthy();
  });
});

describe("autoscroll styles", () => {
  afterEach(() => {
    useAutoscroll.getState().update({ mode: "line", linesPerMinute: 6 });
    HTMLElement.prototype.scrollTo = vi.fn();
  });
  it("moves the lyrics at the chosen lines per minute, from the song position", () => {
    // jsdom has no layout, so the second line is placed 100 px down for this test.
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        return this.textContent?.startsWith("Second") ? 100 : 0;
      },
    });
    const scroll = vi.fn();
    HTMLElement.prototype.scrollTo = scroll;
    useAutoscroll.getState().update({ mode: "constant", linesPerMinute: 60 });
    render(<PerformanceReader title="Song" chart={"[00:01] First\n[00:03] Second"} lyrics="" shift={0} />);
    scroll.mockClear();
    at(0.5);
    expect(scroll).toHaveBeenLastCalledWith({ top: 50, behavior: "instant" });
    at(4);
    expect(scroll).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
  });
  it("offers the fit to the song length when the song's length is known", () => {
    useSongLibrary.setState({ index: { songs: [{ id: "s1", key: null, duration: 60 }] } } as never);
    useSong.setState({ source: { libraryId: "s1" } } as never);
    useAutoscroll.getState().update({ mode: "constant" });
    render(<PerformanceReader title="Song" chart={"[00:01] One\n[00:02] Two\n[00:03] Three"} lyrics="" shift={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit to song length" }));
    // Three lines over 60 seconds: the last line lands at the end when two lines pass each minute.
    expect(useAutoscroll.getState().linesPerMinute).toBe(2);
  });
});
