import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BpmField } from "./PerformanceTransport";
import { isTypingTarget } from "@/song/performance/bindings";

afterEach(cleanup);

/** Keeps the BPM in state, as the screen does, so a committed value shows back in the field. */
function Host({ initial, onCommit }: { initial: number; onCommit: (value: number) => void }) {
  const [bpm, setBpm] = useState(initial);
  return (
    <BpmField
      bpm={bpm}
      disabled={false}
      onBpm={(value) => {
        onCommit(value);
        setBpm(value);
      }}
    />
  );
}

const bpmInput = () => screen.getByLabelText("BPM") as HTMLInputElement;

it("takes a typed value over a selected one and commits it on blur", () => {
  const onCommit = vi.fn();
  render(<Host initial={300} onCommit={onCommit} />);
  const input = bpmInput();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.change(input, { target: { value: "12" } });
  fireEvent.change(input, { target: { value: "120" } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenLastCalledWith(120);
  expect(bpmInput().value).toBe("120");
});

it("clamps a typed value below the range to 30 on blur", () => {
  const onCommit = vi.fn();
  render(<Host initial={120} onCommit={onCommit} />);
  const input = bpmInput();
  fireEvent.change(input, { target: { value: "5" } });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenLastCalledWith(30);
  expect(bpmInput().value).toBe("30");
});

it("keeps the previous BPM when the field is emptied and left", () => {
  const onCommit = vi.fn();
  render(<Host initial={120} onCommit={onCommit} />);
  const input = bpmInput();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
  expect(bpmInput().value).toBe("120");
});

it("commits on Enter and clamps to the range", () => {
  const onCommit = vi.fn();
  render(<Host initial={120} onCommit={onCommit} />);
  const input = bpmInput();
  fireEvent.change(input, { target: { value: "400" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onCommit).toHaveBeenLastCalledWith(300);
});

it("sets a stepped whole number in range at once, without waiting for blur", () => {
  const onCommit = vi.fn();
  render(<Host initial={120} onCommit={onCommit} />);
  fireEvent.change(bpmInput(), { target: { value: "121" } });
  expect(onCommit).toHaveBeenLastCalledWith(121);
});

it("restores the current BPM on Escape without committing", () => {
  const onCommit = vi.fn();
  render(<Host initial={120} onCommit={onCommit} />);
  const input = bpmInput();
  fireEvent.change(input, { target: { value: "5" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(bpmInput().value).toBe("120");
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
});

it("shows a BPM set from outside while not editing", () => {
  const { rerender } = render(<BpmField bpm={120} disabled={false} onBpm={() => {}} />);
  rerender(<BpmField bpm={96} disabled={false} onBpm={() => {}} />);
  expect(bpmInput().value).toBe("96");
});

it("counts a number field as a typing target, so the single-key shortcuts ignore its keys", () => {
  render(<BpmField bpm={120} disabled={false} onBpm={() => {}} />);
  expect(isTypingTarget(bpmInput())).toBe(true);
});
