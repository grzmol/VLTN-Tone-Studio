import { BandGridSection, type BandGridSectionProps } from "./BandGridSection";

/** The Timing tab: find the beat, half or double tempo, the downbeat and nudge buttons, the fixed BPM, and the grid summary. */
export function BandTabTiming(props: Omit<BandGridSectionProps, "view" | "bassNotes">) {
  return <BandGridSection {...props} view="timing" />;
}
