import type { ReactNode } from "react";

/**
 * Lyrics, as the reader and the audience display draw them. Shared so the two show the same emphasis and colour.
 */
/** The colour spans' palette, by the name written in `{color:…}`. */
const COLOUR_CLASSES = new Map<string, string>([
  ["red", "text-red-400"],
  ["amber", "text-amber-400"],
  ["green", "text-green-400"],
  ["blue", "text-sky-400"],
  ["violet", "text-violet-400"],
]);

/**
 * The lyric text as it is shown: emphasis, colour spans, and no chord names (the chord row above the line shows those). An unknown colour
 * name is shown in the normal text colour.
 */
export function formatted(text: string): ReactNode[] {
  let colour: string | undefined;
  return text
    .replace(/\[N\]/g, "")
    .split(/(\{color:[a-z]+\}|\{\/color\}|\*\*[^*]+\*\*|\*[^*]+\*|\[[A-G][^\]]*\])/g)
    .map((part, i) => {
      const open = /^\{color:([a-z]+)\}$/.exec(part);
      if (open) {
        colour = COLOUR_CLASSES.get(open[1]);
        return null;
      }
      if (part === "{/color}") {
        colour = undefined;
        return null;
      }
      if (/^\[[A-G]/.test(part)) return null;
      const content = part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("*") ? <em key={i}>{part.slice(1, -1)}</em> : part;
      return colour ? (
        <span key={i} className={colour}>
          {content}
        </span>
      ) : (
        content
      );
    });
}
