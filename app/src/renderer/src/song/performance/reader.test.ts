import { describe, expect, it } from "vitest";
import { performanceLines } from "./reader";

it("merges chords by lyric intervals, preserving intro and uncertain passages", () => {
  const lines = performanceLines("", "[00:05] First line\n[00:10] Second line", [
    { time: 0, name: "C", confidence: 1 },
    { time: 6, name: "Am", confidence: 1 },
    { time: 8, name: "N", confidence: 0 },
    { time: 11, name: "F", confidence: 1 },
  ]);
  expect(lines.map((l) => [l.time, l.text, l.chords.map((c) => c.name)])).toEqual([
    [0, "", ["C"]],
    [5, "First line", ["C", "Am", "N"]],
    [10, "Second line", ["F"]],
  ]);
});
it("uses chart chords and lyrics instead of automatic drafts without showing MIDI", () => {
  const lines = performanceLines("[00:02] [C/G] My **words** {midi:pc 1 3}", "[00:02] Misheard", [{ time: 2, name: "D", confidence: 1 }]);
  expect(lines).toEqual([{ time: 2, text: "[C/G] My **words**", chords: [{ time: 2, name: "C/G" }] }]);
});
it("combines a chord-only chart with separate lyrics and ignores MIDI-only rows", () => {
  expect(performanceLines("[00:01] {midi:pc 1 2}\n[00:04] [Am]", "[00:03] Words", [])[0]).toEqual({
    time: 3,
    text: "Words",
    chords: [{ time: 4, name: "Am" }],
  });
});
it("preserves untimed reading text and tolerates invalid MIDI edits", () => {
  expect(performanceLines("", "Plain lyrics", [])[0].text).toBe("Plain lyrics");
  expect(() => performanceLines("[00:01] {midi:wrong}", "[00:02] Words", [])).not.toThrow();
});
describe("an untimed chart", () => {
  it("is read as written, with its headings and comments, and the lyrics draft does not replace it", () => {
    const lines = performanceLines("# Verse\n[C]Hello there // check the key\n\n# Chorus\n[G]Second", "[00:05] Draft words", [
      { time: 1, name: "F", confidence: 1 },
    ]);
    expect(lines.map((l) => [l.text, l.chords.map((c) => c.name)])).toEqual([
      ["# Verse", []],
      ["[C]Hello there // check the key", ["C"]],
      ["# Chorus", []],
      ["[G]Second", ["G"]],
    ]);
    expect(lines.every((l) => Number.isNaN(l.time))).toBe(true);
  });
  it("is not given audio chord estimates, which have no place in untimed text", () => {
    const lines = performanceLines("Just words\nand more", "", [{ time: 3, name: "Am", confidence: 1 }]);
    expect(lines.flatMap((l) => l.chords)).toEqual([]);
  });
  it("still uses timed lines when the chart has any timing", () => {
    const lines = performanceLines("# Verse\n[00:02] Timed line", "", []);
    expect(lines).toEqual([{ time: 2, text: "Timed line", chords: [] }]);
  });
});
it("never throws for a malformed or half-typed import, so the reader stays up during a show", () => {
  const broken = ["{midi:pc", "# \n{soc\n[C", "[00:01] {midi:$NOPE}", "{midi@load:}", "[99:99] # x", "\u0000", "// only a comment"];
  for (const chart of broken) expect(() => performanceLines(chart, "[00:02] words", [{ time: 1, name: "C", confidence: 1 }])).not.toThrow();
});
