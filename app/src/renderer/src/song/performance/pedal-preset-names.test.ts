import { expect, it } from "vitest";
import { nameSource, presetLabel, presetModelOf, usablePresetNames } from "./pedal-preset-names";

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
