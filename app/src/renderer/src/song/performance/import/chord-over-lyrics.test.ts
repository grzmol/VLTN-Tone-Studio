import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChart } from "../chart";
import { chordColumns, mergeChords, parseChordOverLyrics } from "./chord-over-lyrics";

const sample = readFileSync(resolve("src/renderer/src/song/performance/import/fixtures/kitchen-table.txt"), "utf8");

describe("placing chords", () => {
  it.each([
    ["chord at the start", [{ column: 0, name: "C" }], "Hello there", "[C]Hello there"],
    ["chord in the middle", [{ column: 6, name: "G" }], "Hello there", "Hello [G]there"],
    ["two chords in order", [{ column: 0, name: "C" }, { column: 6, name: "G" }], "Hello there", "[C]Hello [G]there"],
    ["chord past the end of the lyric", [{ column: 40, name: "F" }], "Hello", "Hello[F]"],
    ["chords that share a column keep their order", [{ column: 3, name: "Am" }, { column: 3, name: "C" }], "abcdef", "abc[Am][C]def"],
  ])("%s", (_, chords, lyric, expected) => {
    expect(mergeChords(chords, lyric)).toBe(expected);
  });
  it("reads a chord line only when every token is a chord", () => {
    expect(chordColumns("C    G/B  Am7")).toEqual([
      { column: 0, name: "C" },
      { column: 5, name: "G/B" },
      { column: 10, name: "Am7" },
    ]);
    expect(chordColumns("Chorus")).toBeNull();
    expect(chordColumns("Bass line")).toBeNull();
    expect(chordColumns("Dad and I")).toBeNull();
    expect(chordColumns("")).toBeNull();
  });
  it("reads N.C. as the no-chord name", () => {
    expect(chordColumns("N.C.")).toEqual([{ column: 0, name: "N" }]);
  });
});

describe("chord-over-lyrics text", () => {
  const { chart, metadata, format, notes } = parseChordOverLyrics(sample);
  it("reads the header and reports the format", () => {
    expect(format).toBe("chord-over-lyrics");
    expect(metadata).toEqual({ title: "Kitchen Table", artist: "Sample Writer", key: "C", tempo: 84 });
  });
  it("merges each chord line into the lyric under it", () => {
    expect(chart.split("\n").slice(0, 8)).toEqual([
      "# Intro",
      "[C] [G] [Am] [F]",
      "",
      "# Verse 1",
      "[C]Set the table, [G]count the chairs",
      "[Am]Pour the tea and say a [F]prayer",
      "[C]Somebody laughs in the next [G]room",
      "[F]Somebody sings the old [G]tune",
    ]);
  });
  it("turns section names into headings, bracketed or not", () => {
    expect(chart).toContain("# Chorus\n");
    expect(chart).toContain("# Bridge\n");
  });
  it("keeps a chord line with no lyric below as a line of chords, and says so", () => {
    expect(chart).toContain("\n[C]\n");
    expect(notes.some((n) => n.text.includes("no lyric below"))).toBe(true);
  });
  it("produces a chart that the app's chart parser accepts", () => {
    expect(() => parseChart(chart)).not.toThrow();
  });
  it("keeps a header value that does not parse as a lyric line, and says so", () => {
    const result = parseChordOverLyrics("Tempo: fast\nC\nHi");
    expect(result.chart).toContain("Tempo: fast");
    expect(result.notes[0].text).toContain("tempo: fast");
  });
});
