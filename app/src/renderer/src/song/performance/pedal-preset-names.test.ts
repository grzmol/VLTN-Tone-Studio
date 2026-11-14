import { expect, it } from "vitest";
import { parseChart } from "./chart";
import { nameSource, presetCueLabel, presetCueTarget, presetLabel, presetModelOf, usablePresetNames } from "./pedal-preset-names";

it("labels a memory with its number and name, and falls back to today's label without one", () => {
  const names = ["Clean", "", "  Crunch Lead  "];
  expect(presetLabel(0, names)).toBe("001 Clean");
  expect(presetLabel(2, names)).toBe("003 Crunch Lead");
  expect(presetLabel(1, names)).toBe("Recall memory 002");
  expect(presetLabel(199, names)).toBe("Recall memory 200");
  expect(presetLabel(5, [])).toBe("Recall memory 006");
});

it("only GP-150 and GP-180 profiles have preset names", () => {
  expect(presetModelOf("valeton-gp180")).toBe("gp180");
  expect(presetModelOf("valeton-gp150")).toBe("gp150");
  expect(presetModelOf("strymon-timeline")).toBeNull();
  expect(presetModelOf("constructor")).toBeNull();
});

it("prefers live names, then cached ones, then nothing", () => {
  const live = { names: ["Live"], source: "live" as const };
  expect(usablePresetNames("gp180", live, ["Old"])).toEqual({ names: ["Live"], source: "live", model: "gp180" });
  expect(usablePresetNames("gp180", null, ["Old"])).toEqual({ names: ["Old"], source: "cached", model: "gp180" });
  expect(usablePresetNames("gp180", { names: ["", " "], source: "live" }, ["Old"])?.source).toBe("cached");
  expect(usablePresetNames("gp180", null, [])).toBeNull();
});

it("says where the names came from", () => {
  const at = new Date(2026, 10, 12, 12).getTime();
  expect(nameSource({ names: ["A"], source: "live" }, at)).toBe("Names read from the pedal just now");
  expect(nameSource({ names: ["A"], source: "cached" }, at)).toBe(`Names from the last connection on ${new Date(at).toLocaleDateString()}`);
  expect(nameSource({ names: ["A"], source: "cached" }, null)).toBe("Names from the last connection");
  expect(nameSource(null, at)).toBe("Connect the pedal in the editor to see preset names");
});

it("writes the name into a label that presetCueTarget reads back", () => {
  const label = presetCueLabel("gp180", 68, "Crunch {Lead}");
  expect(label).toBe("GP-180: 069 Crunch  Lead");
  const [cue] = parseChart(`[00:08] {label:${label}} {midi:cc 3 0 0} {midi:pc 3 68}`);
  expect(presetCueTarget(cue, 3)).toEqual({ slot: 68, name: "Crunch  Lead", model: "gp180" });
  expect(presetCueTarget({ ...cue, label: presetCueLabel("gp150", 68, "Old") }, 3)).toMatchObject({ name: "Old", model: "gp150" });
});

it("reads banked slots above 127 and ignores a label that disagrees with the bytes", () => {
  const [cue] = parseChart("[00:00] {label:GP-180: 129 Ambient} {midi:cc 1 0 1} {midi:pc 1 0}");
  expect(presetCueTarget(cue, 1)).toEqual({ slot: 128, name: "Ambient", model: "gp180" });
  const [edited] = parseChart("[00:00] {label:GP-180: 130 Ambient} {midi:cc 1 0 1} {midi:pc 1 0}");
  expect(presetCueTarget(edited, 1)).toEqual({ slot: 128, name: null, model: null });
});

it("has no target for a cue that is not the banked recall on the pedal's channel", () => {
  const label = "{label:GP-180: 001 Clean}";
  expect(presetCueTarget(parseChart(`[00:00] ${label} {midi:pc 1 0}`)[0], 1)).toBeNull();
  expect(presetCueTarget(parseChart(`[00:00] ${label} {midi:cc 1 0 0} {midi:pc 1 0}`)[0], 2)).toBeNull();
  expect(presetCueTarget(parseChart(`[00:00] ${label} {midi:cc 1 7 0} {midi:pc 1 0}`)[0], 1)).toBeNull();
  expect(presetCueTarget(parseChart("[00:00] {midi:cc 1 0 0} {midi:pc 1 0}")[0], 1)).toEqual({ slot: 0, name: null, model: null });
  expect(presetCueTarget(parseChart("[00:00] {label:Old label} {midi:cc 1 0 0} {midi:pc 1 0}")[0], 1)?.name).toBeNull();
});
