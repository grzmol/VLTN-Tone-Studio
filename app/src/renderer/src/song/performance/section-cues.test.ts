import { describe, expect, it } from "vitest";
import { expandSectionCues, parseChart, removeCueToken, replaceCueToken, timedCues } from "./chart";
import { cueCommandText, cueTokenFor } from "./cue-token";
import { computeChaseState } from "./midi-chase";
import type { Section } from "./sections";
import { midiPreflight } from "./midi-preflight";
import { describeSectionCue, sectionChoices, sectionLine } from "./section-cues";

const sections = [
  { name: "Intro", start: 0 },
  { name: "Verse 1", start: 10 },
  { name: "Chorus 1", start: 30 },
  { name: "Verse 2", start: 50 },
  { name: "Chorus 2", start: 70 },
  { name: "Chorus 3", start: 100 },
];
const options = { duration: 200, clock: false, pedals: [], outputName: "Test MIDI" };
const full = (list: typeof sections): Section[] => list.map((s, i) => ({ ...s, id: `s${i}`, end: s.start + 5, mode: "continue" }));

describe("parsing a section cue", () => {
  it("reads the every-section and the one-section forms", () => {
    const cues = parseChart('{midi@section Chorus: pc 1 5} {label:Lead}\n{midi@section "Chorus 2": cc 1 20 127}');
    expect(cues.map((c) => [c.trigger, c.section, c.messages, c.tokens, c.label])).toEqual([
      ["section", { name: "Chorus", exact: false }, [[192, 5]], ["@section Chorus: pc 1 5"], "Lead"],
      ["section", { name: "Chorus 2", exact: true }, [[176, 20, 127]], ['@section "Chorus 2": cc 1 20 127'], undefined],
    ]);
  });
  it("keeps the source so Remove and Edit work", () => {
    const chart = "[00:01] {midi:pc 1 1}\n{midi@section Chorus: pc 1 5}\n";
    const cue = parseChart(chart).find((c) => c.trigger === "section")!;
    expect(cue.source).toMatchObject({ line: 1, start: 0, text: "{midi@section Chorus: pc 1 5}" });
    expect(removeCueToken(chart, cue)).toBe("[00:01] {midi:pc 1 1}\n");
    expect(replaceCueToken(chart, cue, "{midi@section Chorus: pc 1 6}")).toBe("[00:01] {midi:pc 1 1}\n{midi@section Chorus: pc 1 6}\n");
  });
  it("names the line for a bad form", () => {
    expect(() => parseChart("\n{midi@section Chorus:}")).toThrow(/Line 2: MIDI triggers need contents/);
    expect(() => parseChart("{midi@section : pc 1 5}")).toThrow(/Line 1: .*section name/);
    expect(() => parseChart('{midi@section "": pc 1 5}')).toThrow(/Line 1: .*section name/);
    expect(() => parseChart("{midi@section Chorus pc 1 5}")).toThrow(/Line 1: a MIDI trigger is/);
    expect(() => parseChart("[00:10] {midi@section Chorus: pc 1 5}")).toThrow(/Line 1: .*no timestamp/);
  });
  it("is not a timed cue", () => {
    expect(timedCues(parseChart("{midi@section Chorus: pc 1 5}"))).toEqual([]);
  });
  it("carries a chase mark to the cues it expands to", () => {
    const [cue] = expandSectionCues(parseChart("{nochase} {midi@section Chorus: cc 1 80 127}"), [{ name: "Chorus", start: 5 }]);
    expect(cue.chase).toBe(false);
  });
});

describe("expanding section cues", () => {
  it("fires on every section with that name, whatever the number or case", () => {
    const cues = expandSectionCues(parseChart("{midi@section chorus: pc 1 5}"), sections);
    expect(cues.map((c) => [c.time, c.messages, c.trigger])).toEqual([
      [30, [[192, 5]], undefined],
      [70, [[192, 5]], undefined],
      [100, [[192, 5]], undefined],
    ]);
  });
  it('fires on one section for the quoted form, and "Chorus" quoted needs the whole name', () => {
    expect(expandSectionCues(parseChart('{midi@section "Chorus 2": pc 1 5}'), sections).map((c) => c.time)).toEqual([70]);
    expect(expandSectionCues(parseChart('{midi@section "Chorus": pc 1 5}'), sections)).toEqual([]);
  });
  it("gives no cues for a name that matches nothing", () => {
    expect(expandSectionCues(parseChart("{midi@section Solo: pc 1 5}"), sections)).toEqual([]);
  });
  it("merges with timed cues in time order and leaves them alone", () => {
    const cues = expandSectionCues(parseChart("[00:40] {midi:pc 1 9}\n{midi@section Verse: pc 1 2}"), sections);
    expect(cues.map((c) => [c.time, c.messages[0][1]])).toEqual([
      [10, 2],
      [40, 9],
      [50, 2],
    ]);
  });
  it("puts a cue on a section that starts at 0 at time 0", () => {
    expect(expandSectionCues(parseChart("{midi@section Intro: pc 1 1}"), sections).map((c) => c.time)).toEqual([0]);
  });
  it("moves a cue when a section moves or is renamed", () => {
    const cues = parseChart("{midi@section Chorus: pc 1 5}");
    const moved = sections.map((s) => (s.name === "Chorus 2" ? { ...s, start: 75.5 } : s));
    expect(expandSectionCues(cues, moved).map((c) => c.time)).toEqual([30, 75.5, 100]);
    const renamed = sections.map((s) => (s.name === "Chorus 3" ? { ...s, name: "Outro" } : s));
    expect(expandSectionCues(cues, renamed).map((c) => c.time)).toEqual([30, 70]);
  });
  it("returns the same array when the chart has no section cues", () => {
    const cues = parseChart("[00:01] {midi:pc 1 1}\n{midi@load: pc 1 2}");
    expect(expandSectionCues(cues, sections)).toBe(cues);
  });
});

describe("the state chase", () => {
  const cues = expandSectionCues(parseChart("{midi@section Verse: pc 1 2}\n{midi@section Chorus: pc 1 5}"), sections);
  it("includes the chorus patch when starting in the middle of Chorus 2", () => {
    expect(computeChaseState(cues, 85).map((m) => m.bytes)).toEqual([[192, 5]]);
  });
  it("leaves a cue at the start position to the scheduler, as for a timed cue", () => {
    expect(computeChaseState(cues, 70).map((m) => m.bytes)).toEqual([[192, 2]]);
  });
  it("chases the verse patch from the middle of Verse 2", () => {
    expect(computeChaseState(cues, 60).map((m) => m.bytes)).toEqual([[192, 2]]);
  });
});

describe("preflight", () => {
  it("warns about a section name that matches nothing", () => {
    const report = midiPreflight(parseChart("{midi@section Solo: pc 1 5}"), { ...options, sections: full(sections) });
    expect(report.issues).toEqual([{ code: "section-cue", text: "On section Solo: there is no section called Solo. The cue never fires." }]);
  });
  it("is quiet for a name that matches, and checks the cues where they fall", () => {
    const report = midiPreflight(parseChart("{midi@section Chorus: pc 1 5}"), { ...options, sections: full(sections), duration: 80 });
    expect(report.issues.map((i) => i.code)).toContain("past-end");
    expect(report.issues.map((i) => i.code)).not.toContain("section-cue");
    expect(report.commands).toBe(3);
  });
});

describe("the builder's helpers", () => {
  it("lists every name and, for a repeated name, each section alone", () => {
    expect(sectionChoices(sections).map((c) => c.label)).toEqual([
      "Every Intro",
      "Every Verse",
      "Verse 1 only",
      "Verse 2 only",
      "Every Chorus",
      "Chorus 1 only",
      "Chorus 2 only",
      "Chorus 3 only",
    ]);
  });
  it("writes a line for a section from a line made for a time", () => {
    const [every, , , , , , two] = sectionChoices(sections);
    expect(sectionLine("[00:12.00] {label:Lead} {midi:pc 1 5} {midi:cc 1 7 9}", every.target)).toBe(
      "{label:Lead} {midi@section Intro: pc 1 5} {midi@section Intro: cc 1 7 9}",
    );
    expect(sectionLine("[00:12.00] {midi:pc 1 5}", two.target)).toBe('{midi@section "Chorus 2": pc 1 5}');
    expect(parseChart(sectionLine("[00:12.00] {midi:pc 1 5}", two.target))[0].section).toEqual({ name: "Chorus 2", exact: true });
  });
  it("describes a section cue with its count and times", () => {
    const [cue, one, none] = parseChart('{midi@section Chorus: pc 1 5}\n{midi@section "Chorus 2": pc 1 5}\n{midi@section Solo: pc 1 5}');
    expect(describeSectionCue(cue, sections)).toEqual({ text: "Every Chorus (3×)", times: "[00:30.00], [01:10.00], [01:40.00]" });
    expect(describeSectionCue(one, sections)).toEqual({ text: "Chorus 2 only (1×)", times: "[01:10.00]" });
    expect(describeSectionCue(none, sections).text).toBe("Every Solo (0×)");
  });
  it("edits a section cue as text, keeping its kind", () => {
    const [cue, one] = parseChart('{midi@section Chorus: pc 1 5}\n{midi@section "Chorus 2": pc 1 5}');
    expect(cueCommandText(cue)).toBe("@section Chorus: pc 1 5");
    expect(cueCommandText(one)).toBe('@section "Chorus 2": pc 1 5');
    expect(cueTokenFor(cue, "@section Verse: pc 1 6", [])).toBe("{midi@section Verse: pc 1 6}");
    expect(cueTokenFor(one, '@section "Chorus 3": pc 1 6', [])).toBe('{midi@section "Chorus 3": pc 1 6}');
    expect(() => cueTokenFor(cue, "pc 1 6", [])).toThrow(/@section/);
    expect(() => cueTokenFor(cue, "@section Chorus: nonsense", [])).toThrow();
  });
});
