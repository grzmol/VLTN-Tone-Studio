import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MacroPanel } from "./MacroPanel";
import { readMidiConfiguration, saveMacro, useMidiConfiguration } from "@/song/performance/midi-configuration";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useMidiConfiguration.setState(readMidiConfiguration());
});

it("inserts the chosen macro as a cue at the given time, and sends it now", () => {
  saveMacro({ code: "GP_LEAD", label: "Lead patch", commands: ["pc 16 12", "cc 1 102 127"] });
  const add = vi.fn(),
    send = vi.fn();
  render(<MacroPanel time={12.5} onAdd={add} onTest={send} canTest />);
  fireEvent.click(screen.getByText("Add macro cue"));
  expect(add).toHaveBeenCalledWith("[00:12.50] {midi:$GP_LEAD}");
  fireEvent.click(screen.getByText("Send macro now"));
  expect(send.mock.calls.map((c) => c[0])).toEqual([
    [207, 12],
    [176, 102, 127],
  ]);
});

it("removes a macro from the configuration, and says so when there are none", () => {
  saveMacro({ code: "ONE", label: "One", commands: ["start"] });
  render(<MacroPanel time={0} onAdd={vi.fn()} onTest={vi.fn()} canTest={false} />);
  fireEvent.click(screen.getByText("Remove macro"));
  expect(useMidiConfiguration.getState().macros).toEqual([]);
  expect(screen.getByText(/No macros yet/)).toBeTruthy();
});
