import { describe, expect, it } from "vitest";
import { checkCommandText, expandCommand, isLegacyCommand, macroCodeFor, macroProblems, type MidiMacro } from "./midi-macros";

const lead: MidiMacro = { code: "GP_LEAD", label: "Lead patch", commands: ["pc 16 12", "cc 1 102 127"] };
const outro: MidiMacro = { code: "OUTRO", label: "Outro", commands: ["$GP_LEAD", "start"] };

describe("midi macros", () => {
  it("expands a reference into the messages of its commands, in order", () => {
    expect(expandCommand("$GP_LEAD", [lead])).toEqual([
      [207, 12],
      [176, 102, 127],
    ]);
  });
  it("expands nested macros", () => {
    expect(expandCommand("$OUTRO", [lead, outro])).toEqual([
      [207, 12],
      [176, 102, 127],
      [250],
    ]);
  });
  it("rejects an unknown macro with the code in the message", () => {
    expect(() => expandCommand("$NOPE", [lead])).toThrow(/Unknown macro \$NOPE/);
  });
  it("detects a macro that refers to itself, directly or through another", () => {
    const self: MidiMacro = { code: "LOOP", label: "Loop", commands: ["$LOOP"] };
    expect(() => expandCommand("$LOOP", [self])).toThrow(/refers to itself: \$LOOP → \$LOOP/);
    const a: MidiMacro = { code: "A", label: "A", commands: ["$B"] };
    const b: MidiMacro = { code: "B", label: "B", commands: ["$A"] };
    expect(() => expandCommand("$A", [a, b])).toThrow(/refers to itself/);
    expect(macroProblems([a, b]).length).toBeGreaterThan(0);
  });
  it("rejects a reference that is not a valid code, and a macro that expands too far", () => {
    expect(() => expandCommand("$gp_lead", [lead])).toThrow(/Invalid macro reference/);
    const wide: MidiMacro = { code: "WIDE", label: "Wide", commands: Array.from({ length: 64 }, () => "$GP_LEAD") };
    const wider: MidiMacro = { code: "WIDER", label: "Wider", commands: Array.from({ length: 8 }, () => "$WIDE") };
    expect(() => expandCommand("$WIDER", [lead, wide, wider])).toThrow(/more than 256 messages/);
  });
  it("reports every problem in a table, one message each", () => {
    expect(macroProblems([lead, outro])).toEqual([]);
    const problems = macroProblems([
      { code: "gp", label: "Lower case", commands: ["pc 1 1"] },
      { code: "BAD", label: "", commands: ["pc 1 500"] },
      { code: "BAD", label: "Twice", commands: ["start"] },
      { code: "EMPTY", label: "Empty", commands: [] },
    ]);
    expect(problems.join("\n")).toMatch(/“gp” must be/);
    expect(problems.join("\n")).toMatch(/\$BAD needs a label/);
    expect(problems.join("\n")).toMatch(/Two macros use \$BAD/);
    expect(problems.join("\n")).toMatch(/\$BAD: Invalid MIDI command: pc 1 500/);
    expect(problems.join("\n")).toMatch(/\$EMPTY needs 1–64 commands/);
  });
  it("checks command text without a table, accepting any macro code shape", () => {
    expect(() => checkCommandText("$GP_LEAD")).not.toThrow();
    expect(() => checkCommandText("$lead")).toThrow();
    expect(() => checkCommandText("pc 1 5 bank 0 2")).not.toThrow();
  });
  it("tells legacy commands from the extended grammar", () => {
    expect(isLegacyCommand("pc 1 5")).toBe(true);
    expect(isLegacyCommand("pc 1 5 bank 0 2")).toBe(false);
    expect(isLegacyCommand("$GP_LEAD")).toBe(false);
  });
});

describe("macro codes", () => {
  it("makes a code from the label, keeps it unique, and tidies odd labels", () => {
    expect(macroCodeFor("Lead patch", [])).toBe("LEAD_PATCH");
    expect(macroCodeFor("Lead patch", [{ code: "LEAD_PATCH", label: "", commands: [] }])).toBe("LEAD_PATCH_2");
    expect(macroCodeFor("  ", [])).toBe("MACRO");
    expect(macroCodeFor("150 looper", [])).toBe("M_150_LOOPER");
    expect(macroCodeFor("x".repeat(60), [])).toHaveLength(28);
  });
});
