import { useState } from "react";
import { parseSeconds, seconds } from "./format";

/**
 * A field for a number of seconds. It shows the value rounded to two decimals with a dot, whatever the system's locale, and takes a dot or
 * a comma. A value that parses is passed on as it is typed, an empty field passes `undefined`, and half-typed text is kept without being
 * passed on. Showing a rounded value never calls `onValue`: the stored value keeps its precision until the performer edits it.
 */
export function SecondsField({
  label,
  value,
  placeholder,
  title,
  className,
  onValue,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  title?: string;
  className?: string;
  onValue: (value: number | undefined) => void;
}) {
  // The typed text while the field is being edited; null shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={className}
      placeholder={placeholder}
      title={title}
      value={draft ?? (value === undefined ? "" : seconds(value))}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text.trim() === "") onValue(undefined);
        else {
          const parsed = parseSeconds(text);
          if (parsed !== null) onValue(parsed);
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
