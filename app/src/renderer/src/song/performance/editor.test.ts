import { expect, it } from "vitest";
import { editableEvents, eventChart } from "./editor";
import { parseChart } from "./chart";
import type { MidiMacro } from "./midi-macros";

it("preserves banks, labels, note-offs, SysEx and independent times when editing lyrics", () => {
  const original =
    "[00:01] [Am]Words\n[00:02] {label:Pedal memory} {midi:cc 3 0 1} {midi:pc 3 7}\n" +
    "[00:03] {midi:note 2 60 100}\n[00:04] {midi:off 2 60 0}\n[00:05] {midi:sysex F0 7D 01 F7}";
  const rows = editableEvents(original, "", []);
  rows[0].lyrics = "Corrected words";
  rows[0].chords = "Dm A7";
  const result = parseChart(eventChart(rows));
  expect(result.filter((c) => c.messages.length)).toEqual(parseChart(original).filter((c) => c.messages.length));
  expect(result[0].text).toBe("[Dm] [A7] Corrected words");
});
it("makes generated lyrics and chord estimates editable without inventing timestamps", () => {
  const rows = editableEvents("[00:05] {midi:cc 1 7 80}", "[00:01]First\n[00:04]Second", [
    { time: 2, name: "G", confidence: 1 },
    { time: 3, name: "N", confidence: 0 },
  ]);
  expect(rows.find((r) => r.seconds === "2")?.chords).toBe("G");
  expect(rows.find((r) => r.seconds === "5")?.midi).toBe("cc 1 7 80");
  expect(parseChart(eventChart(rows)).map((c) => c.time)).toEqual([1, 2, 3, 4, 5]);
  expect(rows.find((r) => r.seconds === "3")?.chords).toBe("N");
  expect(eventChart(editableEvents("[C]Untimed words", "", []))).toBe("[C] Untimed words");
});
it("rejects invalid edits before replacing the chart", () => {
  const [row] = editableEvents("[00:01] [C]Hello", "", []);
  expect(() => eventChart([{ ...row, midi: "cc 17 7 127" }])).toThrow("Invalid MIDI");
  expect(() => eventChart([{ ...row, seconds: "", midi: "pc 1 3" }])).toThrow("timestamp");
  expect(() => eventChart([{ ...row, seconds: "-1" }])).toThrow("time");
});
it("keeps sub-centisecond MIDI cue timing when saving unrelated edits", () => {
  const rows = editableEvents("[01:03.12345] {midi:pc 1 12}", "", []);
  expect(parseChart(eventChart(rows))[0].time).toBe(63.12345);
});

it("round-trips triggers, macro references and the extended commands through the editor", () => {
  const macros: MidiMacro[] = [{ code: "GP_LEAD", label: "Lead", commands: ["pc 16 12"] }];
  const original = "{midi@load: pc 1 5}\n[00:01] {midi:$GP_LEAD} {midi:pc 1 5 bank 0 2}\n[00:02] {midi:songselect 3} {midi:start}\n{midi@end: $GP_LEAD}";
  const rows = editableEvents(original, "", [], macros);
  expect(rows.find((r) => r.midi.startsWith("@load"))?.seconds).toBe("");
  const text = eventChart(rows);
  expect(text).toContain("{midi@load: pc 1 5}");
  expect(text).toContain("{midi:$GP_LEAD}");
  expect(text).toContain("{midi:pc 1 5 bank 0 2}");
  const reparsed = parseChart(text, macros);
  expect(reparsed.map((c) => [c.trigger ?? "", c.time, c.messages])).toEqual(parseChart(original, macros).map((c) => [c.trigger ?? "", c.time, c.messages]));
});
it("refuses a trigger row with a time, and a macro row whose code is malformed", () => {
  const [row] = editableEvents("{midi@load: pc 1 5}", "", []);
  expect(() => eventChart([{ ...row, seconds: "3" }])).toThrow("no timestamp");
  expect(() => eventChart([{ ...row, midi: "@load pc 1 5", seconds: "" }])).not.toThrow();
  expect(() => eventChart([{ ...row, midi: "@sometimes pc 1 5", seconds: "" }])).toThrow(/trigger starts/);
  expect(() => eventChart([{ ...row, midi: "$lower", seconds: "1" }])).toThrow(/Invalid macro reference/);
});
it("keeps a colour span in a lyric when the row is saved, and still refuses other braces", () => {
  const [row] = editableEvents("[00:01] {color:red}Loud{/color} words", "", []);
  expect(eventChart([row])).toBe("[00:01.00] {color:red}Loud{/color} words");
  expect(() => eventChart([{ ...row, lyrics: "{label:x} words" }])).toThrow(/one line/);
});
