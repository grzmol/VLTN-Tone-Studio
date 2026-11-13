import { Drum } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectWholeSongStems, useSong } from "@/song/store";
import { partKeysOf, type PartChoices } from "@/song/band/part-choice";
import { useBandRefreshStatus } from "@/song/band/refresh";
import { performanceKey } from "@/song/performance/settings";
import type { Section } from "@/song/performance/sections";
import { bandEntryStatus, hasGeneratedParts } from "./band-status";
import { useBandPanel } from "./band-panel-state";

export interface BandPanelButtonProps {
  /** The song's sections, which name the section a partly found part is missing from. */
  sections: Section[];
  /** Which drums and bass play, so the entry point can say what is playing. */
  partChoices: PartChoices;
}

/**
 * The Band entry point, above the mixer: a card that opens the panel. Its label and status follow the song's generated parts, and a
 * part the split missed is named here too.
 */
export function BandPanelButton({ sections, partChoices }: BandPanelButtonProps) {
  const show = useBandPanel((s) => s.show);
  const stems = useSong(selectWholeSongStems);
  const tracks = useSong((s) => s.tracks);
  const missing = useSong((s) => s.missingParts);
  const generated = hasGeneratedParts(tracks);
  const source = useSong((s) => s.source);
  const updating = useBandRefreshStatus((s) => (s.key === performanceKey(source) ? s.message : ""));
  const status = bandEntryStatus(partKeysOf(tracks ?? {}, stems), partChoices, missing, sections);
  return (
    <section aria-label="Band parts" className="flex flex-wrap items-center gap-3 rounded-lg border border-seam px-3 py-2 text-sm">
      <Drum className="size-5 shrink-0 text-silkscreen-3" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-muted-foreground">Make drum and bass parts that follow this song, and choose what plays.</p>
        {status && <p>{status}.</p>}
        {updating && <p role="status">Updating generated parts: {updating}</p>}
      </div>
      <Button variant="secondary" size="sm" onClick={() => show(true)}>
        {generated ? "Drums & bass…" : "Generate drums & bass…"}
      </Button>
    </section>
  );
}
