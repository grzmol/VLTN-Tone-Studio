// Drum phrases: where each bar of a section sits in its phrases, which decides how the bar plays. A drummer thinks in phrases of four bars:
// the last bar of a phrase turns around, the last bar of every second phrase has a small fill, and the section's last bar leads into the
// next section. Pure.

import { isPhraseEnd, phraseBars } from "./phrases";

/** Where a bar sits in its section's phrases. Phrases are 4 bars, or 2 in a section shorter than 4 bars (the same rule as the bass). */
export interface BarRole {
  /** Index of the bar in the section. */
  bar: number;
  /** Index of the phrase in the section. */
  phrase: number;
  /** 0 to the phrase's length minus one. */
  inPhrase: number;
  /** The last bar of a phrase. */
  phraseEnd: boolean;
  /** The last bar of every second phrase (bar 8, 16, and so on, counting from 1). */
  pairEnd: boolean;
  sectionStart: boolean;
  sectionEnd: boolean;
}

/** The role of every bar of a section of `sectionBars` bars. */
export function barRoles(sectionBars: number): BarRole[] {
  const length = phraseBars(sectionBars);
  return Array.from({ length: Math.max(0, sectionBars) }, (_, bar) => ({
    bar,
    phrase: Math.floor(bar / length),
    inPhrase: bar % length,
    phraseEnd: isPhraseEnd(bar, sectionBars),
    pairEnd: (bar + 1) % (2 * length) === 0,
    sectionStart: bar === 0,
    sectionEnd: bar === sectionBars - 1,
  }));
}
