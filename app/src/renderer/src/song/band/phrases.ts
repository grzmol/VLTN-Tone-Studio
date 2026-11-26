// Phrase lengths shared by the bass and the drums, so the two cannot disagree about where a phrase ends. Pure.

/** Four bars a phrase, or two in a section shorter than four bars. */
export function phraseBars(sectionBars: number): number {
  return sectionBars < 4 ? 2 : 4;
}

/** Whether a bar (counted from the start of its section) closes a phrase: the last bar of a phrase, or the section's last bar. */
export function isPhraseEnd(bar: number, sectionBars: number): boolean {
  const length = phraseBars(sectionBars);
  return bar % length === length - 1 || bar === sectionBars - 1;
}
