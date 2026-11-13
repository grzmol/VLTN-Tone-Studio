import { describe, expect, it } from "vitest";
import { MAX_SECTIONS, MAX_SECTION_NAME } from "@/song/performance/sections";
import { formatTime, parseSongKey, parseSongMap, parseTime, writeSongMap, type SongMap } from "./songmap";

const EXAMPLE = `---
songmap: 1
title: Confession
artist: Example Band
duration: 3:52.0
key: A major
bpm: 128.5
meter: 4/4
first_beat: 0:00.42
style: rock
---

# Confession

## Sections

| Start | End | Section | Drums | Bass | Style | Energy | Busy | Loud | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 0:00.0 | 0:12.4 | Intro | off | pedal | | 2 | 1 | 2 | Guitar alone, bass enters bar 3 |
| 0:12.4 | 0:43.1 | Verse 1 | on | ring | | 2 | 2 | 2 | |
| 0:43.1 | 1:14.0 | Chorus 1 | on | melodic | rock | 4 | 4 | 4 | Big, open |

## Bass notes

| Start | End | Note | Octave |
|---|---|---|---|
| 1:02.50 | 1:04.40 | F# | |
| 1:20.00 | 1:21.90 | E | down |

## Chart

\`\`\`chart
[0:12.40] # Verse 1
[0:12.40] [A]First line of the [E]verse
[0:16.10] [F#m]Second line [D]here
\`\`\`

## Notes

Free text: the instruments heard, playing styles, anything the performer should know.
`;

/** The problem messages of a text, for checks that only care about which lines were refused. */
function linesOf(text: string): number[] {
  return parseSongMap(text).problems.map((problem) => problem.line);
}

/** A small map with a key, a section and a bass note, for round trips. */
function sampleMap(): SongMap {
  return {
    title: "Confession",
    artist: "Example Band",
    duration: 232,
    key: { tonic: 6, mode: "minor", name: "F# minor" },
    bpm: 128.5,
    beatsPerBar: 6,
    meterText: "6/8",
    firstBeat: 0.42,
    style: "ballad",
    sections: [
      { start: 0, end: 12.4, name: "Intro", drums: false, bass: "pedal", energy: 2, busy: 1, loud: 2, notes: "Guitar alone" },
      { start: 12.4, end: 43.1, name: "Verse | 1", drums: true, bass: "auto", style: "pop" },
    ],
    bassNotes: [
      { start: 62.5, end: 64.4, pc: 6 },
      { start: 80, end: 81.9, pc: 4, octave: -1 },
    ],
    chart: "[0:12.40] # Verse 1\n[0:12.40] [A]First line",
    notes: "Free text.",
    extra: { producer: "Someone" },
    ignored: [],
  };
}

describe("parseSongMap: the example", () => {
  const { map, problems } = parseSongMap(EXAMPLE);

  it("reads without problems", () => {
    expect(problems).toEqual([]);
    expect(map).not.toBeNull();
  });

  it("reads the front matter", () => {
    expect(map?.title).toBe("Confession");
    expect(map?.artist).toBe("Example Band");
    expect(map?.duration).toBe(232);
    expect(map?.key).toEqual({ tonic: 9, mode: "major", name: "A major" });
    expect(map?.bpm).toBe(128.5);
    expect(map?.beatsPerBar).toBe(4);
    expect(map?.meterText).toBe("4/4");
    expect(map?.firstBeat).toBeCloseTo(0.42);
    expect(map?.style).toBe("rock");
    expect(map?.extra).toEqual({});
  });

  it("reads each section, with an empty End running to the next start", () => {
    expect(map?.sections).toEqual([
      { start: 0, end: 12.4, name: "Intro", drums: false, bass: "pedal", energy: 2, busy: 1, loud: 2, notes: "Guitar alone, bass enters bar 3" },
      { start: 12.4, end: 43.1, name: "Verse 1", drums: true, bass: "ring", energy: 2, busy: 2, loud: 2 },
      { start: 43.1, end: 74, name: "Chorus 1", drums: true, bass: "melodic", style: "rock", energy: 4, busy: 4, loud: 4, notes: "Big, open" },
    ]);
  });

  it("reads the bass notes as pitch classes, with the octave when given", () => {
    expect(map?.bassNotes).toEqual([
      { start: 62.5, end: 64.4, pc: 6 },
      { start: 80, end: 81.9, pc: 4, octave: -1 },
    ]);
  });

  it("keeps the chart verbatim and the notes text", () => {
    expect(map?.chart).toBe("[0:12.40] # Verse 1\n[0:12.40] [A]First line of the [E]verse\n[0:16.10] [F#m]Second line [D]here");
    expect(map?.notes).toBe("Free text: the instruments heard, playing styles, anything the performer should know.");
    expect(map?.ignored).toEqual([]);
  });
});

describe("parseSongMap: an empty End and the duration", () => {
  it("ends the last section at the song duration", () => {
    const text = "---\nsongmap: 1\nduration: 60\n---\n## Sections\n\n| Start | Section |\n|---|---|\n| 0 | Intro |\n| 30 | Outro |\n";
    expect(parseSongMap(text).map?.sections.map((s) => [s.start, s.end])).toEqual([
      [0, 30],
      [30, 60],
    ]);
  });

  it("reports a last section with no End and no duration", () => {
    const text = "---\nsongmap: 1\n---\n## Sections\n\n| Start | End | Section |\n|---|---|---|\n| 0 | 10 | Intro |\n| 10 | | Outro |\n";
    const { map, problems } = parseSongMap(text);
    expect(map?.sections).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 9 });
    expect(problems[0].message).toContain('"Outro" has no End time');
  });
});

describe("parseSongMap: keys, headers and columns", () => {
  it.each([
    ["F#m", 6, "minor", "F# minor"],
    ["Bb", 10, "major", "Bb major"],
    ["A major", 9, "major", "A major"],
    ["E♭ minor", 3, "minor", "Eb minor"],
  ])("reads the key %s", (text, tonic, mode, name) => {
    expect(parseSongKey(text)).toEqual({ tonic, mode, name });
  });

  it("refuses a key that is not a note and mode", () => {
    expect(parseSongKey("c")).toBeNull();
    expect(parseSongKey("A dorian")).toBeNull();
  });

  it("reads the section headers in any order and case, and ignores extra columns", () => {
    const text = `---
songmap: 1
---
## Sections

| notes | LOUD | Section | extra | Start | End |
|---|---|---|---|---|---|
| Big | 4 | Chorus | x | 0:10 | 0:20 |
`;
    const { map, problems } = parseSongMap(text);
    expect(problems).toEqual([]);
    expect(map?.sections).toEqual([{ start: 10, end: 20, name: "Chorus", loud: 4, notes: "Big" }]);
  });

  it("keeps unknown front matter keys in extra, and reads the known ones loosely", () => {
    const { map } = parseSongMap("---\nsongmap: 1\nbpm: 96\nlabel: Demo tape\nkey: Ebm\n---\n");
    expect(map?.bpm).toBe(96);
    expect(map?.key?.name).toBe("Eb minor");
    expect(map?.extra).toEqual({ label: "Demo tape" });
  });

  it("lists other ## headings in ignored, and keeps reading", () => {
    const { map, problems } = parseSongMap("---\nsongmap: 1\n---\n## Ideas\n\nlots of text\n\n## Notes\n\nkept\n");
    expect(problems).toEqual([]);
    expect(map?.ignored).toEqual(["Ideas"]);
    expect(map?.notes).toBe("kept");
  });

  it("does not read a ## line inside a code fence as a heading", () => {
    const text = "---\nsongmap: 1\n---\n## Chart\n\n```chart\n## not a heading\n[0:01.00] [C]Line\n```\n";
    const { map, problems } = parseSongMap(text);
    expect(problems).toEqual([]);
    expect(map?.ignored).toEqual([]);
    expect(map?.chart).toBe("## not a heading\n[0:01.00] [C]Line");
  });
});

describe("parseSongMap: problems", () => {
  const header = "---\nsongmap: 1\n---\n";

  it("returns no map when there is no songmap line", () => {
    const { map, problems } = parseSongMap("---\ntitle: Nothing\n---\n");
    expect(map).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("songmap: 1");
  });

  it("returns no map when the version is not 1", () => {
    const { map, problems } = parseSongMap("---\nsongmap: 2\n---\n");
    expect(map).toBeNull();
    expect(problems[0]).toMatchObject({ line: 2 });
  });

  it("never throws, even on text that is not a map", () => {
    expect(() => parseSongMap("")).not.toThrow();
    expect(() => parseSongMap("## Sections\n| a |")).not.toThrow();
    expect(parseSongMap("").map).toBeNull();
  });

  it("refuses an overlapping section and keeps the rest", () => {
    const text = `${header}## Sections\n\n| Start | End | Section |\n|---|---|---|\n| 0 | 20 | Intro |\n| 15 | 30 | Verse |\n| 30 | 40 | Chorus |\n`;
    const { map, problems } = parseSongMap(text);
    expect(problems).toEqual([{ line: 9, message: 'Line 9: "Verse" overlaps the section above it.' }]);
    expect(map?.sections.map((s) => s.name)).toEqual(["Intro", "Chorus"]);
  });

  it("refuses a section whose end is before its start", () => {
    const text = `${header}## Sections\n\n| Start | End | Section |\n|---|---|---|\n| 0 | 20 | Intro |\n| 30 | 25 | Bridge |\n`;
    const { map, problems } = parseSongMap(text);
    expect(problems[0]).toEqual({ line: 9, message: 'Line 9: "Bridge" ends before it starts.' });
    expect(map?.sections.map((s) => s.name)).toEqual(["Intro"]);
  });

  it("refuses an unknown bass part, and an energy above 5", () => {
    const text = `${header}## Sections\n\n| Start | End | Section | Bass | Energy |\n|---|---|---|---|---|\n| 0 | 10 | A | slap | 2 |\n| 10 | 20 | B | ring | 7 |\n| 20 | 30 | C | ring | 3 |\n`;
    const { map, problems } = parseSongMap(text);
    expect(linesOf(text)).toEqual([8, 9]);
    expect(problems[0].message).toContain('"slap" is not a bass part');
    expect(problems[1].message).toContain('"Energy" must be a number from 1 to 5');
    expect(map?.sections.map((s) => s.name)).toEqual(["C"]);
  });

  it("refuses a bad time and keeps the other rows", () => {
    const text = `${header}## Sections\n\n| Start | End | Section |\n|---|---|---|\n| soon | 10 | A |\n| 10 | 20 | B |\n`;
    const { map, problems } = parseSongMap(text);
    expect(problems[0].message).toContain('"soon" is not a time');
    expect(map?.sections.map((s) => s.name)).toEqual(["B"]);
  });

  it("refuses bass notes that overlap, and an unknown note name", () => {
    const text = `${header}## Bass notes\n\n| Start | End | Note | Octave |\n|---|---|---|---|\n| 10 | 20 | C | |\n| 15 | 25 | D | |\n| 30 | 40 | H | |\n| 40 | 50 | G | up |\n`;
    const { map, problems } = parseSongMap(text);
    // Unreadable cells are refused while the rows are read, so the note-name problem comes before the overlap one.
    expect(problems.map((p) => p.line).sort((a, b) => a - b)).toEqual([9, 10]);
    expect(problems.map((p) => p.message).join("\n")).toContain('"H" is not a note name');
    expect(problems.map((p) => p.message).join("\n")).toContain("overlaps");
    expect(map?.bassNotes).toEqual([
      { start: 10, end: 20, pc: 0 },
      { start: 40, end: 50, pc: 7, octave: 1 },
    ]);
  });

  it("drops a chart that does not parse, and says why", () => {
    const text = `${header}## Chart\n\n\`\`\`chart\n[0:01.00] {midi:\n\`\`\`\n`;
    const { map, problems } = parseSongMap(text);
    expect(map?.chart).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("The chart is dropped.");
    expect(problems[0].line).toBe(6);
  });

  it("refuses a bad meter and a bad bpm, and keeps the rest of the front matter", () => {
    const { map, problems } = parseSongMap("---\nsongmap: 1\nbpm: 500\nmeter: 4-4\ntitle: Ok\n---\n");
    expect(map?.title).toBe("Ok");
    expect(map?.bpm).toBeUndefined();
    expect(map?.meterText).toBeUndefined();
    expect(problems.map((p) => p.line)).toEqual([3, 4]);
  });
});

describe("parseSongMap: limits", () => {
  it("keeps at most MAX_SECTIONS sections, with one problem", () => {
    const rows = Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => `| ${i * 10} | ${i * 10 + 10} | S${i} |`).join("\n");
    const text = `---\nsongmap: 1\n---\n## Sections\n\n| Start | End | Section |\n|---|---|---|\n${rows}\n`;
    const { map, problems } = parseSongMap(text);
    expect(map?.sections).toHaveLength(MAX_SECTIONS);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(`at most ${MAX_SECTIONS} sections`);
  });

  it("cuts a long section name", () => {
    const name = "x".repeat(MAX_SECTION_NAME + 10);
    const { map } = parseSongMap(`---\nsongmap: 1\n---\n## Sections\n\n| Start | End | Section |\n|---|---|---|\n| 0 | 10 | ${name} |\n`);
    expect(map?.sections[0].name).toHaveLength(MAX_SECTION_NAME);
  });
});

describe("writeSongMap", () => {
  it("round-trips a full map", () => {
    const map = sampleMap();
    const { map: back, problems } = parseSongMap(writeSongMap(map));
    expect(problems).toEqual([]);
    expect(back).toEqual(map);
  });

  it("round-trips an empty map", () => {
    const empty: SongMap = { sections: [], bassNotes: [], extra: {}, ignored: [] };
    const { map: back, problems } = parseSongMap(writeSongMap(empty));
    expect(problems).toEqual([]);
    expect(back).toEqual(empty);
  });

  it("writes the front matter and the table headers the parser reads", () => {
    const text = writeSongMap(sampleMap());
    expect(text.startsWith("---\nsongmap: 1\ntitle: Confession\n")).toBe(true);
    expect(text).toContain("| Start | End | Section | Drums | Bass | Style | Energy | Busy | Loud | Notes |");
    expect(text).toContain("| Start | End | Note | Octave |");
    expect(text).toContain("```chart\n");
  });
});

describe("parseTime and formatTime", () => {
  it.each([
    ["42.5", 42.5],
    ["0:42.5", 42.5],
    ["3:52.0", 232],
    ["1:02.50", 62.5],
    ["1:00:00.25", 3600.25],
  ])("reads %s as %s seconds", (text, seconds) => {
    expect(parseTime(text)).toBeCloseTo(seconds);
  });

  it.each(["", "soon", "1:60", "1:2:61", "-3", "1:2:3:4"])("refuses %j", (text) => {
    expect(parseTime(text)).toBeNull();
  });

  it.each([
    [0, "0:00.00"],
    [42.5, "0:42.50"],
    [62.426, "1:02.43"],
    [3600.25, "1:00:00.25"],
    [59.999, "1:00.00"],
  ])("writes %s as %s", (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
  });
});

describe("the Marks table", () => {
  const sections = `| Start | End | Section | Drums | Bass | Style | Energy | Busy | Loud | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 0:00 | 0:20 | Verse | | | | | | | |
| 0:20 | 0:40 | Chorus 2 | | | | | | | |
`;
  const withMarks = (table: string) => `---\nsongmap: 1\n---\n\n## Sections\n\n${sections}\n## Marks\n\n${table}\n`;

  it("reads a mark on a named bar and a mark on a time", () => {
    const { map, problems } = parseSongMap(
      withMarks(`| Bar | Time | Mark | Beats |
|---|---|---|---|
| Chorus 2:8 | | stop | 2 |
| | 1:02.5 | No fill | |
| verse:1 | | fill | 4 |
| Verse:2 | | crash | 3 |`),
    );
    expect(problems).toEqual([]);
    expect(map?.marks).toEqual([
      { kind: "stop", beats: 2, bar: { section: "Chorus 2", number: 8 } },
      { kind: "no-fill", time: 62.5 },
      { kind: "fill", beats: 4, bar: { section: "verse", number: 1 } },
      { kind: "crash", bar: { section: "Verse", number: 2 } },
    ]);
  });

  it("skips a row it cannot use, says why, and keeps the rest", () => {
    const { map, problems } = parseSongMap(
      withMarks(`| Bar | Time | Mark | Beats |
|---|---|---|---|
| Chorus 2:8 | | wobble | |
| Coda:3 | | stop | |
| Chorus 2:0 | | stop | |
| Chorus 2 | | stop | |
| | | stop | |
| Chorus 2:4 | | fill | 3 |
| Chorus 2:5 | | hit | |`),
    );
    expect(map?.marks).toEqual([{ kind: "hit", bar: { section: "Chorus 2", number: 5 } }]);
    expect(problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('"wobble" is not a mark'),
      expect.stringContaining('"Coda" is not a section of this map'),
      expect.stringContaining("bars are counted from 1"),
      expect.stringContaining('"Chorus 2" is not a bar'),
      expect.stringContaining("no Bar and no Time"),
      expect.stringContaining("3 beats is not allowed for a fill"),
    ]);
  });

  it("needs a Mark column and a Bar or a Time column", () => {
    const { map, problems } = parseSongMap(withMarks(`| Bar | Kind |\n|---|---|\n| Verse:1 | stop |`));
    expect(map?.marks).toBeUndefined();
    expect(problems[0].message).toContain("needs a Bar or a Time column, and a Mark column");
  });

  it("has no marks when the map has no table, and writes none", () => {
    const { map } = parseSongMap(`---\nsongmap: 1\n---\n\n## Sections\n\n${sections}`);
    expect(map?.marks).toBeUndefined();
    expect(writeSongMap({ sections: [], bassNotes: [], extra: {}, ignored: [] })).not.toContain("## Marks");
  });

  it("is written and read back the same", () => {
    const map: SongMap = {
      sections: [{ start: 0, end: 20, name: "Chorus 2" }],
      bassNotes: [],
      marks: [
        { kind: "stop", beats: 2, bar: { section: "Chorus 2", number: 8 } },
        { kind: "hit", time: 62.5 },
      ],
      extra: {},
      ignored: [],
    };
    expect(parseSongMap(writeSongMap(map)).map).toEqual(map);
  });
});

describe("the Fill column of the Sections table", () => {
  const read = (cells: string[]) => {
    const text = `---\nsongmap: 1\n---\n## Sections\n\n| Start | End | Section | Fill |\n|---|---|---|---|\n${cells.map((fill, i) => `| ${i * 10} | ${i * 10 + 10} | S${i} | ${fill} |`).join("\n")}\n`;
    return parseSongMap(text);
  };

  it("reads the words and the sizes", () => {
    const { map, problems } = read(["auto", "none", "Short", "half bar", "Whole-bar", "3", "0", ""]);
    expect(problems).toEqual([]);
    expect(map?.sections.map((section) => section.fill)).toEqual([true, 0, 1, 2, 3, 3, 0, undefined]);
  });

  it("refuses a fill it does not know and keeps the other rows", () => {
    const { map, problems } = read(["huge", "half"]);
    expect(problems[0].message).toContain('"huge" is not a fill');
    expect(map?.sections.map((section) => section.name)).toEqual(["S1"]);
  });

  it("writes the column only when a section sets a fill, and reads its own writing back", () => {
    const plain = writeSongMap({ sections: [{ start: 0, end: 10, name: "A" }], bassNotes: [], extra: {}, ignored: [] });
    expect(plain).not.toContain("Fill");
    const map: SongMap = {
      sections: [
        { start: 0, end: 10, name: "A", fill: true },
        { start: 10, end: 20, name: "B", fill: 3 },
        { start: 20, end: 30, name: "C" },
      ],
      bassNotes: [],
      extra: {},
      ignored: [],
    };
    const text = writeSongMap(map);
    expect(text).toContain("| Loud | Fill | Notes |");
    expect(parseSongMap(text).map?.sections.map((section) => section.fill)).toEqual([true, 3, undefined]);
  });
});
