import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DrumsChip } from "./DrumsChip";

it("shows RC-10R when the pedal plays", () => {
  render(<DrumsChip choice="pedal" source={{ plays: "pedal", reason: "pedal-ready" }} fallbackWhy="" onOpen={() => {}} />);
  expect(screen.getByRole("button", { name: "Drums: RC-10R" })).toBeTruthy();
});

it("shows the fallback and why, and opens What plays on click", () => {
  const onOpen = vi.fn();
  render(<DrumsChip choice="pedal" source={{ plays: "generated", reason: "not-armed" }} fallbackWhy="Send cues off" onOpen={onOpen} />);
  const chip = screen.getByRole("button", { name: "Drums: Generated (fallback)" });
  expect(chip.getAttribute("title")).toContain("Send cues off");
  fireEvent.click(chip);
  expect(onOpen).toHaveBeenCalled();
});

it("shows a plain choice neutrally", () => {
  render(<DrumsChip choice="both" source={{ plays: "both", reason: "chosen" }} fallbackWhy="" onOpen={() => {}} />);
  expect(screen.getByRole("button", { name: "Drums: Both" })).toBeTruthy();
});
