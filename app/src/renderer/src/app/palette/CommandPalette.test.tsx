import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBandPanel } from "@/screens/song/band-panel-state";
import { useNav } from "@/state/nav";
import { useUi } from "@/state/ui";
import { CommandPalette } from "./CommandPalette";

// cmdk measures the list with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  useUi.setState({ paletteOpen: true });
  useNav.setState({ screen: "rig", param: null });
  useBandPanel.getState().show(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("command palette", () => {
  it("Generate drums and bass opens the Band panel on the Performance tab", () => {
    render(<CommandPalette />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "generate drums" } });
    fireEvent.click(screen.getByRole("option", { name: /Generate drums and bass/ }));
    expect(useNav.getState().screen).toBe("song");
    expect(useNav.getState().param).toBe("performance");
    expect(useBandPanel.getState().open).toBe(true);
    expect(useUi.getState().paletteOpen).toBe(false);
  });
});
