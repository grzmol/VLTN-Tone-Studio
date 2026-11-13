import { BandSections, type BandSectionRow } from "./BandSections";
import type { SectionOverride } from "@/song/band/arrangement";

/** The Parts tab: the sections table, where the performer changes what the band plays in each part of the song. */
export function BandTabParts({
  rows,
  disabled,
  selected,
  onSelect,
  onChange,
  onCopyToSameKind,
  onReset,
  beatsPerBar,
}: {
  rows: readonly BandSectionRow[];
  disabled: boolean;
  selected: number | null;
  onSelect(index: number | null): void;
  onChange(sectionId: string | null, patch: SectionOverride): void;
  onCopyToSameKind(sectionId: string | null): void;
  onReset(sectionId: string | null): void;
  beatsPerBar?: number;
}) {
  return (
    <section aria-label="Sections" className="flex flex-col gap-2">
      <BandSections rows={rows} disabled={disabled} selected={selected} onSelect={onSelect} onChange={onChange} onCopyToSameKind={onCopyToSameKind} onReset={onReset} beatsPerBar={beatsPerBar} />
    </section>
  );
}
