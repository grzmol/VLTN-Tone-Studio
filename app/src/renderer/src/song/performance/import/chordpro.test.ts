import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChart } from "../chart";
import { parseChordPro } from "./chordpro";

const sample = readFileSync(resolve("src/renderer/src/song/performance/import/fixtures/harbour-lights.cho"), "utf8");

describe("ChordPro metadata", () => {
  it("reads the song details from the directives", () => {
    const { metadata } = parseChordPro(sample);
    expect(metadata).toEqual({ title: "Harbour Lights", artist: "A. Tester", key: "A", capo: 2, tempo: 96, duration: 222, year: 2024 });
  });
  it("reads a duration in seconds and a clock time, and rejects a bad one with a note", () => {
    expect(parseChordPro("{duration: 90}").metadata.duration).toBe(90);
    const bad = parseChordPro("{duration: long}");
    expect(bad.metadata.duration).toBeUndefined();
    expect(bad.notes.map((n) => n.text).join(" ")).toContain("{duration: long}");
  });
  it("ignores a tempo, capo or year outside its range, and says so", () => {
    const { metadata, notes } = parseChordPro("{tempo: 900}\n{capo: 9}\n{year: 800}");
    expect(metadata).toEqual({});
    expect(notes.length).toBe(3);
  });
  it("keeps the first title when a file repeats the directive", () => {
    expect(parseChordPro("{title: First}\n{title: Second}").metadata.title).toBe("First");
  });
});

describe("ChordPro chart", () => {
  const { chart } = parseChordPro(sample);
  it("writes section directives as headings and keeps the chords inline", () => {
    expect(chart.split("\n").slice(0, 6)).toEqual([
      "// subtitle: Original test song",
      "// textfont: Serif",
      "// Written for the import tests. Lyrics and chords are original.",
      "",
      "# Verse",
      "[A]Lanterns on the [D]water, [A]low and [E]slow",
    ]);
    expect(chart).toContain("# Chorus\n[D]Hold the light [E]steady, [F#m]hold it [D]high\n");
    expect(chart).toContain("# Half time from here\n# Bridge");
  });
  it("keeps tab blocks as editor comments, never as stage text", () => {
    expect(chart).toContain("// e|-----0-----|");
    expect(chart).toContain("// B|---1---1---|");
  });
  it("keeps a supported span and an inline comment for the editor", () => {
    expect(chart).toContain("{color:red}Final line{/color}");
    expect(chart).toContain("Plain line with [N]no chord  // remember the capo");
  });
  it("turns an unsupported chorus recall into a comment rather than dropping it", () => {
    expect(chart).toContain("// chorus\n");
  });
  it("produces a chart that the app's chart parser accepts", () => {
    expect(() => parseChart(chart)).not.toThrow();
  });
  it("imports only the first song and says what it ignored", () => {
    expect(chart).not.toContain("Second Song");
    expect(chart).not.toContain("This line belongs to the second song");
    const message = parseChordPro(sample).notes.find((n) => n.text.includes("more than one song"));
    expect(message?.text).toContain("ignored");
  });
  it("lists every directive it could not take as written, with its line number", () => {
    const { notes } = parseChordPro(sample);
    expect(notes.find((n) => n.text.includes("{subtitle: Original test song}"))?.line).toBe(2);
    expect(notes.find((n) => n.text.includes("{textfont: Serif}"))?.line).toBe(9);
    expect(notes.some((n) => n.text.includes("{chorus}"))).toBe(true);
  });
});

describe("ChordPro edge cases", () => {
  it("turns each section start into a heading, with the default name when it has no label", () => {
    expect(parseChordPro("{sov}\nHello\n{eov}").chart).toBe("# Verse\nHello");
    expect(parseChordPro("{start_of_chorus: Last Chorus}\nHi").chart).toBe("# Last Chorus\nHi");
  });
  it("keeps the app's own MIDI, label and chase syntax as written", () => {
    const text = "{midi:pc 1 5}\n[00:04] [C]Words {label:Patch} {chase}";
    expect(parseChordPro(text).chart).toBe(text);
  });
  it("reads a line that is only a comment or a blank line without a note", () => {
    const result = parseChordPro("# just a note\n\n{comment}");
    expect(result.chart).toBe("// just a note");
    expect(result.notes).toEqual([]);
  });
  it("never throws on broken or unusual input", () => {
    const broken = ["{", "}", "{}", "{{}}", "{title", "{: }", "{end_of_tab}", "{start_of_tab}\n[C]", "{tempo:}", "\u0000{ns}", "{new_song}"];
    for (const text of broken) expect(() => parseChordPro(text)).not.toThrow();
  });
});
