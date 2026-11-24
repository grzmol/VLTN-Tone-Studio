import { drumsChip, type DrumSource } from "@/song/band/drum-source";
import type { PartChoice } from "@/song/band/part-choice";

const TONE = { ok: "border-led-on text-led-on", warn: "border-led-warn text-led-warn", neutral: "border-seam" };

/** Which drums play for this song, next to the BPM. Clicking it opens This song → What plays. */
export function DrumsChip({
  choice,
  source,
  fallbackWhy,
  onOpen,
}: {
  choice: PartChoice;
  source: DrumSource;
  /** Why the pedal is not used, shown in the chip's title on a fallback. */
  fallbackWhy: string;
  onOpen: () => void;
}) {
  const chip = drumsChip(choice, source, fallbackWhy);
  return (
    <button type="button" className={`rounded-pill border px-3 py-1 text-sm ${TONE[chip.tone]}`} title={chip.title} onClick={onOpen}>
      {chip.text}
    </button>
  );
}
