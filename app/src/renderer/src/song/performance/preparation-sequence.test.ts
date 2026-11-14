import { expect, it } from "vitest";
import { parseChart } from "./chart";
import { editableEvents, eventChart } from "./editor";
import { cueCommandText, cueTokenFor } from "./cue-token";
import { performanceLines } from "./reader";
import { PreparationHistory } from "./preparation-repeat";
import { preparationSequence, presetGroups } from "./preparation-sequence";
import { preparationLine, setPreparationRepeat, setPreparationWait, movePreparationLine } from "./start-preparation";
const settings = { enabled: true, settleMs: 1000, commandGapMs: 100, openingPresets: true };
it("builds automatic memory/presets, custom groups, per-line waits and tempo in one timed sequence", () => {
  const cues = parseChart(
    "{midi@load:pc 2 0}\n[00:00] {midi:cc 16 0 0} {midi:pc 16 6}\n{label:Delay} {midi@prepare:cc 1 0 0} {midi@prepare wait=0.5:pc 1 4}\n{label:Macro} {midi@prepare wait=0.2:$FX}",
    [{ code: "FX", label: "FX", commands: ["cc 3 20 127", "cc 3 21 64"] }],
  );
  cues[0].managed = "rhythm";
  const plan = preparationSequence({
    cues,
    position: 0,
    start: 0,
    settings,
    pedalChannel: 16,
    history: new PreparationHistory(),
    tempo: [
      [0xbf, 73, 1],
      [0xbf, 74, 12],
    ],
  });
  expect(plan.steps.filter((step) => step.kind === "send").map((step) => [step.label, step.atMs, step.commands.map((command) => command.bytes)])).toEqual([
    ["RC-10R memory", 0, [[0xc1, 0]]],
    [
      "Opening preset",
      100,
      [
        [0xbf, 0, 0],
        [0xcf, 6],
      ],
    ],
    [
      "Delay",
      200,
      [
        [0xb0, 0, 0],
        [0xc0, 4],
      ],
    ],
    [
      "Macro",
      800,
      [
        [0xb2, 20, 127],
        [0xb2, 21, 64],
      ],
    ],
    [
      "Song tempo",
      2000,
      [
        [0xbf, 73, 1],
        [0xbf, 74, 12],
      ],
    ],
  ]);
  expect(plan.totalWaitMs).toBe(2100);
  expect(
    presetGroups([
      [0xb0, 0, 1],
      [0xb0, 32, 2],
      [0xc0, 4],
      [0xc1, 3],
    ]),
  ).toEqual([
    [
      [0xb0, 0, 1],
      [0xb0, 32, 2],
      [0xc0, 4],
    ],
    [[0xc1, 3]],
  ]);
});
it("skips the wait of an already used once command and never consumes history while previewing", () => {
  const cues = parseChart("{label:Once} {midi@prepare-once wait=0.5:pc 3 4}"),
    history = new PreparationHistory();
  const preview = () => preparationSequence({ cues, position: 0, start: 0, settings: { ...settings, settleMs: 0 }, pedalChannel: 16, history, tempo: null });
  expect(preview().totalWaitMs).toBe(500);
  expect(history.size).toBe(0);
  history.started(history.commands(cues, true)[0].onceKey);
  expect(preview().totalWaitMs).toBe(0);
  expect(preview().skipped).toEqual([{ label: "Once", reason: "Already used this song load" }]);
  const changed = parseChart(setPreparationWait("{label:Once} {midi@prepare-once wait=0.5:pc 3 4}", cues[0], 700)!);
  expect(history.commands(changed, true)).toEqual([]);
});
it("round-trips waits through line, repeat, token and row editing without leaking them into lyrics", () => {
  const line = preparationLine("[00:00] {label:Patch} {midi:cc 1 0 2} {midi:pc 1 5}", "once", 500);
  expect(line).toBe("{label:Patch} {midi@prepare-once:cc 1 0 2} {midi@prepare-once wait=0.5:pc 1 5}");
  const cues = parseChart(line);
  expect(cues[1].prepareWaitMs).toBe(500);
  const repeat = setPreparationRepeat(line, cues[0], "beginning")!;
  expect(parseChart(repeat).map((cue) => cue.prepareRepeat)).toEqual(["beginning", "beginning"]);
  const changed = setPreparationWait(repeat + " // {midi@prepare:pc 1 9}", parseChart(repeat)[0], 250)!;
  expect(changed).toContain("wait=0.25:pc 1 5}");
  expect(changed).toContain("// {midi@prepare:pc 1 9}");
  expect(parseChart(eventChart(editableEvents(line, "", [])))[1].prepareWaitMs).toBe(500);
  expect(cueCommandText(cues[1])).toBe("@prepare-once wait=0.5 pc 1 5");
  expect(cueTokenFor(cues[1], "@prepare-once wait=0.8 pc 1 5", [])).toBe("{midi@prepare-once wait=0.8:pc 1 5}");
  expect(performanceLines(line, "", [])).toEqual([]);
  expect(movePreparationLine(line + "\n{midi@prepare wait=1:pc 2 3}", parseChart(line + "\n{midi@prepare wait=1:pc 2 3}")[2], -1)).toContain(line);
});
it.each(["-1", "11", "NaN", "Infinity"])("rejects an invalid %s-second wait", (value) => {
  expect(() => parseChart(`{midi@prepare wait=${value}:pc 1 5}`)).toThrow("Wait after");
});
it("uses requested trimmed-start position even when pre-roll starts before it", () => {
  const cues = parseChart("{midi@prepare-beginning wait=0.4:pc 1 5}");
  expect(
    preparationSequence({
      cues,
      position: 8,
      requestedPosition: 10,
      start: 10,
      settings: { ...settings, settleMs: 0 },
      history: new PreparationHistory(),
      pedalChannel: 16,
      tempo: null,
    }).totalWaitMs,
  ).toBe(400);
});
