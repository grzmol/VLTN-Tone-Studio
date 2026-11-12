import { Input } from "@/components/ui/input";
import { PREPARATION_REPEATS, PREPARATION_REPEAT_LABELS, type PreparationRepeat } from "@/song/performance/preparation-repeat";

/** A wait belongs to a whole command line, so bank/preset pairs and macros have one timing control. */
export function PreparationTimingFields({
  repeat,
  waitMs,
  onRepeat,
  onWait,
  disabled,
  name,
}: {
  repeat: PreparationRepeat;
  waitMs: number;
  onRepeat?: (value: PreparationRepeat) => void;
  onWait?: (value: number) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {onRepeat && (
        <label>
          Repeat{" "}
          <select
            aria-label={name ? `Preparation repeat for ${name}` : "New preparation command repeat"}
            className="rounded border border-seam bg-background p-1"
            disabled={disabled}
            value={repeat}
            title="Applies to the whole command line, keeping bank/preset pairs together."
            onChange={(event) => onRepeat(event.target.value as PreparationRepeat)}
          >
            {PREPARATION_REPEATS.map((value) => (
              <option key={value} value={value}>
                {PREPARATION_REPEAT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      )}
      {onWait && (
        <label className="flex items-center gap-1">
          Wait after (s)
          <Input
            aria-label={name ? `Wait after ${name}` : "New preparation command wait after"}
            type="number"
            min={0}
            max={10}
            step={0.1}
            className="w-20"
            disabled={disabled}
            value={waitMs / 1000}
            onChange={(event) => {
              const value = event.target.valueAsNumber;
              if (Number.isFinite(value)) onWait(Math.max(0, Math.min(10000, Math.round(value * 1000))));
            }}
          />
        </label>
      )}
    </div>
  );
}
