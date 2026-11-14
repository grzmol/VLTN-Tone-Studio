import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { BandGridSection, type BandGridSectionProps } from "./BandGridSection";

/** The Notes tab: the chord strip, and the performer's bass notes on it. Bass notes from (original bass or chords) is on the Feel tab's bass column. */
export function BandTabNotes(props: Omit<BandGridSectionProps, "view"> & { grid: BeatGrid | null; harmony: readonly ChordAtBeat[] }) {
  return <BandGridSection {...props} view="notes" />;
}
