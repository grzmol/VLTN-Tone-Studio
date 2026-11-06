import { describe, expect, it } from "vitest";
import { chartTokens, type ChartTokenKind } from "./chart-tokens";

/** The coloured pieces of a line as `kind:text`, so a table can read them at a glance. */
function show(line: string): string[] {
  return chartTokens(line).map((t) => `${t.kind}:${line.slice(t.from, t.to)}`);
}

describe("chartTokens", () => {
  it.each<[string, string[]]>([
    ["[00:10.50] [Am]Your lyrics here", ["timestamp:[00:10.50]", "chord:[Am]"]],
    ["[01:05] [C/G]Slash chord", ["timestamp:[01:05]", "chord:[C/G]"]],
    ["[00:01] [N]Silence", ["timestamp:[00:01]", "chord:[N]"]],
    ["[00:01] [Adagio] words", ["timestamp:[00:01]"]],
    ["[00:01] {midi:pc 1 12} words", ["timestamp:[00:01]", "midi:{midi:pc 1 12}"]],
    ["[00:01] {midi:cc 1 64 127} {midi:pc 1 5}", ["timestamp:[00:01]", "midi:{midi:cc 1 64 127}", "midi:{midi:pc 1 5}"]],
    ["[00:01] {midi:$GP_LEAD} words", ["timestamp:[00:01]", "midi:{midi:", "macro:$GP_LEAD", "midi:}"]],
    ["{midi@load: pc 1 5}", ["midi:{midi@load: pc 1 5}"]],
    ["{midi@end:$SHUT}", ["midi:{midi@end:", "macro:$SHUT", "midi:}"]],
    ["[00:02] Words // a note", ["timestamp:[00:02]", "comment:// a note"]],
    ["// whole line note", ["comment:// whole line note"]],
    ["[00:02] see http://example.com", ["timestamp:[00:02]"]],
    ["[00:03] {color:red}Red words{/color}", ["timestamp:[00:03]", "colour:{color:red}", "colour:{/color}"]],
    ["[00:04] {label:Intro} [G]Words", ["timestamp:[00:04]", "directive:{label:Intro}", "chord:[G]"]],
    ["[00:05] {chase} [D]Words", ["timestamp:[00:05]", "directive:{chase}", "chord:[D]"]],
    ["[00:06] {nochase} words", ["timestamp:[00:06]", "directive:{nochase}"]],
    ["# Chorus", ["heading:# Chorus"]],
    ["   #   Verse 2", ["heading:#   Verse 2"]],
    ["#NoSpace is plain", []],
    ["plain words only", []],
    ["", []],
  ])("colours %j", (line, expected) => {
    expect(show(line)).toEqual(expected);
  });

  it("keeps every token inside the line, in order, without overlaps", () => {
    const line = "[00:01] [Am]{midi:cc 1 7 $VOL} x // y";
    const tokens = chartTokens(line);
    let last = 0;
    for (const token of tokens) {
      expect(token.from).toBeGreaterThanOrEqual(last);
      expect(token.to).toBeGreaterThan(token.from);
      last = token.to;
    }
    expect(last).toBeLessThanOrEqual(line.length);
  });

  it("uses only the kinds the editor has a colour for", () => {
    const kinds: ChartTokenKind[] = ["timestamp", "chord", "heading", "comment", "colour", "midi", "macro", "directive"];
    const lines = ["[00:01] [Am]{midi:$X} {label:a} {color:red} // c", "# h"];
    for (const line of lines) for (const token of chartTokens(line)) expect(kinds).toContain(token.kind);
  });
});
