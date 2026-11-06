import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat, importChart } from "./import-chart";

const chordPro = readFileSync(resolve("src/renderer/src/song/performance/import/fixtures/harbour-lights.cho"), "utf8");
const sheet = readFileSync(resolve("src/renderer/src/song/performance/import/fixtures/kitchen-table.txt"), "utf8");

describe("choosing the importer", () => {
  it.each([
    ["a directive", "{title: X}\n[C]Hi", "chordpro"],
    ["a section directive", "{soc}\n[C]Hi\n{eoc}", "chordpro"],
    ["chords on their own line", "C G\nHello there", "chord-over-lyrics"],
    ["the app's timed chart", "[00:01] [C]Hello {midi:pc 1 5}", "app"],
    ["the app's MIDI and colour syntax", "{midi:pc 1 5} {color:red}Hi{/color}", "app"],
    ["plain lyrics", "Some words\nand more words", "app"],
    ["a word that is not a chord", "Bass and drums", "app"],
  ])("%s is %s", (_, text, format) => {
    expect(detectFormat(text)).toBe(format);
  });
});

describe("importChart", () => {
  it("imports a ChordPro file and reports no error", () => {
    const result = importChart(chordPro);
    expect(result.format).toBe("chordpro");
    expect(result.error).toBeUndefined();
    expect(result.metadata.title).toBe("Harbour Lights");
  });
  it("imports a chord-over-lyrics sheet and reports no error", () => {
    const result = importChart(sheet);
    expect(result.format).toBe("chord-over-lyrics");
    expect(result.error).toBeUndefined();
  });
  it("passes the app's own chart through unchanged, with LRC timestamps and MIDI", () => {
    const text = "[00:01.00] [Am]Words {midi:pc 1 5}\n[00:04.00] {label:Patch} {midi:cc 1 80 127}";
    const result = importChart(text);
    expect(result.format).toBe("app");
    expect(result.chart).toBe(text);
    expect(result.notes).toEqual([]);
  });
  it("reports a chart that does not parse as an error, without throwing", () => {
    const result = importChart("[00:01] {midi:wrong command}");
    expect(result.error).toMatch(/Invalid MIDI command/);
  });
  it("reports an untimed MIDI command as an error rather than dropping it", () => {
    expect(importChart("{midi:pc 1 5}\nHello").error).toMatch(/timestamp/);
  });
  it("uses Windows and classic Mac line endings the same way", () => {
    expect(importChart("[00:01] Hi\r\n[00:02] There\r\n").chart).toBe("[00:01] Hi\n[00:02] There");
  });
  it("never throws on empty or unusual text", () => {
    for (const text of ["", "   ", "\n\n", "{", "C", "\u0000", "[00:99] x"]) expect(() => importChart(text)).not.toThrow();
  });
});
