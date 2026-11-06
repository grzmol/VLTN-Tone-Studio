import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MidiCueBuilder } from "./MidiCueBuilder";
import { parseChart, removeCueToken, replaceCueToken } from "@/song/performance/chart";
import { setClockPosition } from "@/song/performance/playback-clock";
afterEach(() => {
  cleanup();
  setClockPosition(0);
});
it("builds timed PC/CC cues with independent target channels and tests the same bytes", () => {
  const add = vi.fn(),
    test = vi.fn();
  setClockPosition(12.5);
  render(<MidiCueBuilder cues={[]} onAdd={add} onRemove={() => null} onReplace={() => false} onTest={test} canTest />);
  fireEvent.click(screen.getByText("Use playback time"));
  fireEvent.change(screen.getByLabelText("Cue MIDI channel"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Cue command number"), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(add).toHaveBeenLastCalledWith("[00:12.50] {midi:pc 3 7}");
  fireEvent.change(screen.getByLabelText("Cue command"), { target: { value: "cc" } });
  fireEvent.change(screen.getByLabelText("Cue CC value"), { target: { value: "64" } });
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(add).toHaveBeenLastCalledWith("[00:12.50] {midi:cc 3 7 64}");
  fireEvent.click(screen.getByText("Send MIDI now"));
  expect(test).toHaveBeenCalledWith([0xb2, 7, 64]);
  fireEvent.change(screen.getByLabelText("Cue MIDI channel"), { target: { value: "17" } });
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(add).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert").textContent).toContain("Invalid MIDI");
});

/** Holds the chart as the setup panel does, so a change shows in the list. */
function Harness({ start, locked = false }: { start: string; locked?: boolean }) {
  const [chart, setChart] = useState(start);
  return (
    <>
      <pre data-testid="chart">{chart}</pre>
      <MidiCueBuilder
        cues={parseChart(chart)}
        locked={locked}
        onAdd={() => {}}
        onTest={() => {}}
        canTest
        onRemove={(cue) => {
          const next = removeCueToken(chart, cue);
          if (next === null) return null;
          setChart(next);
          return () => {
            setChart(chart);
            return true;
          };
        }}
        onReplace={(cue, token, time) => {
          const next = replaceCueToken(chart, cue, token, time);
          if (next === null) return false;
          setChart(next);
          return true;
        }}
      />
    </>
  );
}
const chartText = () => screen.getByTestId("chart").textContent;
const CHART = "[00:42.10] {label:Lead} {midi:pc 1 5}\n{midi@load:pc 1 2}";

it("removes a cue with its X and brings it back with Undo", () => {
  render(<Harness start={CHART} />);
  fireEvent.click(screen.getByLabelText("Remove cue at [00:42.10]: Lead"));
  expect(screen.queryByLabelText("Remove cue at [00:42.10]: Lead")).toBeNull();
  expect(chartText()).toBe("{midi@load:pc 1 2}");
  fireEvent.click(screen.getByText("Undo"));
  expect(chartText()).toBe(CHART);
  expect(screen.getByLabelText("Remove cue at [00:42.10]: Lead")).toBeTruthy();
});

it("removes a trigger cue the same way", () => {
  render(<Harness start={CHART} />);
  fireEvent.click(screen.getByLabelText("Remove cue at On load: Raw MIDI command"));
  expect(chartText()).toBe("[00:42.10] {label:Lead} {midi:pc 1 5}");
});

it("edits a cue's program number, and Cancel changes nothing", () => {
  render(<Harness start={CHART} />);
  fireEvent.click(screen.getByLabelText("Edit cue at [00:42.10]: Lead"));
  expect((screen.getByLabelText("Cue command text") as HTMLInputElement).value).toBe("pc 1 5");
  fireEvent.change(screen.getByLabelText("Cue command text"), { target: { value: "pc 1 9" } });
  fireEvent.click(screen.getByText("Cancel"));
  expect(chartText()).toBe(CHART);
  fireEvent.click(screen.getByLabelText("Edit cue at [00:42.10]: Lead"));
  fireEvent.change(screen.getByLabelText("Cue command text"), { target: { value: "pc 1 9" } });
  fireEvent.click(screen.getByText("Update cue"));
  expect(chartText()).toBe("[00:42.10] {label:Lead} {midi:pc 1 9}\n{midi@load:pc 1 2}");
  expect(screen.getByText("PC 9")).toBeTruthy();
});

it("shows an error for an invalid edit and leaves the chart alone", () => {
  render(<Harness start={CHART} />);
  fireEvent.click(screen.getByLabelText("Edit cue at [00:42.10]: Lead"));
  fireEvent.change(screen.getByLabelText("Cue command text"), { target: { value: "pc 17 9" } });
  fireEvent.click(screen.getByText("Update cue"));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(chartText()).toBe(CHART);
});

it("tells the performer when the chart changed and refuses the change", () => {
  render(<MidiCueBuilder cues={parseChart(CHART)} onAdd={() => {}} onTest={() => {}} canTest onRemove={() => null} onReplace={() => false} />);
  fireEvent.click(screen.getByLabelText("Remove cue at [00:42.10]: Lead"));
  expect(screen.getByRole("alert").textContent).toContain("chart text changed");
});

it("disables the buttons while cues are armed and playing", () => {
  render(<Harness start={CHART} locked />);
  expect((screen.getByLabelText("Remove cue at [00:42.10]: Lead") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByTitle("Stop playback to change cues").length).toBeGreaterThan(0);
  expect(screen.queryByText(/chart editor below/)).toBeNull();
});
