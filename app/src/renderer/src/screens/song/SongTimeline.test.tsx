import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Section } from "@/song/performance/sections";
import { setClockPosition } from "@/song/performance/playback-clock";
import { SongTimeline } from "./SongTimeline";

afterEach(cleanup);
beforeEach(() => setClockPosition(0));

const sections: Section[] = [
  { id: "intro", name: "Intro", start: 0, end: 30, mode: "continue" },
  { id: "verse", name: "Verse 1", start: 30, end: 120, mode: "continue" },
  { id: "chorus", name: "Chorus 1", start: 120, end: 300, mode: "continue" },
];

const slider = () => screen.getByRole("slider", { name: "Song timeline" });

/** jsdom has no layout, so the timeline is given a 1000 px width to turn pointer positions into times. */
function sized(element: HTMLElement) {
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 72, right: 1000, bottom: 72, x: 0, y: 0, toJSON: () => ({}) });
}

it("draws each section in proportion to its length", () => {
  const { container } = render(<SongTimeline duration={300} sections={sections} onSeek={vi.fn()} />);
  const block = (id: string) => container.querySelector(`[data-section="${id}"]`) as HTMLElement;
  expect(block("intro").style.width).toBe("10%");
  expect(block("verse").style.width).toBe("30%");
  expect(block("chorus").style.left).toBe("40%");
  expect(block("chorus").style.width).toBe("60%");
});

it("seeks to half the duration on a click in the middle", () => {
  const onSeek = vi.fn();
  render(<SongTimeline duration={300} sections={sections} onSeek={onSeek} />);
  sized(slider());
  fireEvent.pointerDown(slider(), { clientX: 500, pointerId: 1 });
  expect(onSeek).toHaveBeenCalledWith(150);
});

it("scrubs while the pointer is down and stops when it is released", () => {
  const onSeek = vi.fn();
  render(<SongTimeline duration={300} sections={sections} onSeek={onSeek} />);
  sized(slider());
  fireEvent.pointerDown(slider(), { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(slider(), { clientX: 200, pointerId: 1 });
  fireEvent.pointerUp(slider(), { pointerId: 1 });
  fireEvent.pointerMove(slider(), { clientX: 900, pointerId: 1 });
  expect(onSeek.mock.calls.map(([value]) => value)).toEqual([30, 60]);
});

it("does not seek when seeking is locked", () => {
  const onSeek = vi.fn();
  const onSection = vi.fn();
  render(<SongTimeline duration={300} sections={sections} locked onSeek={onSeek} onSection={onSection} />);
  sized(slider());
  fireEvent.pointerDown(slider(), { clientX: 500, pointerId: 1 });
  fireEvent.keyDown(slider(), { key: "ArrowRight" });
  fireEvent.click(screen.getByRole("button", { name: /Verse 1/ }));
  expect(onSeek).not.toHaveBeenCalled();
  expect(onSection).not.toHaveBeenCalled();
  expect(slider().getAttribute("aria-disabled")).toBe("true");
});

it("moves 5 s with the arrow keys and a bar with Shift", () => {
  const onSeek = vi.fn();
  act(() => setClockPosition(83));
  render(<SongTimeline duration={300} sections={sections} barSeconds={2.4} onSeek={onSeek} />);
  fireEvent.keyDown(slider(), { key: "ArrowRight" });
  fireEvent.keyDown(slider(), { key: "ArrowLeft" });
  fireEvent.keyDown(slider(), { key: "ArrowRight", shiftKey: true });
  expect(onSeek.mock.calls.map(([value]) => value)).toEqual([88, 78, 85.4]);
});

it("states the time and the section for assistive technology", () => {
  act(() => setClockPosition(83));
  render(
    <SongTimeline
      duration={330}
      sections={[sections[0], { ...sections[1], end: 80 }, { id: "c", name: "Chorus 1", start: 80, end: 330, mode: "continue" }]}
      onSeek={vi.fn()}
    />,
  );
  expect(slider().getAttribute("aria-valuetext")).toBe("1:23 of 5:30, Chorus 1");
  expect(slider().getAttribute("aria-valuemax")).toBe("330");
});

it("jumps to a section when its label is pressed, and marks a loop and a queued jump", () => {
  const onSection = vi.fn();
  render(<SongTimeline duration={300} sections={sections} loopingId="verse" jumpTargetId="chorus" onSeek={vi.fn()} onSection={onSection} />);
  fireEvent.click(screen.getByRole("button", { name: /Chorus 1/ }));
  expect(onSection).toHaveBeenCalledWith("chorus");
  expect(screen.getByLabelText("Loops")).toBeTruthy();
  expect(screen.getByLabelText("Jump queued")).toBeTruthy();
});

it("shades a trimmed start and end and ticks each cue with its label", () => {
  const { container } = render(
    <SongTimeline duration={300} sections={sections} trim={{ start: 30, end: 270 }} cues={[{ time: 150, label: "Clean tone" }]} onSeek={vi.fn()} />,
  );
  expect((container.querySelector('[data-trim="start"]') as HTMLElement).style.width).toBe("10%");
  expect((container.querySelector('[data-trim="end"]') as HTMLElement).style.width).toBe("10%");
  const tick = container.querySelector("[data-cue]") as HTMLElement;
  expect(tick.style.left).toBe("50%");
  expect(tick.getAttribute("title")).toBe("Clean tone");
});

it("keeps section labels pressable while seeking is locked when they are jumpable, and outlines the next section", () => {
  const onSeek = vi.fn();
  const onSection = vi.fn();
  const { container } = render(<SongTimeline duration={300} sections={sections} locked jumpable showNext onSeek={onSeek} onSection={onSection} />);
  sized(slider());
  fireEvent.pointerDown(slider(), { clientX: 500, pointerId: 1 });
  fireEvent.click(screen.getByRole("button", { name: /Chorus 1/ }));
  expect(onSeek).not.toHaveBeenCalled();
  expect(onSection).toHaveBeenCalledWith("chorus");
  // The playhead is in the intro, so the verse is next.
  expect(container.querySelector('[data-section="verse"]')?.hasAttribute("data-next")).toBe(true);
  expect(container.querySelector('[data-section="chorus"]')?.hasAttribute("data-next")).toBe(false);
});
