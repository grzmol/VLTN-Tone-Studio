import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BAND_SETTINGS } from "@/song/band/arrangement";
import { CountInControls } from "./CountInControls";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as typeof Element.prototype.hasPointerCapture;
});
afterEach(cleanup);
const open = (name: string) => fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });

describe("CountInControls", () => {
  it("is off by default and hides the sound until a count is on", () => {
    render(<CountInControls settings={DEFAULT_BAND_SETTINGS} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Drummer counts in" }).textContent).toContain("Off");
    expect(screen.queryByRole("combobox", { name: "Counts on" })).toBeNull();
  });

  it("saves the bars picked, keeping the sound", () => {
    const onChange = vi.fn();
    render(<CountInControls settings={{ ...DEFAULT_BAND_SETTINGS, countIn: { bars: 0, sound: "hat" } }} onChange={onChange} />);
    open("Drummer counts in");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Off", "1 bar", "2 bars"]);
    fireEvent.click(screen.getByRole("option", { name: "2 bars" }));
    expect(onChange).toHaveBeenCalledWith({ countIn: { bars: 2, sound: "hat" } });
  });

  it("saves the sound, and says the click count and the drummer's count both play", () => {
    const onChange = vi.fn();
    render(<CountInControls settings={{ ...DEFAULT_BAND_SETTINGS, countIn: { bars: 1, sound: "sticks" } }} onChange={onChange} />);
    expect(screen.getByText(/click count and the drummer's count both play/)).toBeTruthy();
    open("Counts on");
    fireEvent.click(screen.getByRole("option", { name: "Hat" }));
    expect(onChange).toHaveBeenCalledWith({ countIn: { bars: 1, sound: "hat" } });
  });
});
