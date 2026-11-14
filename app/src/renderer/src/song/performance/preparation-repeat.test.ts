import { expect, it } from "vitest";
import { parseChart } from "./chart";
import { editableEvents, eventChart } from "./editor";
import { performanceLines } from "./reader";
import { cueCommandText, cueTokenFor } from "./cue-token";
import { PreparationHistory, preparationHistoryFor } from "./preparation-repeat";
import { movePreparationLine, preparationLine, setPreparationRepeat, startPreparation } from "./start-preparation";
const chart = "{midi@prepare:pc 1 5}\n{midi@prepare-beginning:cc 2 20 127}\n{midi@prepare-once:$INIT}";
const macros = [{ code: "INIT", label: "Initialize", commands: ["cc 3 70 127", "cc 3 70 0"] }];
it("parses the policies and preserves macro order while filtering resumes and completed once commands", () => {
  const cues = parseChart(chart, macros),
    history = new PreparationHistory();
  expect(cues.map((cue) => [cue.trigger, cue.prepareRepeat])).toEqual([
    ["prepare", undefined],
    ["prepare", "beginning"],
    ["prepare", "once"],
  ]);
  const initial = history.commands(cues, true);
  expect(initial.map((command) => command.bytes)).toEqual([
    [0xc0, 5],
    [0xb1, 20, 127],
    [0xb2, 70, 127],
    [0xb2, 70, 0],
  ]);
  expect(history.size).toBe(0);
  history.started(initial[2].onceKey);
  expect(history.commands(cues, false).map((command) => command.bytes)).toEqual([[0xc0, 5]]);
  expect(history.commands(cues, true).map((command) => command.bytes)).toEqual([
    [0xc0, 5],
    [0xb1, 20, 127],
  ]);
  history.reset();
  expect(history.commands(cues, false)).toHaveLength(3);
});
it("treats a bank/PC line as one once action and keeps it used after cancellation or harmless chart edits", () => {
  const line = "{label:Patch} {midi@prepare-once:cc 1 0 2} {midi@prepare-once:pc 1 5}";
  const history = new PreparationHistory(),
    cues = parseChart(line);
  const steps = history.commands(cues, true);
  expect(steps[0].onceKey).toBe(steps[1].onceKey);
  history.started(steps[0].onceKey);
  expect(history.size).toBe(1);
  expect(history.commands(parseChart("// New note\n" + line.replace("Patch", "My patch")), true)).toEqual([]);
  const rows = editableEvents(line, "", []);
  expect(rows).toHaveLength(1);
  expect(history.commands(parseChart(eventChart(rows)), true)).toEqual([]);
  expect(history.commands(parseChart(line.replace("pc 1 5", "pc 1 6")), true)).toHaveLength(2);
});
it("counts identical once command lines independently and does not reset them when other lines are reordered", () => {
  const line = "{midi@prepare-once:cc 2 70 127}";
  const other = "{midi@prepare-once:pc 1 4}";
  const history = new PreparationHistory(),
    cues = parseChart(line + "\n" + line + "\n" + other);
  const steps = history.commands(cues, true);
  expect(steps[0].onceKey).not.toBe(steps[1].onceKey);
  steps.forEach((step) => history.started(step.onceKey));
  const reordered = movePreparationLine(line + "\n" + line + "\n" + other, cues[2], -1)!;
  expect(history.commands(parseChart(reordered), true)).toEqual([]);
});
it("changes a whole command line's policy, preserves comments and supports token and row editing", () => {
  const line = "{label:Patch} {midi@prepare:cc 1 0 2} {midi@prepare:pc 1 5} // {midi@prepare:pc 1 9}";
  const changed = setPreparationRepeat(line, parseChart(line)[0], "once")!;
  expect(changed).toBe(line.replace("{midi@prepare:cc", "{midi@prepare-once:cc").replace("{midi@prepare:pc 1 5}", "{midi@prepare-once:pc 1 5}"));
  const cue = parseChart("{midi@prepare-beginning:pc 1 4}")[0];
  expect(cueCommandText(cue)).toBe("@prepare-beginning pc 1 4");
  expect(cueTokenFor(cue, "@prepare-once pc 1 5", [])).toBe("{midi@prepare-once:pc 1 5}");
  expect(preparationLine("[00:00] {midi:pc 1 5}", "once")).toBe("{midi@prepare-once:pc 1 5}");
  expect(() => parseChart("{midi@prepare-unknown:pc 1 5}")).toThrow("MIDI trigger");
});
it("uses the trimmed beginning supplied by playback and never shows rule tokens as lyrics", () => {
  const cues = parseChart(chart, macros),
    settings = { enabled: true, settleMs: 1000, openingPresets: true };
  const plan = startPreparation(cues, 9, settings, [], { history: new PreparationHistory(), atBeginning: true });
  expect(plan.commands.map((command) => command.bytes)).toContainEqual([0xb1, 20, 127]);
  expect(performanceLines(chart, "", [], macros)).toEqual([]);
});
it("keeps history for the same loaded source across view remounts, while a fresh song load starts unused", () => {
  const audio = {},
    source = { audio },
    saved = { ...source, libraryId: "song" };
  const history = preparationHistoryFor(source.audio);
  history.started("action");
  expect(preparationHistoryFor(saved.audio).size).toBe(1);
  expect(preparationHistoryFor({}).size).toBe(0);
});
