import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lrcTime, type Cue } from "@/song/performance/chart";

/** The Edit and Remove buttons of one row in the cue table. A cue the parser can't place has neither: its text is changed in the chart. */
export function CueRowButtons({ cue, locked, onEdit, onRemove }: { cue: Cue; locked: boolean; onEdit: () => void; onRemove: () => void }) {
  if (!cue.source) return null;
  const name = `${cue.trigger ? `On ${cue.trigger}` : lrcTime(cue.time)}: ${cue.label || "Raw MIDI command"}`;
  const title = locked ? "Stop playback to change cues" : undefined;
  return (
    <div className="flex gap-1" title={title}>
      <Button variant="outline" size="xs" disabled={locked} aria-label={`Edit cue at ${name}`} onClick={onEdit}>
        <Pencil aria-hidden /> Edit
      </Button>
      <Button variant="outline" size="xs" disabled={locked} aria-label={`Remove cue at ${name}`} onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
