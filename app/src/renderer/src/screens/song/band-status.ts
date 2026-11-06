// Wording shared by the missing-part notice and the Band panel's status. Pure, so the sentences can be tested without a screen.

import type { MissingParts, PartPresence } from "@/song/band/detect";
import { GENERATED_PART_NAMES } from "@/song/band/generated-names";
import { effectiveChoice, type PartChoices, type PartKeys } from "@/song/band/part-choice";
import type { TrackInfo } from "@/song/tracks";
import type { Section } from "@/song/performance/sections";

export type PartKind = "drums" | "bass";
const PART_KINDS: readonly PartKind[] = ["drums", "bass"];
const LABEL: Record<PartKind, string> = { drums: "Drums", bass: "Bass" };
const SINGULAR: Record<PartKind, string> = { drums: "drum", bass: "bass" };

/** The section names for the ids where a part is missing, in the order given. */
function sectionNames(ids: readonly string[], sections: readonly Section[]): string {
  const names = ids.map((id) => sections.find((section) => section.id === id)?.name ?? "a section");
  return names.length ? names.join(", ") : "some sections";
}

/** One line on what the split found for a part: present, absent, missing in some sections, or not checked. */
export function presenceLine(kind: PartKind, presence: PartPresence, absentSections: readonly string[], sections: readonly Section[]): string {
  if (presence === "present") return `${LABEL[kind]} found in the song`;
  if (presence === "absent") return `No ${kind} found`;
  if (presence === "partial") return `${LABEL[kind]} missing in ${sectionNames(absentSections, sections)}`;
  return `${LABEL[kind]} not checked (the song was not split)`;
}

/** The notice's question for the parts the split did not find, or null when every part is there (or nothing was checked). */
export function missingNotice(missing: MissingParts | null | undefined, sections: readonly Section[]): string | null {
  if (!missing) return null;
  const kinds = PART_KINDS.filter((kind) => missing[kind] === "absent" || missing[kind] === "partial");
  if (!kinds.length) return null;
  const findings = kinds.map((kind) => presenceLine(kind, missing[kind], missing.absentSections[kind], sections));
  const ask = kinds.length === 2 ? "Generate drum and bass parts?" : `Generate a ${SINGULAR[kinds[0]]} part?`;
  return `${findings.join(". ")}. ${ask}`;
}

/** True when the song has the generated drum or bass track in its mixer. */
export function hasGeneratedParts(tracks: Record<string, TrackInfo> | undefined): boolean {
  return Object.values(tracks ?? {}).some(
    (track) => track.kind === "user" && (track.name === GENERATED_PART_NAMES.drums || track.name === GENERATED_PART_NAMES.bass),
  );
}

/** What the Performance screen's Band entry point says about the parts: which are generated, what plays, and any part the split missed. */
export function bandEntryStatus(keys: PartKeys, choices: PartChoices, missing: MissingParts | null | undefined, sections: readonly Section[]): string | null {
  const lines: string[] = [];
  for (const kind of PART_KINDS) {
    const presence = missing?.[kind];
    if (presence === "absent" || presence === "partial") lines.push(presenceLine(kind, presence, missing?.absentSections[kind] ?? [], sections));
  }
  const generated = PART_KINDS.filter((kind) => keys[kind]?.generated !== undefined);
  if (generated.length) {
    lines.push(`Generated: ${generated.join(", ")}`);
    const plays = PART_KINDS.flatMap((kind) => {
      const part = keys[kind];
      if (!part || (part.original === undefined && part.generated === undefined)) return [];
      const shown = effectiveChoice(choices[kind], part);
      const what = shown === "both" ? "original and generated" : shown;
      return [`${what} ${kind}`];
    });
    if (plays.length) lines.push(`Playing ${plays.join(", ")}`);
  }
  return lines.length ? lines.join(". ") : null;
}
