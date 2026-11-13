import type { Section } from "@/song/performance/sections";

/** The kinds a section can be, by its name. */
export type SectionKind = "neutral" | "verse" | "prechorus" | "chorus" | "bridge" | "solo";

/**
 * One colour per section kind, defined once for the timeline and the section strip. `fill` is a translucent background and `edge` a solid
 * border or marker. Intros and outros are neutral grey, so the song's body stands out.
 */
export const SECTION_COLOURS: Record<SectionKind, { fill: string; edge: string }> = {
  neutral: { fill: "rgb(148 163 184 / 0.18)", edge: "rgb(148 163 184)" },
  verse: { fill: "rgb(56 189 248 / 0.22)", edge: "rgb(56 189 248)" },
  prechorus: { fill: "rgb(45 212 191 / 0.22)", edge: "rgb(45 212 191)" },
  chorus: { fill: "rgb(251 191 36 / 0.24)", edge: "rgb(251 191 36)" },
  bridge: { fill: "rgb(192 132 252 / 0.24)", edge: "rgb(192 132 252)" },
  solo: { fill: "rgb(251 113 133 / 0.24)", edge: "rgb(251 113 133)" },
};

/** The kind a section name means: "Pre-Chorus 2" is a pre-chorus, "Guitar solo" a solo, and a name that fits none is neutral. */
export function sectionKind(name: string): SectionKind {
  const text = name.toLowerCase();
  if (/pre[\s-]?chorus/.test(text)) return "prechorus";
  if (/chorus|hook|refrain/.test(text)) return "chorus";
  if (/verse/.test(text)) return "verse";
  if (/bridge|middle 8|breakdown/.test(text)) return "bridge";
  if (/solo/.test(text)) return "solo";
  return "neutral";
}

/** The colours of a section, by its name. */
export function sectionColours(section: Pick<Section, "name">): { fill: string; edge: string } {
  return SECTION_COLOURS[sectionKind(section.name)];
}
