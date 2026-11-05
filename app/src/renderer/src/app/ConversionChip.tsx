// The v1 library conversion in the status bar. It runs in the background at start-up and sends its progress on the library's transfer
// channel; the chip shows it like the analysis chip does, and goes when the conversion reports it is done.

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { host } from "@/host";
import { CONVERTED_PHASE, CONVERTING_PHASE } from "@shared/song-library";

export interface ConversionProgress {
  completed: number;
  total: number;
}

/** The status line for a conversion: "Converting library: 2 of 6 songs". */
export function conversionLine({ completed, total }: ConversionProgress): string {
  return `Converting library: ${completed} of ${total} ${total === 1 ? "song" : "songs"}`;
}

export function ConversionChip() {
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  useEffect(() => {
    const library = host.song?.library;
    if (!library) return;
    return library.onTransferProgress((p) => {
      if (p.phase === CONVERTING_PHASE) setProgress({ completed: p.completed, total: p.total });
      else if (p.phase === CONVERTED_PHASE) setProgress(null);
    });
  }, []);
  if (!progress || progress.total === 0) return null;
  const percent = Math.round((progress.completed / progress.total) * 100);
  return (
    <span className="flex min-w-0 max-w-[30%] shrink items-center gap-2">
      <span className="size-[7px] shrink-0 rounded-full bg-led-warn" aria-hidden />
      <span className="truncate">{conversionLine(progress)}</span>
      <Progress className="w-16 shrink-0" value={percent} aria-label="Conversion progress" />
    </span>
  );
}
