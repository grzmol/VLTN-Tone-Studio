import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BAND_SETTINGS } from "@/song/band/arrangement";
import { EndingControls } from "./EndingControls";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as typeof Element.prototype.hasPointerCapture;
});
afterEach(cleanup);
const open = (name: string) => fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
const SECTIONS = [
  { id: "verse", name: "Verse" },
  { id: "outro", name: "Outro" },
];

describe("EndingControls", () => {
  it("shows the saved ending, and offers the five endings", () => {
    render(<EndingControls settings={{ ...DEFAULT_BAND_SETTINGS, ending: { kind: "hold" } }} sections={SECTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Ending" }).textContent).toContain("Fill and hold");
    open("Ending");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Hit", "Fill and hold", "Three hits", "Slow down", "None"]);
  });

  it("saves the ending picked, keeping the section", () => {
    const onChange = vi.fn();
    render(<EndingControls settings={{ ...DEFAULT_BAND_SETTINGS, ending: { kind: "hit", atSection: "verse" } }} sections={SECTIONS} onChange={onChange} />);
    open("Ending");
    fireEvent.click(screen.getByRole("option", { name: "Three hits" }));
    expect(onChange).toHaveBeenCalledWith({ ending: { kind: "hits", atSection: "verse" } });
  });

  it("saves the section the ending goes after, and Automatic clears it", () => {
    const onChange = vi.fn();
    render(<EndingControls settings={{ ...DEFAULT_BAND_SETTINGS, ending: { kind: "hit", atSection: "verse" } }} sections={SECTIONS} onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "End after" }).textContent).toContain("Verse");
    open("End after");
    fireEvent.click(screen.getByRole("option", { name: "Automatic" }));
    expect(onChange).toHaveBeenCalledWith({ ending: { kind: "hit", atSection: null } });
  });

  it("hides End after for no ending, and for a song without sections", () => {
    const { rerender } = render(<EndingControls settings={{ ...DEFAULT_BAND_SETTINGS, ending: { kind: "none" } }} sections={SECTIONS} onChange={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "End after" })).toBeNull();
    rerender(<EndingControls settings={DEFAULT_BAND_SETTINGS} sections={[]} onChange={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "End after" })).toBeNull();
  });
});
