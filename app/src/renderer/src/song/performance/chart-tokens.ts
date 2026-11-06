import { headingLabel } from "./chart";
import { isChordName } from "./speed";

/**
 * What a piece of chart text is, for the editor's colours. Text outside any token is plain. The grammar is the one `parseChart` reads, so a
 * construct is coloured only where the parser would read it.
 */
export type ChartTokenKind = "timestamp" | "chord" | "heading" | "comment" | "colour" | "midi" | "macro" | "directive";

export interface ChartToken {
  /** Offsets within the line. */
  from: number;
  to: number;
  kind: ChartTokenKind;
}

/**
 * One alternative per construct, tried left to right. A `//` comment must start the line or follow a space, as `stageText` requires, so a web
 * address is not coloured as a comment.
 */
const TOKEN = new RegExp(
  [
    String.raw`\[\d+:[0-5]\d(?:\.\d+)?\]`,
    String.raw`\[[^\]\s]+\]`,
    String.raw`\{midi(?:@(?:load|play|stop|end))?:[^}]*\}`,
    String.raw`\{color:[a-z]+\}|\{\/color\}`,
    String.raw`\{label:[^}]*\}|\{(?:no)?chase\}`,
    String.raw`(?<=^|\s)\/\/.*$`,
  ].join("|"),
  "g",
);

/** A `$CODE` macro reference inside a `{midi:…}` command. Codes match `MACRO_CODE` in `midi-macros.ts`. */
const MACRO = /\$[A-Z][A-Z0-9_]{0,31}/g;

/** The colours of one line's constructs, in the order they occur. Each match's kind is read from its first characters. */
export function chartTokens(line: string): ChartToken[] {
  if (headingLabel(line) !== null) return [{ from: line.search(/\S/), to: line.length, kind: "heading" }];
  const tokens: ChartToken[] = [];
  for (const match of line.matchAll(TOKEN)) {
    const text = match[0],
      from = match.index;
    if (text.startsWith("{midi")) tokens.push(...midiTokens(text, from));
    else {
      const kind = kindOf(text);
      if (kind) tokens.push({ from, to: from + text.length, kind });
    }
  }
  return tokens;
}

function kindOf(text: string): ChartTokenKind | null {
  if (/^\[\d+:/.test(text)) return "timestamp";
  if (text.startsWith("[")) return isChordName(text.slice(1, -1)) ? "chord" : null;
  if (text.startsWith("//")) return "comment";
  if (text.startsWith("{color") || text.startsWith("{/color")) return "colour";
  return "directive";
}

/** A MIDI command with its `$CODE` references coloured apart, so a macro reads differently from the command around it. */
function midiTokens(text: string, offset: number): ChartToken[] {
  const tokens: ChartToken[] = [];
  let at = 0;
  for (const macro of text.matchAll(MACRO)) {
    const start = macro.index;
    if (start > at) tokens.push({ from: offset + at, to: offset + start, kind: "midi" });
    tokens.push({ from: offset + start, to: offset + start + macro[0].length, kind: "macro" });
    at = start + macro[0].length;
  }
  if (at < text.length) tokens.push({ from: offset + at, to: offset + text.length, kind: "midi" });
  return tokens;
}
