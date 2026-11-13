import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { BandGridSection, type BandGridSectionProps } from "./BandGridSection";
import { BandPartView, type BandPartViewProps } from "./BandPartView";

/**
 * The Notes tab: the drum hits and bass notes the band plays, section by section, then the chord strip and the performer's bass notes on it.
 * Bass notes from (original bass or chords) is on the Feel tab's bass column.
 */
export function BandTabNotes({
  partView,
  ...props
}: Omit<BandGridSectionProps, "view"> & { grid: BeatGrid | null; harmony: readonly ChordAtBeat[]; partView: BandPartViewProps }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <BandPartView {...partView} />
      <BandGridSection {...props} view="notes" />
    </div>
  );
}
