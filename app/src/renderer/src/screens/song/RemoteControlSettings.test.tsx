import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultBindings, stopLearn, useRemoteLearn } from "@/song/performance/bindings";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { RemoteControlSettings } from "./RemoteControlSettings";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("vltn.card.remote-control", "open");
  stopLearn();
  useMidiConfiguration.getState().update({ bindings: defaultBindings() });
});
afterEach(() => cleanup());

it("is closed by default, and lists each action with its bindings when opened", () => {
  localStorage.removeItem("vltn.card.remote-control");
  render(<RemoteControlSettings inputReady />);
  const title = screen.getByRole("button", { name: "Remote control" });
  expect(title.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(title);
  expect(screen.queryByText("Next song")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit remote control" }));
  expect(screen.getByText("Next section")).toBeTruthy();
  expect(screen.getByText("Key PageDown")).toBeTruthy();
  expect(screen.getByText("Any channel · CC 80 64–127 · Momentary")).toBeTruthy();
});

it("starts a key Learn that the session completes, and says so while it waits", () => {
  render(<RemoteControlSettings inputReady={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit remote control" }));
  const row = screen.getByText("Previous song").closest("li") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Learn key" }));
  expect(useRemoteLearn.getState().target).toEqual({ source: "key", action: "song.previous" });
  expect(screen.getByRole("status").textContent).toContain("Learning Previous song");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useRemoteLearn.getState().target).toBeNull();
});

it("disables MIDI Learn until a MIDI input is selected", () => {
  render(<RemoteControlSettings inputReady={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit remote control" }));
  const midi = screen.getAllByRole("button", { name: "Learn MIDI" })[0] as HTMLButtonElement;
  expect(midi.disabled).toBe(true);
  expect(screen.getByText(/Choose a MIDI input/)).toBeTruthy();
});

it("removes a binding and saves the list", () => {
  render(<RemoteControlSettings inputReady />);
  fireEvent.click(screen.getByRole("button", { name: "Edit remote control" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Key PageDown" }));
  expect(useMidiConfiguration.getState().bindings.some((b) => b.source === "key" && b.match.key === "PageDown")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
  expect(useMidiConfiguration.getState().bindings).toHaveLength(defaultBindings().length);
});
