import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnobHit } from "./controls";

afterEach(cleanup);

const pct = { min: 0, max: 100, step: 1 };

function renderKnob(onChange = vi.fn()) {
  render(<KnobHit label="Mic record level" value={50} spec={pct} onChange={onChange} />);
  return { knob: screen.getByRole("slider", { name: "Mic record level" }), onChange };
}

// A wheel notch aimed at the knob. The event is cancelable, so defaultPrevented shows whether the page would scroll.
function wheel(target: HTMLElement) {
  const event = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("KnobHit wheel", () => {
  it("leaves an unfocused knob alone so the page scrolls", () => {
    const { knob, onChange } = renderKnob();
    expect(document.activeElement).not.toBe(knob);

    const event = wheel(knob);

    expect(onChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("turns the knob once it has focus", () => {
    const { knob, onChange } = renderKnob();
    knob.focus();
    expect(document.activeElement).toBe(knob);

    const event = wheel(knob);

    expect(onChange).toHaveBeenCalledWith(51);
    expect(event.defaultPrevented).toBe(true);
  });

  it("stops turning when focus moves away", () => {
    const { knob, onChange } = renderKnob();
    knob.focus();
    knob.blur();

    const event = wheel(knob);

    expect(onChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
