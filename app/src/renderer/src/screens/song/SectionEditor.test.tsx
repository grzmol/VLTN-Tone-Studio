import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
import { usePlaybackClock } from "@/song/performance/playback-clock";
import type { Section } from "@/song/performance/sections";
import { SectionEditor } from "./SectionEditor";

const sections: Section[] = [{ id: "intro", name: "Intro", start: 0, end: 8, mode: "continue" }];

it("adds a section at the playhead, snapped to the beat, and removes one", () => {
  usePlaybackClock.setState({ position: 16.3 });
  const onSections = vi.fn();
  render(<SectionEditor sections={sections} onSections={onSections} duration={60} bpm={120} firstBeat={0} channels={null} />);
  fireEvent.click(screen.getByText("Add section at playhead"));
  const added = onSections.mock.calls[0][0] as Section[];
  expect(added).toHaveLength(2);
  expect(added[1]).toMatchObject({ name: "Section 2", start: 16.5, end: 24.5, mode: "continue" });
  fireEvent.click(screen.getAllByText("Delete")[0]);
  expect(onSections).toHaveBeenLastCalledWith([]);
  usePlaybackClock.setState({ position: 0 });
});

it("renames a section and changes its stored mode", () => {
  const onSections = vi.fn();
  render(<SectionEditor sections={sections} onSections={onSections} duration={60} bpm={0} firstBeat={0} channels={null} />);
  fireEvent.change(screen.getByLabelText("Section name"), { target: { value: "Verse" } });
  expect(onSections).toHaveBeenLastCalledWith([{ ...sections[0], name: "Verse" }]);
});

it("offers the detected sections in place of the performer's own, and Undo puts them back", () => {
  const onSections = vi.fn();
  const suggested = [{ name: "Intro", start: 0, end: 8 }, { name: "Verse 1", start: 8, end: 24 }];
  const { rerender } = render(<SectionEditor sections={sections} onSections={onSections} suggested={suggested} duration={60} bpm={0} firstBeat={0} channels={null} />);
  fireEvent.click(screen.getByText("Replace with detected sections"));
  const replaced = onSections.mock.calls[0][0] as Section[];
  expect(replaced.map((s) => [s.name, s.start, s.end, s.source])).toEqual([
    ["Intro", 0, 8, "detected"],
    ["Verse 1", 8, 24, "detected"],
  ]);
  // The editor is shown the replaced list, so the Undo button is there with the old sections kept for it.
  rerender(<SectionEditor sections={replaced} onSections={onSections} suggested={suggested} duration={60} bpm={0} firstBeat={0} channels={null} />);
  fireEvent.click(screen.getByText("Undo"));
  expect(onSections).toHaveBeenLastCalledWith(sections);
});

it("does not offer the replace when the song's sections are all detected, or nothing was suggested", () => {
  const detected: Section[] = [{ id: "d", name: "Intro", start: 0, end: 8, mode: "continue", source: "detected" }];
  const { unmount } = render(
    <SectionEditor
      sections={detected}
      onSections={vi.fn()}
      suggested={[{ name: "Intro", start: 0, end: 8 }]}
      duration={60}
      bpm={0}
      firstBeat={0}
      channels={null}
    />,
  );
  expect(screen.queryByText("Replace with detected sections")).toBeNull();
  unmount();
  render(<SectionEditor sections={sections} onSections={vi.fn()} duration={60} bpm={0} firstBeat={0} channels={null} />);
  expect(screen.queryByText("Replace with detected sections")).toBeNull();
});
