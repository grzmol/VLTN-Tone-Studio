import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Cue } from "@/song/performance/chart";
import { setClockPosition } from "@/song/performance/playback-clock";
import type { Section } from "@/song/performance/sections";
import { NO_LIVE } from "@/song/performance/sections";
import type { PerformanceSession, SessionState } from "@/song/performance/session";
import { useSongLibrary } from "@/song/library";
import { useSong } from "@/song/store";
import { StageView } from "./StageView";

const NAMES = ["Intro", "Verse 1", "Pre-chorus 1", "Chorus 1", "Verse 2", "Pre-chorus 2", "Chorus 2", "Bridge", "Solo", "Chorus 3", "Chorus 4", "Outro", "Tag"];
/** Thirteen sections of 16 s (8 bars at 120 BPM), the last one running to the end of a 330 s song. */
const sections: Section[] = NAMES.map((name, i) => ({ id: `s${i}`, name, start: i * 16, end: i === 12 ? 330 : (i + 1) * 16, mode: "continue" }));
const recall = (time: number, slot: number, label: string): Cue => ({
  time,
  text: "",
  label,
  messages: [
    [0xbf, 0, 0],
    [0xcf, slot],
  ],
});

const output = { id: "o", name: "GP-180", state: "connected" };

function fakeSession(patch: Partial<SessionState> = {}) {
  const store = createStore<SessionState>(
    () =>
      ({
        player: { duration: 330, start: 0 },
        playing: false,
        starting: false,
        queued: false,
        sections,
        sectionLive: NO_LIVE,
        sectionNext: null,
        parseError: "",
        error: "",
        lateNotice: null,
        cues: [recall(4, 10, "GP-180: 011 Crunch"), recall(100, 13, "GP-180: 014 Lead")],
        pedalsReady: false,
        preparationSettings: null,
        preparing: null,
        portId: "bluetooth-midi",
        bluetooth: output,
        access: null,
        armedOutput: output,
        ...patch,
      }) as unknown as SessionState,
  );
  const session = {
    store,
    locked: true,
    pause: vi.fn(),
    panicAndDisarm: vi.fn(),
    startPlayback: vi.fn(),
    cancelStart: vi.fn(),
    tapSection: vi.fn(),
    toggleSectionLoop: vi.fn(),
    releaseSectionLoop: vi.fn(),
    seek: vi.fn(),
  };
  return session as unknown as PerformanceSession & typeof session;
}

function mount(session: PerformanceSession, chart = "") {
  return render(
    <StageView
      session={session}
      stage
      onExitStage={vi.fn()}
      chart={chart}
      lyrics=""
      chords={[]}
      shift={0}
      onSaveChart={vi.fn()}
      beat={{ bpm: 120, beats: 4, firstBeat: 0 }}
      speedNote={null}
    />,
  );
}

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  setClockPosition(0);
  useSong.setState({
    source: { name: "5. Burn.wav", libraryId: "burn", audio: { channels: [new Float32Array(10)], sampleRate: 44100 } },
  } as unknown as Partial<ReturnType<typeof useSong.getState>>);
  useSongLibrary.setState({
    index: { songs: [{ id: "burn", title: "Burn", artist: "Deep Purple", key: "Gm", bpm: 120, duration: 330 }] },
    queue: ["burn"],
    position: 0,
  } as unknown as Partial<ReturnType<typeof useSongLibrary.getState>>);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("names the song by its library title, not its file name", () => {
  mount(fakeSession());
  const strip = screen.getByLabelText("Stage status");
  expect(strip.textContent).toContain("Burn · Deep Purple");
  expect(strip.textContent).not.toContain("5. Burn.wav");
});

it("shows the section now and the one next, and the bars left in it", () => {
  mount(fakeSession());
  act(() => setClockPosition(65));
  expect(screen.getByLabelText("Section now and next").textContent).toBe("Verse 2→Pre-chorus 2");
  // Verse 2 runs from 64 s to 80 s: 8 bars at 120 BPM, and the playhead is in its first.
  expect(screen.getByLabelText("Left in the section").textContent).toBe("8 bars");
  act(() => setClockPosition(77));
  expect(screen.getByLabelText("Left in the section").textContent).toBe("2 bars");
});

it("shows the memory the pedal is on and the next one with the time to it", () => {
  mount(fakeSession());
  act(() => setClockPosition(78));
  expect(screen.getByLabelText("Pedal").textContent).toBe("GP-180: 011 Crunch→ 014 Lead in 0:22");
});

it("shows one health word, and says why when something is wrong", () => {
  mount(fakeSession());
  expect(screen.getByLabelText("Performance status").textContent).toBe("Ready");
  cleanup();
  mount(fakeSession({ armedOutput: null }));
  expect(screen.getByLabelText("Performance status").textContent).toBe("Cues offCues disarmed");
});

it("gives the chart the rest of the height, below three fixed bands", () => {
  mount(fakeSession());
  const dialog = screen.getByRole("dialog", { name: "Stage mode" });
  const chart = dialog.querySelector("[data-reader-scroll]") as HTMLElement;
  // The chart grows to fill what the bands leave (jsdom has no layout; the share of the window is measured in the running app).
  expect(chart.className).toContain("flex-1");
  expect(chart.className).toContain("min-h-0");
  expect(chart.parentElement?.className).toContain("flex-col");
  expect(dialog.querySelectorAll("[data-reader-scroll]")).toHaveLength(1);
  // No row of section buttons: the timeline's blocks do that job.
  expect(screen.queryByLabelText("Song sections")).toBeNull();
  expect(screen.getAllByRole("button", { name: /^Verse 2, / })).toHaveLength(1);
  expect(dialog.textContent).not.toContain("Chords follow their timestamps");
});

it("takes two presses to stop: the first only arms the button", () => {
  const session = fakeSession({ playing: true });
  mount(session);
  fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
  expect(session.pause).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Press again to stop" }));
  expect(session.pause).toHaveBeenCalledTimes(1);
});

it("lets the arming lapse after 0.6 s", () => {
  vi.useFakeTimers();
  const session = fakeSession({ playing: true });
  mount(session);
  fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
  act(() => void vi.advanceTimersByTime(700));
  fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
  expect(session.pause).not.toHaveBeenCalled();
});

it("stops on a hold of 0.6 s, once", () => {
  vi.useFakeTimers();
  const session = fakeSession({ playing: true });
  mount(session);
  const stop = screen.getByRole("button", { name: "Stop playback" });
  fireEvent.pointerDown(stop);
  act(() => void vi.advanceTimersByTime(500));
  fireEvent.pointerUp(stop);
  fireEvent.click(stop);
  expect(session.pause).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Press again to stop" }));
  act(() => void vi.advanceTimersByTime(600));
  fireEvent.pointerUp(screen.getByRole("button", { name: "Stop playback" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
  expect(session.pause).toHaveBeenCalledTimes(1);
});

it("loops, releases and moves on with the section actions", () => {
  const session = fakeSession({ playing: true });
  act(() => setClockPosition(66));
  mount(session);
  fireEvent.click(screen.getByRole("button", { name: "Loop this section" }));
  expect(session.toggleSectionLoop).toHaveBeenCalledWith("s4");
  fireEvent.click(screen.getByRole("button", { name: "Next section" }));
  expect(session.tapSection).toHaveBeenCalledWith("s5");
  cleanup();
  act(() => setClockPosition(66));
  const looping = fakeSession({ playing: true, sectionLive: { ...NO_LIVE, loop: "s4" } });
  mount(looping);
  expect(screen.getByLabelText("Section now and next").textContent).toBe("Verse 2Looping");
  fireEvent.click(screen.getByRole("button", { name: "Release loop" }));
  expect(looping.releaseSectionLoop).toHaveBeenCalled();
});

it("jumps from the timeline's section blocks even though seeking is locked", () => {
  const session = fakeSession({ playing: true });
  mount(session);
  fireEvent.click(screen.getByRole("button", { name: /^Chorus 2, / }));
  expect(session.tapSection).toHaveBeenCalledWith("s6");
});

it("offers Prepare pedals only before the song starts", () => {
  mount(fakeSession());
  expect(screen.getByRole("button", { name: /Prepare pedals/ })).toBeTruthy();
  cleanup();
  mount(fakeSession({ playing: true }));
  expect(screen.queryByRole("button", { name: /Prepare pedals/ })).toBeNull();
});

it("shows the next song's card between songs of a set, and the chart once it plays", () => {
  mount(fakeSession({ queued: true }));
  expect(screen.getByLabelText("Next song").textContent).toContain("Burn");
  expect(screen.getByLabelText("Next song").textContent).toContain("GP-180: 011 Crunch");
  expect(screen.getByLabelText("Stage status").textContent).toContain("Next: Burn");
  cleanup();
  mount(fakeSession({ queued: true, playing: true }));
  expect(screen.queryByLabelText("Next song")).toBeNull();
});

it("keeps cue chips off the chart until Show MIDI commands is on, and shows the short label only", async () => {
  mount(fakeSession(), "[00:02.00] First line\n[00:04.00] {label:Clean} {midi:pc 1 5}\n[00:06.00] Second line");
  expect(screen.queryByLabelText("MIDI cue")).toBeNull();
  fireEvent.keyDown(screen.getByLabelText("More stage settings"), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Show MIDI commands" }));
  const chip = screen.getByLabelText("MIDI cue");
  expect(chip.textContent).toBe("Clean");
  expect(screen.getByRole("dialog", { name: "Stage mode" }).textContent).not.toContain("PC");
});
