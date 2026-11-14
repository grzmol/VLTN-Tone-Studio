import { setPreparationRepeat, setPreparationWait } from "@/song/performance/start-preparation";
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
        onAdd={(line) => setChart([chart, line].filter(Boolean).join("\n"))}
        onPreparationWait={(cue, milliseconds) => {
          const next = setPreparationWait(chart, cue, milliseconds);
          if (next === null) return false;
          setChart(next);
          return true;
        }}
        onPreparationRepeat={(cue, repeat) => {
          const next = setPreparationRepeat(chart, cue, repeat);
          if (next === null) return false;
          setChart(next);
          return true;
        }}
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

const SECTIONS = [
  { name: "Verse 1", start: 10 },
  { name: "Chorus 1", start: 30 },
  { name: "Chorus 2", start: 70 },
];

it("adds a cue on every chorus from the On section choice", () => {
  const add = vi.fn();
  render(<MidiCueBuilder cues={[]} sections={SECTIONS} onAdd={add} onRemove={() => null} onReplace={() => false} onTest={() => {}} canTest />);
  fireEvent.change(screen.getByLabelText("Cue when"), { target: { value: "section" } });
  fireEvent.change(screen.getByLabelText("Cue section"), { target: { value: "every:chorus" } });
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(add).toHaveBeenLastCalledWith("{midi@section Chorus: pc 1 0}");
  fireEvent.change(screen.getByLabelText("Cue section"), { target: { value: "one:chorus 2" } });
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(add).toHaveBeenLastCalledWith('{midi@section "Chorus 2": pc 1 0}');
});

it("offers On section only when the song has sections", () => {
  render(<MidiCueBuilder cues={[]} onAdd={() => {}} onRemove={() => null} onReplace={() => false} onTest={() => {}} canTest />);
  expect((screen.getByRole("option", { name: "On section" }) as HTMLOptionElement).disabled).toBe(true);
});

it("lists a section cue as Every Chorus (2×) with its times in a tooltip", () => {
  render(
    <MidiCueBuilder
      cues={parseChart("{midi@section Chorus: pc 1 5}")}
      sections={SECTIONS}
      onAdd={() => {}}
      onRemove={() => null}
      onReplace={() => false}
      onTest={() => {}}
      canTest
    />,
  );
  const cell = screen.getByText("Every Chorus (2×)");
  expect(cell.getAttribute("title")).toBe("[00:30.00], [01:10.00]");
  expect(screen.getByLabelText("Remove cue at Every Chorus (2×): Raw MIDI command")).toBeTruthy();
});

it("removes one of two identical pedal commands sent as several messages, which have no Edit button", () => {
  const line = "[00:00.00] {label:Recall memory 009} {midi:cc 16 0 0} {midi:pc 16 8}";
  render(<Harness start={`${line}\n${line}`} />);
  expect(screen.queryByLabelText("Edit cue at [00:00.00]: Recall memory 009")).toBeNull();
  fireEvent.click(screen.getAllByLabelText("Remove cue at [00:00.00]: Recall memory 009")[1]);
  expect(chartText()).toBe(line);
  expect(screen.getAllByLabelText("Remove cue at [00:00.00]: Recall memory 009")).toHaveLength(1);
});

it("adds user commands to Before song and labels them distinctly from timed and load events", () => {
  const add = vi.fn();
  render(<MidiCueBuilder cues={parseChart("{midi@prepare:pc 3 8}")} onAdd={add} onRemove={() => null} onReplace={() => false} onTest={() => {}} canTest />);
  fireEvent.change(screen.getByLabelText("Cue when"), { target: { value: "prepare" } });
  expect(screen.queryByLabelText("Cue time in seconds")).toBeNull();
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(add).toHaveBeenCalledWith("{midi@prepare:pc 1 0}");
  expect(screen.getByText("Before song", { selector: "td" })).toBeTruthy();
  expect(screen.getByLabelText("Edit cue at Before song: Raw MIDI command")).toBeTruthy();
});

it("adds a once preparation command and changes an existing bank/preset line's repeat rule together", () => {
  render(<Harness start="{label:Patch} {midi@prepare:cc 1 0 2} {midi@prepare:pc 1 5}" />);
  fireEvent.change(screen.getByLabelText("Preparation repeat for Patch"), { target: { value: "once" } });
  expect(chartText()).toBe("{label:Patch} {midi@prepare-once:cc 1 0 2} {midi@prepare-once:pc 1 5}");
  fireEvent.change(screen.getByLabelText("Cue when"), { target: { value: "prepare" } });
  fireEvent.change(screen.getByLabelText("New preparation command repeat"), { target: { value: "beginning" } });
  fireEvent.change(screen.getByLabelText("Cue command number"), { target: { value: "9" } });
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(chartText()).toContain("{midi@prepare-beginning:pc 1 9}");
});

it("stores one Wait after on the whole bank/preset group and preserves it when Repeat changes", () => {
  render(<Harness start="{label:Patch} {midi@prepare:cc 1 0 2} {midi@prepare:pc 1 5}" />);
  fireEvent.change(screen.getByLabelText("Wait after Patch"), { target: { value: "0.5" } });
  expect(chartText()).toBe("{label:Patch} {midi@prepare:cc 1 0 2} {midi@prepare wait=0.5:pc 1 5}");
  fireEvent.change(screen.getByLabelText("Preparation repeat for Patch"), { target: { value: "once" } });
  expect(chartText()).toBe("{label:Patch} {midi@prepare-once:cc 1 0 2} {midi@prepare-once wait=0.5:pc 1 5}");
  fireEvent.change(screen.getByLabelText("Cue when"), { target: { value: "prepare" } });
  fireEvent.change(screen.getByLabelText("New preparation command wait after"), { target: { value: "0.2" } });
  fireEvent.click(screen.getByText("Add MIDI cue"));
  expect(chartText()).toContain("{midi@prepare wait=0.2:pc 1 0}");
});
