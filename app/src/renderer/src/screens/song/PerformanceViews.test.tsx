import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PerformanceViewSwitcher, readPerformanceView, savePerformanceView } from "./PerformanceViews";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens on Play when nothing is saved", () => {
  expect(readPerformanceView()).toBe("play");
});

it("remembers the chosen view", () => {
  savePerformanceView("midi");
  expect(readPerformanceView()).toBe("midi");
});

it("falls back to Play for an unknown saved value", () => {
  localStorage.setItem("vltn.performance.view", "nonsense");
  expect(readPerformanceView()).toBe("play");
});

it("falls back to Play when storage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readPerformanceView()).toBe("play");
});

it("does not throw when storage throws on save", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => savePerformanceView("setup")).not.toThrow();
});

it("marks the selected view and reports clicks", () => {
  const onView = vi.fn();
  render(<PerformanceViewSwitcher view="song" onView={onView} />);
  expect(screen.getByRole("tab", { name: "This song" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Play" }).getAttribute("aria-selected")).toBe("false");
  fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
  expect(onView).toHaveBeenCalledWith("setup");
});

it("moves between views with the arrow keys and wraps around", () => {
  const onView = vi.fn();
  render(<PerformanceViewSwitcher view="play" onView={onView} />);
  const play = screen.getByRole("tab", { name: "Play" });
  fireEvent.keyDown(play, { key: "ArrowRight" });
  expect(onView).toHaveBeenLastCalledWith("song");
  fireEvent.keyDown(play, { key: "ArrowLeft" });
  expect(onView).toHaveBeenLastCalledWith("setup");
});
