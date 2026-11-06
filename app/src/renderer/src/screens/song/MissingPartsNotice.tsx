import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSong } from "@/song/store";
import type { Section } from "@/song/performance/sections";
import { readStoredBand, writeStoredBand } from "@/song/band/stored";
import { hasGeneratedParts, missingNotice } from "./band-status";
import { useBandPanel } from "./band-panel-state";

/**
 * Offers to generate the drum or bass part a split did not find. Shown once per song: opening the Band panel from it, or choosing "Not
 * now", remembers the choice in the song's options. Never shown during playback, and gone once the generated parts exist.
 */
export function MissingPartsNotice({ songKey, sections, playing }: { songKey: string; sections: Section[]; playing: boolean }) {
  const missing = useSong((s) => s.missingParts);
  const tracks = useSong((s) => s.tracks);
  const [dismissed, setDismissed] = useState(() => readStoredBand(songKey).noticeDismissed);
  const show = useBandPanel((s) => s.show);
  const text = missingNotice(missing, sections);
  if (!text || playing || dismissed || hasGeneratedParts(tracks)) return null;
  const dismiss = () => {
    setDismissed(true);
    writeStoredBand(songKey, { bandNoticeDismissed: true });
  };
  return (
    <section aria-label="Missing parts" className="flex flex-wrap items-center gap-3 rounded-lg border border-seam px-3 py-2 text-sm">
      <p className="flex-1">{text}</p>
      <Button
        size="sm"
        onClick={() => {
          dismiss();
          show(true);
        }}
      >
        Open Band panel
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Not now
      </Button>
    </section>
  );
}
