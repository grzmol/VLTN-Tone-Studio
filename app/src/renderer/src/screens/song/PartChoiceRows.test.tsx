import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PartChoices, PartKeys } from "@/song/band/part-choice";
import { PartChoiceRows } from "./PartChoiceRows";

const keys: PartKeys = { drums: { original: "drums", generated: "track1" }, bass: { original: "bass", generated: "track2" } };
const rows = (choices: PartChoices, pedalCues: boolean, onChange = vi.fn(), onOpenMidi = vi.fn()) =>
  render(<PartChoiceRows choices={choices} keys={keys} disabled={false} onChange={onChange} pedalCues={pedalCues} onOpenMidi={onOpenMidi} />);

afterEach(cleanup);

it("shows the pedal button only when the song has RC-10R cues", () => {
  rows({ drums: "original", bass: "original" }, false);
  expect(screen.queryByRole("button", { name: "RC-10R pedal" })).toBeNull();
  cleanup();
  rows({ drums: "original", bass: "original" }, true);
  expect(screen.getByRole("button", { name: "RC-10R pedal" })).toBeTruthy();
});

it("never offers the pedal for bass", () => {
  rows({ drums: "original", bass: "original" }, true);
  expect(within(screen.getByRole("group", { name: "Bass" })).queryByRole("button", { name: "RC-10R pedal" })).toBeNull();
});

it("chooses the pedal, and then offers the fallback", () => {
  const onChange = vi.fn();
  rows({ drums: "original", bass: "original" }, true, onChange);
  fireEvent.click(screen.getByRole("button", { name: "RC-10R pedal" }));
  expect(onChange).toHaveBeenCalledWith({ drums: "pedal" });
  cleanup();
  rows({ drums: "pedal", bass: "original" }, true, onChange);
  const fallback = screen.getByRole("group", { name: "If the pedal isn't there" });
  expect(within(fallback).getByRole("button", { name: "Generated" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(fallback).getByRole("button", { name: "Original" }));
  expect(onChange).toHaveBeenCalledWith({ pedalFallback: "original" });
});

it("explains a pedal choice on a song without cues and links to the MIDI view", () => {
  const onOpenMidi = vi.fn();
  rows({ drums: "pedal", bass: "original" }, false, vi.fn(), onOpenMidi);
  expect(screen.getByText(/no automatic RC-10R drums yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Set them up in the MIDI view" }));
  expect(onOpenMidi).toHaveBeenCalled();
});
