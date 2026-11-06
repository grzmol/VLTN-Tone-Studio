import { lrcTime, matchingSections, sectionBase, type Cue, type SectionTarget } from "./chart";

/** One entry of the cue builder's On section menu: every section with a name ("Every Chorus"), or one section ("Chorus 2 only"). */
export interface SectionChoice {
  id: string;
  label: string;
  target: SectionTarget;
}

/**
 * The menu of section choices for a song, in song order. Every name gets an "Every …" entry; a name that more than one section carries
 * (Chorus 1, Chorus 2, Chorus 3) also gets an entry for each of those sections alone.
 */
export function sectionChoices(sections: readonly { name: string; start: number }[]): SectionChoice[] {
  const ordered = [...sections].sort((a, b) => a.start - b.start),
    seen = new Set<string>(),
    choices: SectionChoice[] = [];
  for (const section of ordered) {
    const base = sectionBase(section.name);
    if (!base || seen.has(base)) continue;
    seen.add(base);
    const group = ordered.filter((other) => sectionBase(other.name) === base),
      title = section.name.trim().replace(/\s+\d+$/, "");
    choices.push({ id: `every:${base}`, label: `Every ${title}`, target: { name: title, exact: false } });
    if (group.length > 1)
      for (const member of group)
        choices.push({ id: `one:${member.name.trim().toLowerCase()}`, label: `${member.name.trim()} only`, target: { name: member.name.trim(), exact: true } });
  }
  return choices;
}

/** The chart token for a command on a section choice: `{midi@section Chorus: pc 1 5}`, or `{midi@section "Chorus 2": pc 1 5}` for one section. */
export function sectionToken(target: SectionTarget, command: string): string {
  return `{midi@section ${target.exact ? `"${target.name}"` : target.name}: ${command}}`;
}

/**
 * Turns a line the pedal and macro pickers wrote for a time (`[00:12.00] {label:…} {midi:pc 1 5}`) into one for a section: the timestamp goes
 * and each command becomes a section token. Anything else on the line (the label, a chase mark) stays.
 */
export function sectionLine(line: string, target: SectionTarget): string {
  return line.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\{midi:([^}]+)\}/g, (_, command: string) => sectionToken(target, command.trim()));
}

/** What the cue table shows in the time column of a section cue: "Every Chorus (3×)" and the times it fires at, for a tooltip. */
export function describeSectionCue(cue: Cue, sections: readonly { name: string; start: number }[]): { text: string; times: string } {
  const target = cue.section;
  if (!target) return { text: "On section", times: "" };
  const starts = matchingSections(target, sections).map((section) => section.start),
    name = target.exact ? `${target.name} only` : `Every ${target.name.replace(/\s+\d+$/, "")}`;
  return { text: `${name} (${starts.length}×)`, times: starts.length ? starts.map((start) => lrcTime(start)).join(", ") : "No section has this name" };
}
