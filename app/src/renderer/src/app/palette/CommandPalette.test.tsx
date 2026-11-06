import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("command palette", () => {
  it("Split a song into stems opens the Stems tab and closes the palette", () => {
    render(<CommandPalette />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "split a song" } });
    fireEvent.click(screen.getByRole("option", { name: /Split a song into stems/ }));
    expect(useNav.getState().screen).toBe("song");
    expect(useNav.getState().param).toBe("stems");
    expect(useUi.getState().paletteOpen).toBe(false);
  });
});
