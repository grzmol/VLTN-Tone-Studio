import { normaliseOverride, type EntryEndBehaviour, type EntryOverride } from "@shared/entry-overrides";

const field = "rounded border border-seam bg-transparent p-2";

/**
 * One entry's settings: where its song ends, and whether it starts by itself. The default for each is the song's own, so a control that is
 * left alone changes nothing. Changes are passed up as the whole override, or null when nothing differs from the song.
 */
export function EntryOverrideControls({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: EntryOverride | null;
  disabled?: boolean;
  onChange(next: EntryOverride | null): void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label={`${label} end`}
        className={field}
        disabled={disabled}
        value={value?.endBehaviour ?? ""}
        onChange={(e) => onChange(normaliseOverride({ ...value, endBehaviour: (e.target.value || undefined) as EntryEndBehaviour | undefined }))}
      >
        <option value="">Song's own end</option>
        <option value="next">Play the next song</option>
        <option value="stop">Stop the playlist</option>
        <option value="loop">Loop the song</option>
      </select>
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          aria-label={`${label} starts by itself`}
          disabled={disabled}
          checked={value?.autoplay !== false}
          onChange={(e) => onChange(normaliseOverride({ ...value, autoplay: e.target.checked ? undefined : false }))}
        />
        Starts by itself
      </label>
    </span>
  );
}
