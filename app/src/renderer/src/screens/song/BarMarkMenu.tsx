import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BAR_MARK_KINDS, DEFAULT_MARK_BEATS, FILL_BEATS, STOP_BEATS, hasBeats, type BarMark, type BarMarkKind } from "@/song/band/marks";

export const MARK_LABELS: Record<BarMarkKind, string> = {
  fill: "Fill",
  "no-fill": "No fill",
  stop: "Stop",
  crash: "Crash",
  "no-crash": "No crash",
  "drums-out": "Drums out",
  "bass-out": "Bass out",
  hit: "Hit",
};

const MARK_HELP: Record<BarMarkKind, string> = {
  fill: "A fill at the end of the bar",
  "no-fill": "No fill or turnaround here",
  stop: "Drums and bass stop for the last beats, then hit together",
  crash: "A crash on the downbeat",
  "no-crash": "No crash on the downbeat",
  "drums-out": "The drums rest for this bar",
  "bass-out": "The bass rests for this bar",
  hit: "A stab: kick, crash and one held bass note",
};

/** A mark as the chip and the list say it: "Stop, 2 beats". */
export function markText(mark: Pick<BarMark, "kind" | "beats">): string {
  const beats = hasBeats(mark.kind) ? (mark.beats ?? DEFAULT_MARK_BEATS) : null;
  return beats === null ? MARK_LABELS[mark.kind] : `${MARK_LABELS[mark.kind]}, ${beats} ${beats === 1 ? "beat" : "beats"}`;
}

export interface BarMarkMenuProps {
  /** The bar's label, for the heading: "Bar 4". */
  title: string;
  /** The marks on the bar now. */
  marks: readonly BarMark[];
  disabled: boolean;
  /** Puts a kind on the bar, or takes it off when it is already there. `beats` is the length chosen for a fill or a stop. */
  onChoose(kind: BarMarkKind, beats: number | undefined): void;
  onClear(): void;
  /** Plays the song from the bar. Not shown when not given. */
  onPlayFrom?(): void;
}

/** What opens when a bar is clicked: the eight things a bar can be told, how long a fill or stop is, and a way to clear them. */
export function BarMarkMenu({ title, marks, disabled, onChoose, onClear, onPlayFrom }: BarMarkMenuProps) {
  const [beats, setBeats] = useState<number | undefined>(undefined);
  const has = (kind: BarMarkKind) => marks.some((mark) => mark.kind === kind);
  return (
    <div role="group" aria-label={`Marks for ${title}`} className="flex flex-col gap-2 text-sm">
      <p className="font-semibold">{title}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-silkscreen-3">Fill or stop length</span>
        {STOP_BEATS.map((count) => (
          <Button
            key={count}
            type="button"
            size="sm"
            variant={(beats ?? DEFAULT_MARK_BEATS) === count ? "secondary" : "ghost"}
            aria-pressed={(beats ?? DEFAULT_MARK_BEATS) === count}
            disabled={disabled}
            title={FILL_BEATS.includes(count) ? undefined : "A stop can be 3 beats; a fill is 1, 2 or 4"}
            onClick={() => setBeats(count)}
          >
            {count}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {BAR_MARK_KINDS.map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={has(kind) ? "secondary" : "outline"}
            aria-pressed={has(kind)}
            disabled={disabled || (kind === "fill" && beats !== undefined && !FILL_BEATS.includes(beats))}
            title={MARK_HELP[kind]}
            onClick={() => onChoose(kind, hasBeats(kind) ? beats : undefined)}
          >
            {MARK_LABELS[kind]}
          </Button>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={disabled || marks.length === 0} onClick={onClear}>
          Clear
        </Button>
        {onPlayFrom && (
          <Button type="button" size="sm" variant="ghost" onClick={onPlayFrom}>
            Play from here
          </Button>
        )}
      </div>
    </div>
  );
}
