import { expect, it } from "vitest";
import { parseChart } from "./chart";
import { PreparationHistory } from "./preparation-repeat";
import { preparationSequence } from "./preparation-sequence";
import { preparationPreflight } from "./preparation-preflight";
import { pedalTempoMessages } from "./pedal-tempo";
const pedals = [{ name: "BOSS RC-10R", channel: 2, triggers: [[2, 80] as [number, number]] }];
const plan = (chart: string, history = new PreparationHistory()) =>
  preparationSequence({
    cues: parseChart(chart),
    position: 0,
    start: 0,
    settings: { enabled: true, settleMs: 0, openingPresets: true },
    history,
    pedalChannel: 16,
    tempo: pedalTempoMessages(140, 16),
  });
it("identifies successive automatic/custom preset recalls without splitting or rewriting them", () => {
  const sequence = plan("[00:00] {midi:cc 2 0 1} {midi:pc 2 0}\n{midi@prepare:pc 2 5}");
  const before = JSON.stringify(sequence);
  expect(preparationPreflight(sequence, pedals)).toEqual([{ code: "preparation-presets", text: expect.stringContaining("PC 0 → PC 5") }]);
  expect(JSON.stringify(sequence)).toBe(before);
  expect(preparationPreflight(plan("{midi@prepare:cc 2 0 1} {midi@prepare:pc 2 5}"), pedals)).toEqual([]);
});
it("warns once per configured trigger, and flags note-on and Start/Continue before music", () => {
  const sequence = plan("{midi@prepare:cc 2 80 127} {midi@prepare:cc 2 80 0}\n{midi@prepare:cc 2 80 127}\n{midi@prepare:note 1 60 100}\n{midi@prepare:start}");
  expect(preparationPreflight(sequence, pedals).map((issue) => issue.code)).toEqual(["preparation-trigger", "preparation-note", "preparation-transport"]);
  expect(preparationPreflight(plan("{midi@prepare:cc 3 80 127}\n{midi@prepare:note 1 60 0}\n{midi@prepare:stop}"), pedals)).toEqual([]);
});
it("checks only eligible once commands and leaves history untouched", () => {
  const history = new PreparationHistory(),
    chart = "{midi@prepare-once:cc 2 80 127}";
  const sequence = plan(chart, history);
  expect(preparationPreflight(sequence, pedals)).toHaveLength(1);
  expect(history.size).toBe(0);
  const step = sequence.steps.find((step) => step.kind === "send" && step.origin === "custom");
  if (step?.kind === "send") history.started(step.commands[0].onceKey);
  expect(preparationPreflight(plan(chart, history), pedals)).toEqual([]);
});
it("encodes effective rounded tempo and rejects invalid tempo instead of sending it", () => {
  expect(pedalTempoMessages(139.6, 16)).toEqual([
    [191, 73, 1],
    [191, 74, 12],
  ]);
  for (const invalid of [NaN, Infinity, 39, 301]) expect(() => pedalTempoMessages(invalid, 16)).toThrow("40–300");
});
