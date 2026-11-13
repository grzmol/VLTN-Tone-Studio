import { Button } from "@/components/ui/button";
import type { BarMark, BarMarks } from "@/song/band/marks";
import { markText } from "./BarMarkMenu";

export interface MarkRow {
  mark: BarMark;
  /** "Chorus 2, bar 8", or null for a mark that is on no bar of the song. */
  place: string | null;
}

export interface BandMarksListProps {
  rows: readonly MarkRow[];
  disabled: boolean;
  onRemove(mark: BarMark): void;
  onRemoveAll(): void;
}

/** The marks the performer put on bars, under the part view, with a way to take each one off. */
export function BandMarksList({ rows, disabled, onRemove, onRemoveAll }: BandMarksListProps) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Your marks" className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">Your marks ({rows.length})</h4>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemoveAll}>
          Remove all
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map(({ mark, place }) => (
          <li key={`${mark.time}-${mark.kind}`} className="flex items-center justify-between gap-2">
            <span>
              {place ?? "Not on a bar of this song"}: {markText(mark)}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`Remove ${markText(mark)} at ${place ?? "an unplaced bar"}`}
              onClick={() => onRemove(mark)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The marks of a result, as list rows in time order: a bar's place is its section and its number counted from the section's start. */
export function markRows(marks: readonly BarMark[], placed: BarMarks, place: (barIndex: number) => string | null): MarkRow[] {
  const bars = new Map<BarMark, number>();
  for (const [bar, onBar] of placed.byBar) for (const mark of onBar) bars.set(mark, bar);
  return [...marks].sort((a, b) => a.time - b.time).map((mark) => ({ mark, place: bars.has(mark) ? place(bars.get(mark)!) : null }));
}
