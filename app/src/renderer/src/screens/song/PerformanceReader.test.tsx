import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoscroll } from "@/song/performance/autoscroll";
import { setClockPosition } from "@/song/performance/playback-clock";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { PerformanceReader } from "./PerformanceReader";

// jsdom cannot render a PDF, so the PDF chart and its controls are stand-ins here.
vi.mock("./PdfChart", () => ({ PdfChart: () => <div>PDF chart</div> }));
vi.mock("./PdfControls", () => ({ PdfControls: () => null }));

const at = (seconds: number) => act(() => setClockPosition(seconds));

afterEach(() => {
  cleanup();
  setClockPosition(0);
});
it("follows playback and backward seeks, transposes chords, and can stop following", () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollTo = scroll;
  const props = { title: "Song", chart: "[00:01] [C] First\n[00:05] [G] Second", lyrics: "", chords: [], shift: 2 };
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

it("opens transposed chord tabs and closes the overlay without closing the expanded reader", () => {
  HTMLElement.prototype.scrollTo = vi.fn();
  render(<PerformanceReader title="Song" chart="[00:00] [C]Words" lyrics="" chords={[]} shift={2} />);
  fireEvent.click(screen.getByText("Expand performance view"));
  fireEvent.click(screen.getByRole("button", { name: "Show D guitar voicings" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("D · Guitar voicings")).toBeTruthy();
  expect(screen.getByLabelText("D position 1 tablature").textContent).toContain("e|--");
  fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Close expanded view")).toBeTruthy();
});

it("edits displayed lyrics and chords with MIDI preserved, validates values, and supports cancel", () => {
  const save = vi.fn(),
    pause = vi.fn();
  render(<PerformanceReader title="Song" chart="[00:01] [C]Words {midi:pc 2 12}" lyrics="" chords={[]} shift={2} onEditStart={pause} onSaveChart={save} />);
  fireEvent.click(screen.getByText("Edit chords, lyrics & MIDI"));
  expect(pause).toHaveBeenCalledOnce();
  expect((screen.getByLabelText("Line 1 chords") as HTMLInputElement).value).toBe("C");
  fireEvent.change(screen.getByLabelText("Line 1 lyrics"), { target: { value: "Correct words" } });
  fireEvent.change(screen.getByLabelText("Line 1 chords"), { target: { value: "Am" } });
  fireEvent.change(screen.getByLabelText("Line 1 MIDI"), { target: { value: "pc 17 12" } });
  fireEvent.click(screen.getByText("Save performance edits"));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Invalid MIDI");
  fireEvent.change(screen.getByLabelText("Line 1 MIDI"), { target: { value: "pc 2 14" } });
  fireEvent.click(screen.getByText("Save performance edits"));
  expect(save).toHaveBeenCalledWith("[00:01.00] [Am] Correct words {midi:pc 2 14}");
  fireEvent.click(screen.getByText("Edit chords, lyrics & MIDI"));
  fireEvent.change(screen.getByLabelText("Line 1 lyrics"), { target: { value: "Discard" } });
  fireEvent.click(screen.getByText("Cancel edits"));
  expect(save).toHaveBeenCalledTimes(1);
});

it("shows untimed chord symbols as playable transposed chords", () => {
  render(<PerformanceReader title="Demo" chart={"[Am] Open road [F]\n[C] New day"} lyrics="" chords={[]} shift={2} />);
  expect(screen.getByLabelText("Show Bm guitar voicings")).toBeTruthy();
  expect(screen.getByLabelText("Show G guitar voicings")).toBeTruthy();
  expect(screen.getByLabelText("Show D guitar voicings")).toBeTruthy();
  expect(screen.getByText("Open road")).toBeTruthy();
});

describe("headings, comments, colour and key spelling", () => {
  afterEach(() => {
    useSongLibrary.setState({ index: null } as never);
    useSong.setState({ source: null } as never);
  });
  it("shows a heading as a label, a comment not at all, and a coloured span in its colour", () => {
    render(<PerformanceReader title="Song" chart={"[00:00] # Chorus\n[00:01] Shown {color:red}loud{/color} // editor note"} lyrics="" chords={[]} shift={0} />);
    expect(screen.getByRole("heading", { name: "Chorus", level: 3 })).toBeTruthy();
    expect(screen.queryByText(/editor note/)).toBeNull();
    expect(screen.getByText("loud").className).toContain("text-red-400");
  });
  it("spells the chords by the song's key, so an A# in a flat key shows as Bb", () => {
    render(<PerformanceReader title="Song" chart={"[00:01] [A#] Hello"} lyrics="" chords={[]} shift={0} songKey="Bb" />);
    expect(within(screen.getByLabelText("Chords")).getByText("Bb")).toBeTruthy();
  });
  it("keeps the chords' own spelling when no song key is known", () => {
    render(<PerformanceReader title="Song" chart={"[00:01] [A#] Hello"} lyrics="" chords={[]} shift={0} />);
    expect(within(screen.getByLabelText("Chords")).getByText("A#")).toBeTruthy();
  });
  it("shows an untimed chart's headings and inline chords, and the chord names are transposed", () => {
    render(<PerformanceReader title="Song" chart={"# Verse\n[C]Hello there"} lyrics="" chords={[]} shift={2} />);
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
    render(<PerformanceReader title="Song" chart={"[00:01] First\n[00:03] Second"} lyrics="" chords={[]} shift={0} />);
    scroll.mockClear();
    at(0.5);
    expect(scroll).toHaveBeenLastCalledWith({ top: 50, behavior: "instant" });
    at(4);
    expect(scroll).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
  });
  it("follows playback once the text chart replaces the PDF chart", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        return this.textContent?.startsWith("Second") ? 100 : 0;
      },
    });
    const scroll = vi.fn();
    HTMLElement.prototype.scrollTo = scroll;
    const props = { title: "Song", chart: "[00:01] First\n[00:03] Second", lyrics: "", chords: [], shift: 0 };
    const pdf = { songId: "s1", chart: true, revision: "r1", view: "pdf" as const, onView: vi.fn() };
    const { rerender } = render(<PerformanceReader {...props} pdf={pdf} />);
    rerender(<PerformanceReader {...props} pdf={{ ...pdf, view: "text" }} />);
    scroll.mockClear();
    at(4);
    expect(scroll).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
  });
  it("offers the fit to the song length when the song's length is known", () => {
    useSongLibrary.setState({ index: { songs: [{ id: "s1", key: null, duration: 60 }] } } as never);
    useSong.setState({ source: { libraryId: "s1" } } as never);
    useAutoscroll.getState().update({ mode: "constant" });
    render(<PerformanceReader title="Song" chart={"[00:01] One\n[00:02] Two\n[00:03] Three"} lyrics="" chords={[]} shift={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit to song length" }));
    // Three lines over 60 seconds: the last line lands at the end when two lines pass each minute.
    expect(useAutoscroll.getState().linesPerMinute).toBe(2);
  });
});
